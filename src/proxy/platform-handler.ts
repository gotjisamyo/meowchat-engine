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

// ─── Asset base URL ───────────────────────────────────────────────────────────

const ASSET_BASE = "https://meowchat-engine-production.up.railway.app/assets";

// ─── Build LINE reply payload ─────────────────────────────────────────────────

function imgMsg(filename: string): Record<string, unknown> {
  const url = `${ASSET_BASE}/${filename}`;
  return { type: "image", originalContentUrl: url, previewImageUrl: url };
}

function textMsg(
  text: string,
  quickReplies?: Array<{ label: string; text: string }>
): Record<string, unknown> {
  const msg: Record<string, unknown> = { type: "text", text };
  if (quickReplies?.length) {
    msg.quickReply = {
      items: quickReplies.map((qr) => ({
        type: "action",
        action: { type: "message", label: qr.label, text: qr.text },
      })),
    };
  }
  return msg;
}

function buildReply(
  replyToken: string,
  text: string,
  quickReplies?: Array<{ label: string; text: string }>
) {
  return { replyToken, messages: [textMsg(text, quickReplies)] };
}

function buildReplyWithImages(
  replyToken: string,
  images: string[],
  text: string,
  quickReplies?: Array<{ label: string; text: string }>
) {
  // LINE allows max 5 messages per reply
  const messages: Record<string, unknown>[] = [
    ...images.slice(0, 4).map(imgMsg),
    textMsg(text, quickReplies),
  ];
  return { replyToken, messages };
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

// ─── Static responses for rich menu buttons ───────────────────────────────────

const PRICING_MESSAGE = `💰 ราคาแผน MeowChat

🎁 ทดลองฟรี 14 วัน — ไม่ต้องใส่บัตร
• ครบฟีเจอร์ Starter เต็มรูปแบบ
• เริ่มได้เลยที่ my.meowchat.store

🚀 Starter — ฿490/เดือน
• 3,000 ข้อความ/เดือน
• AI Auto Reply ภาษาไทย · ปรับบุคลิกได้
• LINE OA · Dashboard + Analytics
• ช่วย setup ผ่านกลุ่ม LINE ฟรี

⭐ Pro — ฿990/เดือน ⭐ยอดนิยม
• 15,000 ข้อความ/เดือน
• Multi-tone · Product Catalog
• Human Handoff + Analytics เต็มรูปแบบ
• Broadcast · Priority Support

💼 Business — ฿2,490/เดือน
• 50,000 ข้อความ/เดือน
• Team Inbox · CRM Integration
• Priority Support 24/7

👑 Enterprise — ราคาพิเศษ ติดต่อทีม
• ข้อความไม่จำกัด
• Custom AI + SLA + Dedicated Support

✅ ยกเลิกได้ทุกเมื่อ ไม่มีสัญญา`;

const ABOUT_MESSAGE = `🐱 MeowChat คืออะไร?

MeowChat คือระบบ AI Chatbot สำหรับ LINE OA ของธุรกิจไทย ที่ช่วยตอบลูกค้าแทนคุณได้ตลอด 24 ชั่วโมง โดยไม่ต้องจ้างพนักงานมานั่งตอบแชท

🔥 ฟีเจอร์หลัก:
• ตอบคำถามลูกค้าอัตโนมัติ — AI เรียนรู้จากข้อมูลร้านคุณ
• ตรวจสลิปโอนเงิน — อ่านสลิปแล้วยืนยันออเดอร์ได้ทันที
• Broadcast — ส่งโปรโมชั่นหาลูกค้าทุกคนในคลิกเดียว
• Quick Reply — ปุ่มคำตอบด่วนให้ลูกค้ากด สะดวก ไม่ต้องพิมพ์
• ความจำลูกค้า — จำประวัติการสั่ง บุคลิก และความชอบของแต่ละคน

💡 เหมาะกับ: ร้านอาหาร, ร้านออนไลน์, คลินิก, ร้านความงาม และธุรกิจบริการทุกประเภท

⚡ ตั้งค่าง่าย ไม่ต้องมีความรู้ด้าน IT — ทีมงานช่วย setup ให้ฟรี`;

const REVIEW_MESSAGE = `⭐ เสียงจากลูกค้า MeowChat

━━━━━━━━━━━━━━━━━━━━━━
🍜 คุณแป้ง — เจ้าของร้านอาหาร (กรุงเทพฯ)
⭐⭐⭐⭐⭐
"ก่อนใช้ MeowChat ต้องนั่งตอบแชทเองทุกวัน ตอนนี้บอทจัดการให้หมดเลย ลูกค้าถามเรื่องเมนู จองโต๊ะ เดลิเวอรี บอทตอบได้ครบ ยอดขายเพิ่มขึ้น 35% ในเดือนแรก"

━━━━━━━━━━━━━━━━━━━━━━
👗 คุณมิ้น — ร้านเสื้อผ้าออนไลน์ (เชียงใหม่)
⭐⭐⭐⭐⭐
"ลูกค้าถามเรื่อง size และราคาตลอด ตอนนี้บอทตอบแทนได้หมด ประหยัดเวลาไปได้ 4–5 ชั่วโมงต่อวัน เอาเวลาไปจัดสต็อกแทนดีกว่า"

━━━━━━━━━━━━━━━━━━━━━━
💆 ดร. พลอย — คลินิกความงาม (นนทบุรี)
⭐⭐⭐⭐⭐
"ระบบตรวจสลิปดีมากค่ะ ก่อนหน้านี้ต้องเช็คเองทีละอัน ตอนนี้บอทยืนยันการโอนให้อัตโนมัติ คนไข้ก็ประทับใจที่ได้รับการยืนยันเร็ว"

━━━━━━━━━━━━━━━━━━━━━━
มากกว่า 200 ร้านค้าทั่วไทยใช้ MeowChat แล้ว 🏆`;

const CONTACT_MESSAGE = `📞 คุยกับทีมงาน MeowChat

สวัสดีค่ะ! ยินดีให้คำปรึกษาฟรีทุกวัน 😊

💬 ช่องทางติดต่อ:
• LINE Official: @meowchat
• Email: hello@meowchat.store
• เว็บไซต์: meowchat.store

⏰ เวลาทำการ: จันทร์–ศุกร์ 9:00–18:00 น.

📲 หรือฝากเบอร์โทรไว้ได้เลยนะคะ ทีมงานจะโทรกลับภายใน 1 ชั่วโมง (ในเวลาทำการ) เพื่อช่วยแนะนำและ setup ให้ฟรีค่ะ

ไม่มีข้อผูกมัด ปรึกษาฟรี 100% ค่ะ 🐱`;

// ─── Gemini system prompt ─────────────────────────────────────────────────────

const MEOWCHAT_SYSTEM_PROMPT = `คุณคือ "น้องแมว" — AI Sales Assistant ของ MeowChat บริการ AI Chatbot LINE OA สำหรับธุรกิจไทย

=== ข้อมูล MeowChat ===
- บริการ: ระบบ AI Chatbot สำหรับ LINE Official Account ของธุรกิจไทย
- จุดเด่น: ตอบลูกค้าอัตโนมัติ 24 ชั่วโมง ไม่ต้องจ้างคนนั่งตอบแชท

ฟีเจอร์หลัก:
1. AI ตอบคำถาม — เรียนรู้จากข้อมูลร้านค้า ตอบได้ทุกคำถาม
2. ตรวจสลิป — อ่านและยืนยันการโอนเงินอัตโนมัติ
3. Broadcast — ส่งข้อความหาลูกค้าทุกคนพร้อมกัน
4. Quick Reply — ปุ่มคำตอบด่วน
5. ความจำลูกค้า — จำประวัติและความชอบของแต่ละคน

ราคา:
- ทดลองฟรี 14 วัน — ไม่ต้องใส่บัตร ครบฟีเจอร์ Starter
- Starter: ฿490/เดือน — 3,000 ข้อความ
- Pro: ฿990/เดือน — 15,000 ข้อความ ⭐ยอดนิยม
- Business: ฿2,490/เดือน — 50,000 ข้อความ, Team Inbox, CRM
- Enterprise: ราคาพิเศษ (ติดต่อทีม) — ไม่จำกัด, Custom AI, SLA

สมัคร: my.meowchat.store/register
ติดต่อ: hello@meowchat.store / LINE: @meowchat

=== วิธีตอบ ===
- ตอบเป็นภาษาไทย สุภาพ เป็นกันเอง เหมือนพนักงาน Sales มืออาชีพ
- ตอบตรงประเด็น ให้รายละเอียดที่เป็นประโยชน์ ไม่สั้นเกินไป
- ใช้ emoji พอประมาณ ไม่มากเกินไป
- ถ้าถามเรื่องราคา ให้บอกราคาชัดเจน
- ถ้าถามเรื่องฟีเจอร์ ให้อธิบายว่าทำอะไรได้บ้าง
- ปิดท้ายด้วยการชวนทดลองใช้ฟรีเสมอ แต่ไม่ต้องกดดัน
- ห้ามพูดเรื่องที่ไม่เกี่ยวกับ MeowChat หรือตอบคำถามทั่วไป`;

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
  const t = text.toLowerCase();
  const token = config.lineChannelAccessToken;

  console.log(`[platform] received: "${text}" from userId=${userId.slice(0, 8)}`);

  let state = await getState(userId);

  // ── Rich menu buttons — highest priority, always respond correctly ──────────

  if (t === "ราคา" || t === "ราคาและแผน" || t === "ราคา / แผน") {
    await sendReply(
      buildReplyWithImages(
        replyToken,
        ["pricing.jpg"],
        PRICING_MESSAGE,
        [
          { label: "🚀 ทดลองฟรี 14 วัน", text: "ทดลองฟรี" },
          { label: "🎮 ดูตัวอย่าง", text: "ดูตัวอย่าง" },
          { label: "📞 คุยกับทีม", text: "ติดต่อทีม" },
        ]
      ),
      token
    );
    return;
  }

  if (t === "เหมียวแชทคืออะไร" || t === "meowchat คืออะไร" || t === "คืออะไร") {
    await sendReply(
      buildReplyWithImages(
        replyToken,
        ["hero.jpg", "features.jpg"],
        ABOUT_MESSAGE,
        [
          { label: "🎮 ดูตัวอย่าง", text: "ดูตัวอย่าง" },
          { label: "💰 ดูราคา", text: "ราคา" },
          { label: "🚀 ทดลองฟรี", text: "ทดลองฟรี" },
        ]
      ),
      token
    );
    return;
  }

  if (t === "รีวิวจากลูกค้า" || t === "รีวิว") {
    await sendReply(
      buildReplyWithImages(replyToken, ["reviews.jpg"], REVIEW_MESSAGE, [
        { label: "🚀 ทดลองฟรีเลย!", text: "ทดลองฟรี" },
        { label: "💰 ดูราคา", text: "ราคา" },
      ]),
      token
    );
    return;
  }

  if (t === "ติดต่อทีม" || t === "คุยกับทีมงาน") {
    await sendReply(
      buildReply(replyToken, CONTACT_MESSAGE, [
        { label: "🚀 ทดลองฟรี 14 วัน", text: "ทดลองฟรี" },
        { label: "💰 ดูราคา", text: "ราคา" },
      ]),
      token
    );
    return;
  }

  if (t === "ทดลองฟรี" || t === "ทดลองฟรีสิบสี่วัน" || t === "สมัคร") {
    const reply =
      `ยินดีมากเลยค่ะ! 🎉\n\n` +
      `สมัครทดลองใช้ฟรี 14 วันได้เลยที่:\n` +
      `👉 https://my.meowchat.store/register\n\n` +
      `ไม่ต้องใส่บัตรเครดิต ยกเลิกได้ทุกเมื่อ\n\n` +
      `หรือฝากเบอร์โทรไว้ได้เลยค่ะ ทีมงานจะโทรกลับภายใน 1 ชั่วโมงเพื่อช่วย setup ให้ฟรีค่ะ 😊`;
    await sendReply(buildReply(replyToken, reply), token);
    if (state) {
      state.stage = "registered";
      await setState(userId, state);
    }
    return;
  }

  if (t === "ดูตัวอย่าง" || t.includes("demo")) {
    // Show demo based on known business type, or ask first
    const bizType = state?.businessType ?? null;
    if (bizType) {
      await sendReply(
        buildReplyWithImages(
          replyToken,
          ["chatdemo.jpg", "usecases.jpg"],
          getDemoMessage(bizType),
          [
            { label: "🚀 สมัครเลย!", text: "ทดลองฟรี" },
            { label: "💰 ดูราคา", text: "ราคา" },
          ]
        ),
        token
      );
    } else {
      // Ask business type first
      const now = new Date().toISOString();
      state = state ?? { stage: "asked_type", firstSeenAt: now, lastMessageAt: now };
      state.stage = "asked_type";
      await setState(userId, state);
      await sendReply(
        buildReply(
          replyToken,
          `ขอถามก่อนนะคะ เพื่อให้ดูตัวอย่างที่ตรงกับธุรกิจของคุณ 😊\n\nร้านหรือธุรกิจของคุณเป็นประเภทไหนคะ?`,
          WELCOME_QUICK_REPLIES
        ),
        token
      );
    }
    return;
  }

  // ── New user ───────────────────────────────────────────────────────────────

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

    await sendReply(
      buildReply(replyToken, getDemoMessage(resolvedType), [
        { label: "🚀 อยากมีบอทแบบนี้!", text: "ทดลองฟรี" },
        { label: "💰 ดูราคา", text: "ราคา" },
        { label: "❓ ถามเพิ่มเติม", text: "ถามเพิ่มเติม" },
      ]),
      token
    );
    return;
  }

  // ── After demo ────────────────────────────────────────────────────────────

  if (state.stage === "demo_shown") {
    const bizType = state.businessType ?? "other";
    state.stage = "cta_sent";
    await setState(userId, state);
    await sendReply(
      buildReply(replyToken, getCTAMessage(bizType), [
        { label: "✅ สมัครเลย!", text: "ทดลองฟรี" },
        { label: "💰 ดูราคา", text: "ราคา" },
        { label: "📞 คุยกับทีม", text: "ติดต่อทีม" },
      ]),
      token
    );
    return;
  }

  // ── Fallback: Gemini with detailed MeowChat knowledge ─────────────────────

  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(config.geminiApiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  try {
    const result = await model.generateContent(
      `${MEOWCHAT_SYSTEM_PROMPT}\n\n=== ลูกค้าถาม ===\n${text}`
    );
    const reply = result.response.text().trim();
    await sendReply(
      buildReply(replyToken, reply, [
        { label: "🚀 ทดลองฟรี 14 วัน", text: "ทดลองฟรี" },
        { label: "💰 ดูราคา", text: "ราคา" },
        { label: "📞 คุยกับทีม", text: "ติดต่อทีม" },
      ]),
      token
    );
  } catch {
    await sendReply(
      buildReply(
        replyToken,
        "ขอโทษค่ะ ระบบมีปัญหาชั่วคราว กรุณาลองใหม่อีกครั้ง หรือติดต่อทีมงานได้เลยที่ LINE: @meowchat ค่ะ 🐱",
        [{ label: "📞 ติดต่อทีม", text: "ติดต่อทีม" }]
      ),
      token
    );
  }
}
