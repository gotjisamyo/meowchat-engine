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

function buildFlexReply(
  replyToken: string,
  flex: Record<string, unknown>,
  extra?: Record<string, unknown>
) {
  const messages: Record<string, unknown>[] = [flex];
  if (extra) messages.push(extra);
  return { replyToken, messages };
}

// ─── Flex Message: Pricing carousel (Art Oracle brand) ───────────────────────

function flexPricingMsg(): Record<string, unknown> {
  const plans = [
    {
      name: "ทดลองฟรี 14 วัน",
      price: "ฟรี",
      sub: "ไม่ต้องใส่บัตร",
      heroImg: "flex-header-trial.jpg",
      features: ["ครบฟีเจอร์ Starter เต็มรูปแบบ", "ยกเลิกได้ทุกเมื่อ", "ทีมช่วย setup ฟรี"],
      ctaLabel: "🎁 เริ่มทดลองฟรีเลย",
    },
    {
      name: "Starter",
      price: "฿490/เดือน",
      sub: "3,000 ข้อความ",
      heroImg: "flex-header-starter.jpg",
      features: ["AI Auto Reply ภาษาไทย", "Dashboard + Analytics", "ทีมช่วย setup ฟรี"],
      ctaLabel: "เลือกแผนนี้",
    },
    {
      name: "Pro ⭐ ยอดนิยม",
      price: "฿990/เดือน",
      sub: "15,000 ข้อความ",
      heroImg: "flex-header-pro.jpg",
      features: ["Multi-tone + Broadcast", "Human Handoff", "Priority Support"],
      ctaLabel: "เลือกแผนนี้",
    },
    {
      name: "Business",
      price: "฿2,490/เดือน",
      sub: "50,000 ข้อความ",
      heroImg: "flex-header-business.jpg",
      features: ["Team Inbox + CRM", "Support 24/7", "Advanced Analytics"],
      ctaLabel: "เลือกแผนนี้",
    },
  ];

  const FLEX_BASE = `${ASSET_BASE}/flex`;
  const REGISTER_URI = "https://my.meowchat.store/register";

  const bubbles = plans.map((plan) => ({
    type: "bubble",
    size: "kilo",
    hero: {
      type: "image",
      url: `${FLEX_BASE}/${plan.heroImg}`,
      size: "full",
      aspectRatio: "3:1",
      aspectMode: "cover",
    },
    body: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#FFFDF5",
      spacing: "xs",
      paddingAll: "12px",
      contents: [
        { type: "text", text: plan.name, size: "sm", weight: "bold", color: "#6E48AA" },
        { type: "text", text: plan.price, size: "xl", weight: "bold", color: "#1A1A2E" },
        { type: "text", text: plan.sub, size: "xs", color: "#888888", margin: "none" },
        { type: "separator", margin: "sm" },
        ...plan.features.map((f) => ({
          type: "box",
          layout: "horizontal",
          spacing: "sm",
          margin: "xs",
          contents: [
            { type: "text", text: "✓", color: "#6E48AA", size: "xs", flex: 0 },
            { type: "text", text: f, size: "xs", color: "#333333", wrap: true, flex: 1 },
          ],
        })),
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#FFFDF5",
      paddingAll: "10px",
      contents: [
        {
          type: "button",
          action: { type: "uri", label: plan.ctaLabel, uri: REGISTER_URI },
          style: "primary",
          color: "#FFB74D",
          height: "sm",
        },
      ],
    },
  }));

  return {
    type: "flex",
    altText: "ราคาแผน MeowChat: ทดลองฟรี 14 วัน / Starter ฿490 / Pro ฿990 / Business ฿2,490",
    contents: { type: "carousel", contents: bubbles },
  };
}

// ─── Flex Message: Dashboard showcase ────────────────────────────────────────

function flexDashboardMsg(): Record<string, unknown> {
  const DB_BASE = `${ASSET_BASE}/dashboard`;
  const REGISTER_URI = "https://my.meowchat.store/register";

  const screens = [
    {
      img: "03_dashboard.jpg",
      title: "📊 Dashboard",
      desc: "ภาพรวม chat วันนี้ KPI และสถิติทันที",
    },
    {
      img: "08_knowledge.jpg",
      title: "🧠 Knowledge Base",
      desc: "ใส่ข้อมูลร้าน สินค้า FAQ — AI เรียนรู้และตอบแทนคุณ",
    },
    {
      img: "05_analytics.jpg",
      title: "📈 Analytics",
      desc: "กราฟ chat volume, escalation rate, AI performance",
    },
    {
      img: "06_subscription.jpg",
      title: "💳 Subscription",
      desc: "จัดการแผนและ upgrade ได้ตลอดเวลา",
    },
  ];

  const bubbles = screens.map((s) => ({
    type: "bubble",
    size: "kilo",
    hero: {
      type: "image",
      url: `${DB_BASE}/${s.img}`,
      size: "full",
      aspectRatio: "20:13",
      aspectMode: "cover",
      action: { type: "uri", uri: REGISTER_URI },
    },
    body: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#1A1A2E",
      paddingAll: "12px",
      spacing: "xs",
      contents: [
        { type: "text", text: s.title, size: "sm", weight: "bold", color: "#FFB74D" },
        { type: "text", text: s.desc, size: "xs", color: "#CCCCCC", wrap: true },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#1A1A2E",
      paddingAll: "10px",
      contents: [
        {
          type: "button",
          action: { type: "uri", label: "ทดลองใช้ฟรี 14 วัน", uri: REGISTER_URI },
          style: "primary",
          color: "#6E48AA",
          height: "sm",
        },
      ],
    },
  }));

  return {
    type: "flex",
    altText: "ดูระบบหลังบ้าน MeowChat — Dashboard, Analytics, Knowledge Base",
    contents: { type: "carousel", contents: bubbles },
  };
}

// ─── Flex Message: Review carousel (Art Oracle brand) ────────────────────────

function flexReviewMsg(): Record<string, unknown> {
  const reviews = [
    {
      emoji: "🍜",
      name: "คุณแป้ง",
      biz: "เจ้าของร้านอาหาร • กรุงเทพฯ",
      text: "ยอดขายเพิ่มขึ้น 35% ในเดือนแรก บอทตอบลูกค้าได้ครบทุกคำถาม ทั้งเมนู จองโต๊ะ และเดลิเวอรี",
    },
    {
      emoji: "👗",
      name: "คุณมิ้น",
      biz: "ร้านเสื้อผ้าออนไลน์ • เชียงใหม่",
      text: "ประหยัดเวลาไป 4-5 ชั่วโมงต่อวัน บอทตอบแทนได้หมดทุกเรื่อง เอาเวลาไปจัดสต็อกแทนดีกว่า",
    },
    {
      emoji: "💆",
      name: "ดร.พลอย",
      biz: "คลินิกความงาม • นนทบุรี",
      text: "ระบบตรวจสลิปดีมากค่ะ ยืนยันการโอนอัตโนมัติ คนไข้ประทับใจที่ได้รับการยืนยันเร็ว",
    },
  ];

  const REGISTER_URI = "https://my.meowchat.store/register";

  const FLEX_BASE_R = `${ASSET_BASE}/flex`;

  const headerBubble = {
    type: "bubble",
    size: "kilo",
    hero: {
      type: "image",
      url: `${FLEX_BASE_R}/flex-header-reviews.jpg`,
      size: "full",
      aspectRatio: "3:1",
      aspectMode: "cover",
    },
    body: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#FFFDF5",
      paddingAll: "16px",
      justifyContent: "center",
      contents: [
        { type: "text", text: "เสียงจากลูกค้า MeowChat", color: "#6E48AA", size: "md", weight: "bold", align: "center" },
        { type: "text", text: "200+ ร้านค้าทั่วไทย • 4.9/5 ⭐", color: "#888888", size: "sm", align: "center" },
        {
          type: "button",
          action: { type: "uri", label: "ทดลองฟรี 14 วัน", uri: REGISTER_URI },
          style: "primary",
          color: "#FFB74D",
          height: "sm",
          margin: "md",
        },
      ],
    },
  };

  const reviewBubbles = reviews.map((r) => ({
    type: "bubble",
    size: "kilo",
    body: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#FFFDF5",
      spacing: "md",
      paddingAll: "16px",
      contents: [
        { type: "text", text: "⭐⭐⭐⭐⭐", size: "sm" },
        {
          type: "text",
          text: `"${r.text}"`,
          size: "sm",
          color: "#333333",
          wrap: true,
          margin: "sm",
        },
        {
          type: "box",
          layout: "horizontal",
          spacing: "sm",
          margin: "md",
          contents: [
            { type: "text", text: r.emoji, size: "xl", flex: 0 },
            {
              type: "box",
              layout: "vertical",
              flex: 1,
              contents: [
                { type: "text", text: r.name, size: "sm", weight: "bold", color: "#6E48AA" },
                { type: "text", text: r.biz, size: "xxs", color: "#888888", wrap: true },
              ],
            },
          ],
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#FFFDF5",
      paddingAll: "12px",
      contents: [
        {
          type: "button",
          action: { type: "uri", label: "อยากมีบอทแบบนี้!", uri: REGISTER_URI },
          style: "primary",
          color: "#FFB74D",
          height: "sm",
        },
      ],
    },
  }));

  return {
    type: "flex",
    altText: "เสียงจากลูกค้า MeowChat — 200+ ร้านค้าทั่วไทย คะแนน 4.9/5",
    contents: { type: "carousel", contents: [headerBubble, ...reviewBubbles] },
  };
}

async function sendPush(userId: string, messages: Record<string, unknown>[], accessToken: string): Promise<void> {
  await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ to: userId, messages }),
  });
}

async function sendReply(payload: object, accessToken: string): Promise<void> {
  const body = JSON.stringify(payload);
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body,
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`[platform] reply failed ${res.status}: ${err}`);
  } else {
    const p = payload as { messages?: { type: string }[] };
    const types = p.messages?.map((m) => m.type).join(",") ?? "?";
    console.log(`[platform] reply OK types=[${types}]`);
  }
}

// ─── Static responses for rich menu buttons ───────────────────────────────────

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
    await sendReply(buildFlexReply(replyToken, flexPricingMsg()), token);
    return;
  }

  if (t === "เหมียวแชทคืออะไร" || t === "meowchat คืออะไร" || t === "คืออะไร") {
    // Show about text + dashboard screenshots proactively (no need to ask)
    await sendReply(
      {
        replyToken,
        messages: [
          imgMsg("hero.jpg"),
          textMsg(ABOUT_MESSAGE, [
            { label: "🎮 ดูตัวอย่าง", text: "ดูตัวอย่าง" },
            { label: "💰 ดูราคา", text: "ราคา" },
            { label: "🚀 ทดลองฟรี 14 วัน", text: "ทดลองฟรี" },
          ]),
        ],
      },
      token
    );
    // Send dashboard flex as follow-up push (LINE allows 5 msgs per reply — use push for 2nd batch)
    // Actually send as 2nd reply via push message
    await sendPush(userId, [flexDashboardMsg()], token);
    return;
  }

  if (t === "รีวิวจากลูกค้า" || t === "รีวิว") {
    await sendReply(buildFlexReply(replyToken, flexReviewMsg()), token);
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

  if (t === "ดูแดชบอร์ด" || t === "ระบบหลังบ้าน" || t === "ดูระบบ" || t.includes("dashboard")) {
    await sendReply(buildFlexReply(replyToken, flexDashboardMsg()), token);
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
