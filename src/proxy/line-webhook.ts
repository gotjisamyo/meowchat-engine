import crypto from "node:crypto";
import type { Context } from "hono";
import type { BotConfig, CustomerProfile, LineWebhookEvent } from "../types/index.js";
import {
  loadOrCreateProfile,
  saveProfile,
  resetSession,
  addPreference,
} from "../memory/customer-profile.js";
import { addTurn, isSessionIdle } from "../memory/conversation-buffer.js";
import { shouldEscalate, buildEscalationMessage } from "../engine/guardrails.js";
import { assembleContext, estimateTokens } from "../engine/context-assembler.js";
import { callGemini } from "../engine/gemini-client.js";
import { getBotConfig } from "./bot-registry.js";

// ─── Verify LINE signature ────────────────────────────────────────────────────

function verifyLineSignature(
  body: string,
  signature: string,
  secret: string
): boolean {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(body);
  const expected = hmac.digest("base64");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

// ─── Reply to LINE via Messaging API ─────────────────────────────────────────

async function replyToLine(
  replyToken: string,
  message: string,
  accessToken: string
): Promise<void> {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text: message }],
    }),
  });
}

// ─── Main webhook handler ─────────────────────────────────────────────────────

export async function lineWebhookHandler(c: Context): Promise<Response> {
  const botId = c.req.param("botId");

  // Load bot config
  const config: BotConfig | null = await getBotConfig(botId ?? "");
  if (!config) {
    return c.json({ error: "bot not found" }, 404);
  }

  // Read raw body for signature verification
  const rawBody = await c.req.text();
  const signature = c.req.header("x-line-signature") ?? "";

  if (!verifyLineSignature(rawBody, signature, config.lineChannelSecret)) {
    console.warn(`[LINE] invalid signature for botId=${botId}`);
    return c.json({ error: "invalid signature" }, 401);
  }

  const body = JSON.parse(rawBody);
  const events = body.events ?? [];

  // Process events in parallel (each user message is independent)
  await Promise.allSettled(
    events.map((event: Record<string, unknown>) =>
      processLineEvent(event, config)
    )
  );

  return c.json({ ok: true });
}

// ─── Process a single LINE event ─────────────────────────────────────────────

async function processLineEvent(
  event: Record<string, unknown>,
  config: BotConfig
): Promise<void> {
  // Only handle text messages
  if (event.type !== "message") return;
  const msg = event.message as Record<string, unknown>;
  if (msg?.type !== "text") return;

  const userId = (event.source as Record<string, string>)?.userId;
  const replyToken = event.replyToken as string;
  const userText = (msg.text as string).trim();

  if (!userId || !replyToken || !userText) return;

  const webhookEvent: LineWebhookEvent = {
    botId: config.botId,
    userId,
    replyToken,
    text: userText,
    channel: "line",
  };

  const { reply, escalated } = await handleMessage(webhookEvent, config);
  await replyToLine(reply, replyToken, config.lineChannelAccessToken);

  // Fire-and-forget: log conversation to backend for merchant dashboard
  logConversationToBackend(config.botId, userId, userText, reply, escalated).catch(
    (e) => console.warn("[engine] conversation log failed:", e)
  );
}

// ─── Core message handling pipeline ──────────────────────────────────────────

async function handleMessage(
  event: LineWebhookEvent,
  config: BotConfig
): Promise<{ reply: string; escalated: boolean }> {
  const startMs = Date.now();

  // 1. Load or create customer profile
  const profile = await loadOrCreateProfile(
    config.botId,
    event.userId,
    event.channel
  );

  // 2. Reset session if idle too long
  if (isSessionIdle(profile)) {
    resetSession(profile);
  }

  // 3. Check escalation BEFORE calling LLM (saves a call)
  if (shouldEscalate(event.text, profile)) {
    profile.escalationFlag = true;
    await saveProfile(profile);
    return { reply: buildEscalationMessage(config.botName), escalated: true };
  }

  // 4. Add user turn to buffer
  await addTurn(profile, "user", event.text);

  // 5. Assemble context (system prompt + window + profile + KB)
  const payload = assembleContext(config, profile, event.text);

  // 6. Log token estimate
  const tokenEstimate = estimateTokens(payload);
  console.log(
    `[engine] botId=${config.botId} userId=${event.userId} ` +
    `tokens≈${tokenEstimate} model=${payload.model}`
  );

  // 7. Call Claude
  let reply: string;
  try {
    reply = await callGemini(payload, config.geminiApiKey);
  } catch (err) {
    console.error("[engine] Claude error:", err);
    reply = `ขออภัยนะคะ ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งค่ะ`;
  }

  // 8. Add bot reply to buffer
  await addTurn(profile, "assistant", reply);

  // 9. Passive preference extraction (simple heuristic, non-blocking)
  extractPreferences(event.text, profile);
  await saveProfile(profile);

  const latencyMs = Date.now() - startMs;
  console.log(`[engine] done in ${latencyMs}ms`);

  return { reply, escalated: false };
}

// ─── Log conversation to backend (for merchant dashboard) ────────────────────

async function logConversationToBackend(
  botId: string,
  lineUserId: string,
  userText: string,
  botReply: string,
  escalated = false
): Promise<void> {
  const backendUrl = process.env.BACKEND_URL;
  const internalKey = process.env.INTERNAL_API_KEY;
  if (!backendUrl || !internalKey) return; // not configured, skip silently

  await fetch(`${backendUrl}/api/internal/log`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-key": internalKey,
    },
    body: JSON.stringify({ botId, lineUserId, userText, botReply, escalated }),
  });
}

// ─── Passive preference extraction ───────────────────────────────────────────
// Detect simple preference signals without extra LLM call

const PREFERENCE_PATTERNS: Array<[RegExp, string]> = [
  [/แพ้กุ้ง|ไม่กินกุ้ง/i, "แพ้กุ้ง"],
  [/แพ้แป้งสาลี|celiac/i, "แพ้แป้งสาลี"],
  [/เผ็ดน้อย|ไม่เผ็ด/i, "ชอบเผ็ดน้อย"],
  [/เผ็ดมาก|ชอบเผ็ด/i, "ชอบเผ็ดมาก"],
  [/ไม่ใส่ผัก|ไม่ชอบผัก/i, "ไม่ชอบผัก"],
  [/ไม่ใส่น้ำแข็ง/i, "ไม่ต้องน้ำแข็ง"],
  [/มังสวิรัติ|เจ|vegan/i, "มังสวิรัติ"],
];

function extractPreferences(
  message: string,
  profile: CustomerProfile
): void {
  for (const [pattern, label] of PREFERENCE_PATTERNS) {
    if (pattern.test(message)) {
      addPreference(profile, label);
    }
  }
}
