// ─── MeowChat Platform LINE OA Handler ───────────────────────────────────────
// Handles conversations with potential customers (sales funnel)

import type { BotConfig } from "../types/index.js";
import { redis } from "../memory/redis.js";
import {
  type BusinessType,
  type PlatformUserState,
  detectBusinessType,
  getDemoMessage,
  getCTAMessage,
  WELCOME_MESSAGE,
  WELCOME_QUICK_REPLIES,
  STATS_MESSAGE,
} from "../engine/platform-demo.js";

const STATE_TTL = 60 * 60 * 24 * 30; // 30 days

// ─── State helpers ────────────────────────────────────────────────────────────

async function getState(userId: string): Promise<PlatformUserState | null> {
  try {
    const raw = await redis.get(`platform:state:${userId}`);
    return raw ? (JSON.parse(raw) as PlatformUserState) : null;
  } catch {
    return null;
  }
}

async function setState(userId: string, state: PlatformUserState): Promise<void> {
  try {
    state.lastMessageAt = new Date().toISOString();
    await redis.set(`platform:state:${userId}`, JSON.stringify(state), "EX", STATE_TTL);
  } catch {
    // Redis failure — non-fatal
  }
}

// ─── Build LINE reply payload ─────────────────────────────────────────────────

function buildReply(
  replyToken: string,
  text: string,
  quickReplies?: Array<{ label: string; text: string }>
) {
  const message: Record<string, unknown> = { type: "text", text };
  if (quickReplies?.length) {
    message.quickReply = {
      items: quickReplies.map((qr) => ({
        type: "action",
        action: { type: "message", label: qr.label, text: qr.text },
      })),
    };
  }
  return { replyToken, messages: [message] };
}

async function sendReply(payload: object, accessToken: string): Promise<void> {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });
}

// ─── Main platform event handler ─────────────────────────────────────────────

export async function processPlatformEvent(
  event: Record<string, unknown>,
  config: BotConfig
): Promise<void> {
  if (event.type !== "message") return;
  const msg = event.message as Record<string, unknown>;
  if (msg?.type !== "text") return;

  const userId = (event.source as Record<string, string>)?.userId;
  const replyToken = event.replyToken as string;
  if (!userId || !replyToken) return;

  const text = ((msg.text as string) ?? "").trim();
  const lowerText = text.toLowerCase();
  const token = config.lineChannelAccessToken;

  // Load user state
  let state = await getState(userId);

  // ── Commands available anytime ────────────────────────────────────────────
  if (lowerText === "ราคา" || lowerText.includes("ราคา") || lowerText.includes("แผน")) {
    await sendReply(buildReply(replyToken, STATS_MESSAGE), token);
    return;
  }

  if (lowerText === "สมัคร" || lowerText.includes("สมัคร") || lowerText.includes("ทดลอง")) {
    const reply = `ยินดีมากเลยค่ะ! 🎉\n\nสมัครทดลองใช้ฟรี 14 วันได้เลยที่:\n👉 https://my.meowchat.store/register\n\nหรือฝากเบอร์โทรไว้ได้เลยค่ะ ทีมงานจะโทรกลับช่วยตั้งค่าให้ภายใน 1 ชั่วโมงค่ะ 😊`;
    await sendReply(buildReply(replyToken, reply), token);
    if (state) {
      state.stage = "registered";
      await setState(userId, state);
    }
    return;
  }

  // ── New user / no state ────────────────────────────────────────────────────
  if (!state || state.stage === "new") {
    const now = new Date().toISOString();
    state = { stage: "asked_type", firstSeenAt: now, lastMessageAt: now };
    await setState(userId, state);
    await sendReply(
      buildReply(replyToken, WELCOME_MESSAGE, WELCOME_QUICK_REPLIES),
      token
    );
    return;
  }

  // ── Waiting for business type ─────────────────────────────────────────────
  if (state.stage === "asked_type") {
    const bizType = detectBusinessType(text);
    const resolvedType: BusinessType = bizType ?? "other";
    state.businessType = resolvedType;
    state.stage = "demo_shown";
    await setState(userId, state);

    const demoMsg = getDemoMessage(resolvedType);
    await sendReply(
      buildReply(replyToken, demoMsg, [
        { label: "🚀 อยากมีบอทแบบนี้!", text: "สมัคร" },
        { label: "💰 ดูราคา", text: "ราคา" },
        { label: "❓ ถามเพิ่มเติม", text: "ถามเพิ่มเติม" },
      ]),
      token
    );
    return;
  }

  // ── After demo shown ──────────────────────────────────────────────────────
  if (state.stage === "demo_shown") {
    const bizType = state.businessType ?? "other";
    state.stage = "cta_sent";
    await setState(userId, state);
    await sendReply(
      buildReply(replyToken, getCTAMessage(bizType), [
        { label: "✅ สมัครเลย!", text: "สมัคร" },
        { label: "🔄 ดู demo อีกครั้ง", text: "ดูตัวอย่าง" },
      ]),
      token
    );
    return;
  }

  // ── CTA sent / return user ────────────────────────────────────────────────
  if (lowerText.includes("ดูตัวอย่าง") || lowerText.includes("demo")) {
    const bizType = state.businessType ?? "other";
    state.stage = "demo_shown";
    await setState(userId, state);
    await sendReply(
      buildReply(replyToken, getDemoMessage(bizType), [
        { label: "🚀 สมัครเลย!", text: "สมัคร" },
        { label: "💰 ดูราคา", text: "ราคา" },
      ]),
      token
    );
    return;
  }

  // ── Fallback: Gemini answers questions about MeowChat ─────────────────────
  // For general questions, use Gemini with a MeowChat sales system prompt
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(config.geminiApiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const systemContext = `คุณคือน้องแมว บอทของ MeowChat — บริการ AI Chatbot LINE OA สำหรับธุรกิจไทย
ราคาเริ่มต้น ฿199/เดือน ทดลองฟรี 14 วัน ไม่ต้องใส่บัตรเครดิต
สมัครที่ my.meowchat.store/register
ตอบสั้น เป็นมิตร ใช้ emoji บ้าง ภาษาไทย พยายามโน้มน้าวให้ลูกค้าสมัครทดลองใช้`;

  try {
    const result = await model.generateContent(`${systemContext}\n\nลูกค้าถาม: ${text}`);
    const reply = result.response.text().trim();
    await sendReply(
      buildReply(replyToken, reply, [
        { label: "🚀 ทดลองฟรี 14 วัน", text: "สมัคร" },
        { label: "💰 ดูราคา", text: "ราคา" },
      ]),
      token
    );
  } catch {
    await sendReply(
      buildReply(
        replyToken,
        "ขอโทษค่ะ มีปัญหาชั่วคราว พิมพ์ 'สมัคร' เพื่อทดลองฟรีได้เลยค่ะ 🐱"
      ),
      token
    );
  }
}
