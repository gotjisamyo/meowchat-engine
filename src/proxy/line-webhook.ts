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
import { callGemini, analyzeSlipImage } from "../engine/gemini-client.js";
import { scanSlipQR } from "../engine/qr-scanner.js";
import { getBotConfig } from "./bot-registry.js";
import { processPlatformEvent } from "./platform-handler.js";

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
  accessToken: string,
  quickReplies?: Array<{ label: string; text: string }>
): Promise<void> {
  const textMessage: Record<string, unknown> = { type: "text", text: message };

  if (quickReplies && quickReplies.length > 0) {
    textMessage.quickReply = {
      items: quickReplies.slice(0, 13).map((qr) => ({
        type: "action",
        action: {
          type: "message",
          label: qr.label,
          text: qr.text,
        },
      })),
    };
  }

  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [textMessage],
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
      config.botId === "meowchat-platform"
        ? processPlatformEvent(event, config)
        : processLineEvent(event, config)
    )
  );

  return c.json({ ok: true });
}

// ─── Process a single LINE event ─────────────────────────────────────────────

// Map non-text LINE message types to a natural Thai prompt for the LLM
function nonTextToPrompt(msgType: string): string | null {
  switch (msgType) {
    case "image":
      return "ลูกค้าส่งรูปภาพมา (ระบบยังไม่รองรับการอ่านรูป) — ตอบอย่างเป็นมิตรว่าเห็นรูปแล้ว ขอให้ลูกค้าพิมพ์อธิบายเพิ่มเติมได้เลย";
    case "sticker":
      return "ลูกค้าส่ง sticker มา — ทักทายตอบกลับอย่างเป็นมิตรสั้นๆ";
    case "audio":
    case "video":
      return `ลูกค้าส่ง${msgType === "audio" ? "เสียง" : "วิดีโอ"}มา — แจ้งอย่างสุภาพว่ายังไม่รองรับ${msgType === "audio" ? "เสียง" : "วิดีโอ"} ขอให้พิมพ์แทน`;
    case "location":
      return "ลูกค้าส่งตำแหน่งที่อยู่มา — ตอบอย่างเป็นมิตรว่าได้รับตำแหน่งแล้ว และถามว่าต้องการให้ช่วยอะไร";
    case "file":
      return "ลูกค้าส่งไฟล์มา — แจ้งว่าได้รับไฟล์แล้ว ขอให้พิมพ์อธิบายว่าต้องการอะไร";
    default:
      return null;
  }
}

// ─── Download image from LINE Content API ────────────────────────────────────

async function downloadLineImage(
  messageId: string,
  accessToken: string
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const res = await fetch(
      `https://api-data.line.me/v2/bot/message/${messageId}/content`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const mimeType = contentType.split(";")[0].trim();
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    return { base64, mimeType };
  } catch {
    return null;
  }
}

// ─── Notify backend to create a slip order ───────────────────────────────────

async function notifySlipOrder(
  botId: string,
  lineUserId: string,
  slipData: { amount: number | null; date: string | null; refNumber: string | null; bankName: string | null },
  mode: "auto" | "manual"
): Promise<void> {
  const backendUrl = process.env.BACKEND_URL;
  const internalKey = process.env.INTERNAL_API_KEY;
  if (!backendUrl || !internalKey) return;

  await fetch(`${backendUrl}/api/internal/slip-order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-key": internalKey,
    },
    body: JSON.stringify({ botId, lineUserId, ...slipData, mode }),
  });
}

async function processLineEvent(
  event: Record<string, unknown>,
  config: BotConfig
): Promise<void> {
  if (event.type !== "message") return;
  const msg = event.message as Record<string, unknown>;

  const userId = (event.source as Record<string, string>)?.userId;
  const replyToken = event.replyToken as string;
  if (!userId || !replyToken) return;

  // ─── Handle image messages with slip detection ────────────────────────────
  if (msg?.type === "image" && config.slipVerifyMode && config.slipVerifyMode !== "off") {
    const imageData = await downloadLineImage(msg.id as string, config.lineChannelAccessToken);
    if (imageData) {
      try {
        // ── 1. Try QR scan first (free, no API cost) ──────────────────────
        const qrData = await scanSlipQR(imageData.base64);
        let slip;

        if (qrData && qrData.amount !== null) {
          // QR scan success — skip Gemini Vision call entirely
          console.log(`[engine] QR slip: amount=${qrData.amount} ref=${qrData.refNumber}`);
          slip = {
            isSlip: true,
            amount: qrData.amount,
            date: null,
            refNumber: qrData.refNumber,
            bankName: qrData.bankCode,
            confidence: "high" as const,
          };
        } else {
          // ── 2. Fallback: Gemini Vision (~฿0.005/image) ────────────────────
          console.log("[engine] no QR found, falling back to Gemini Vision");
          slip = await analyzeSlipImage(imageData.base64, imageData.mimeType, config.geminiApiKey);
        }

        if (slip.isSlip && slip.confidence !== "low") {
          const mode = config.slipVerifyMode; // "auto" | "manual"

          // Notify backend to record slip order
          notifySlipOrder(config.botId, userId, {
            amount: slip.amount,
            date: slip.date,
            refNumber: slip.refNumber,
            bankName: slip.bankName,
          }, mode).catch((e) => console.warn("[engine] slip order notify failed:", e));

          let replyText: string;
          if (mode === "auto") {
            const amountText = slip.amount ? `฿${slip.amount.toLocaleString()}` : "ไม่ทราบจำนวน";
            replyText =
              `✅ ได้รับสลิปการโอนเงินแล้วค่ะ\n` +
              `💰 จำนวน: ${amountText}\n` +
              (slip.bankName ? `🏦 ธนาคาร: ${slip.bankName}\n` : "") +
              (slip.refNumber ? `📋 เลขอ้างอิง: ${slip.refNumber}\n` : "") +
              `\n✨ ระบบบันทึกข้อมูลเรียบร้อยแล้ว ทีมงานจะดำเนินการให้ค่ะ ขอบคุณที่ใช้บริการ 🐱`;
          } else {
            // manual mode — notify merchant to verify
            replyText =
              `📨 ได้รับสลิปแล้วค่ะ กำลังแจ้งทีมงานให้ตรวจสอบ\n` +
              `⏳ กรุณารอสักครู่ ทีมงานจะยืนยันการโอนเงินให้ค่ะ 🐱`;
          }

          await replyToLine(replyToken, replyText, config.lineChannelAccessToken);
          logConversationToBackend(config.botId, userId, "[ส่งสลิปโอนเงิน]", replyText, false).catch(
            (e) => console.warn("[engine] conversation log failed:", e)
          );
          return;
        }
      } catch (err) {
        console.warn("[engine] slip analysis failed:", err);
        // fall through to generic image handling
      }
    }
  }

  let userText: string;

  if (msg?.type === "text") {
    userText = ((msg.text as string) ?? "").trim();
    if (!userText) return;
  } else {
    // Non-text message — convert to a descriptive prompt so the LLM can respond naturally
    const syntheticPrompt = nonTextToPrompt(msg?.type as string);
    if (!syntheticPrompt) return; // unknown type — skip silently
    userText = syntheticPrompt;
  }

  const webhookEvent: LineWebhookEvent = {
    botId: config.botId,
    userId,
    replyToken,
    text: userText,
    channel: "line",
  };

  const { reply, escalated } = await handleMessage(webhookEvent, config);
  const qr = !escalated && config.quickReplies?.length ? config.quickReplies : undefined;
  await replyToLine(replyToken, reply, config.lineChannelAccessToken, qr);

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

  // 4. Assemble context BEFORE adding current turn — window must not include
  //    the current user message (assembleContext appends it itself)
  const payload = assembleContext(config, profile, event.text);

  // 6. Log token estimate
  const tokenEstimate = estimateTokens(payload);
  console.log(
    `[engine] botId=${config.botId} userId=${event.userId} ` +
    `tokens≈${tokenEstimate} model=${payload.model}`
  );

  // 7. Check if bot is locked (trial expired, no payment)
  if (config.botLocked) {
    return {
      reply: `ขออภัยนะคะ 🐱 บริการชั่วคราวหยุดทำงาน\nเจ้าของร้านสามารถต่ออายุได้ที่ my.meowchat.store`,
      escalated: false,
    };
  }

  // 8. Call Gemini
  let reply: string;
  try {
    reply = await callGemini(payload, config.geminiApiKey);
  } catch (err) {
    console.error("[engine] Claude error:", err);
    reply = `ขออภัยนะคะ ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งค่ะ`;
  }

  // 9. Add both turns to buffer (without branding — keeps history clean for LLM)
  await addTurn(profile, "user", event.text);
  await addTurn(profile, "assistant", reply);

  // 10. Append MeowChat branding AFTER buffering (trial/free plans only)
  if (config.showBranding !== false && config.subscriptionStatus !== "active") {
    reply += `\n\n🐱 ขับเคลื่อนโดย MeowChat`;
  }

  // 11. Passive preference extraction (simple heuristic, non-blocking)
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
