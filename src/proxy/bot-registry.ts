import type { BotConfig } from "../types/index.js";
import { redis } from "../memory/redis.js";

// ─── In-memory fallback (survives Redis hiccups within the same process) ──────
const memCache = new Map<string, BotConfig>();

// ─── Bot registry (Redis primary, in-memory fallback) ─────────────────────────

export async function getBotConfig(botId: string): Promise<BotConfig | null> {
  // 1. Try Redis first
  try {
    const raw = await redis.get(`botconfig:${botId}`);
    if (raw) {
      const config = JSON.parse(raw) as BotConfig;
      memCache.set(botId, config); // keep in-memory in sync
      return config;
    }
  } catch (err) {
    console.warn("[registry] Redis get failed, using memCache:", (err as Error).message);
  }
  // 2. Fallback to in-memory
  return memCache.get(botId) ?? null;
}

export function listBotIds(): string[] {
  return Array.from(memCache.keys());
}

export async function saveBotConfig(config: BotConfig): Promise<void> {
  // 1. Always write to in-memory immediately
  memCache.set(config.botId, config);
  // 2. Try Redis (non-blocking on failure)
  try {
    await redis.set(`botconfig:${config.botId}`, JSON.stringify(config));
    console.log(`[registry] saved botId=${config.botId} to Redis + memCache`);
  } catch (err) {
    console.warn(`[registry] Redis set failed for botId=${config.botId}, memCache only:`, (err as Error).message);
  }
}

// ─── Example: register a demo bot (call this once during setup) ───────────────

export async function registerDemoBot(): Promise<void> {
  const demo: BotConfig = {
    botId: "demo-bot-001",
    botName: "น้องแมว",
    businessName: "ร้านข้าวแม่มณี",
    personalityMode: "friendly",
    businessScope: [
      "เมนูอาหาร ราคา วัตถุดิบ",
      "รับออเดอร์และจัดส่ง",
      "เวลาทำการและที่อยู่ร้าน",
      "โปรโมชั่นและส่วนลด",
    ],
    lineChannelSecret: process.env.LINE_CHANNEL_SECRET ?? "",
    lineChannelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
    geminiApiKey: process.env.GEMINI_API_KEY ?? "",
    model: "gemini-2.0-flash",
    knowledgeBase: [
      {
        id: "menu-001",
        topic: "เมนูอาหาร",
        content:
          "ข้าวผัดหมู ฿80 · ข้าวกะเพราไข่ดาว ฿75 · ข้าวมันไก่ ฿70 · " +
          "ผัดไทยกุ้งสด ฿90 · ต้มยำกุ้ง ฿120 · แกงเขียวหวาน ฿85",
        keywords: ["เมนู", "อาหาร", "ข้าว", "ผัด", "กะเพรา", "มันไก่"],
      },
      {
        id: "delivery-001",
        topic: "จัดส่ง",
        content:
          "จัดส่งในรัศมี 5 กม. ค่าส่ง ฿20 หรือฟรีเมื่อสั่งครบ ฿200 " +
          "รับออเดอร์ถึง 20:00 น. จัดส่งประมาณ 30–45 นาที",
        keywords: ["ส่ง", "จัดส่ง", "delivery", "ค่าส่ง", "รับที่ร้าน"],
      },
      {
        id: "hours-001",
        topic: "เวลาทำการ",
        content:
          "เปิดทุกวัน 08:00–21:00 น. หยุดวันพุธ " +
          "ที่อยู่: 123 ถ.สุขุมวิท ซ.11 กรุงเทพฯ โทร 02-123-4567",
        keywords: ["เปิด", "ปิด", "เวลา", "วัน", "ที่อยู่", "โทร"],
      },
      {
        id: "promo-001",
        topic: "โปรโมชั่น",
        content:
          "ลูกค้าใหม่รับส่วนลด 10% เมื่อสั่งครั้งแรก ใช้โค้ด NEWMAE " +
          "สั่งครบ 3 เมนูรับน้ำดื่มฟรี 1 ขวด",
        keywords: ["โปร", "ส่วนลด", "ลด", "โค้ด", "ฟรี", "โปรโมชั่น"],
      },
    ],
  };

  await saveBotConfig(demo);
  console.log("[registry] demo bot registered:", demo.botId);
}

// ─── Register MeowChat Platform bot (own LINE OA for sales) ──────────────────

export async function registerPlatformBot(): Promise<void> {
  // PLATFORM_* takes priority; falls back to LINE_CHANNEL_* if not set
  const secret =
    process.env.PLATFORM_LINE_CHANNEL_SECRET ??
    process.env.LINE_CHANNEL_SECRET;
  const token =
    process.env.PLATFORM_LINE_CHANNEL_ACCESS_TOKEN ??
    process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const geminiKey = process.env.GEMINI_API_KEY ?? "";

  if (!secret || !token) {
    console.log("[registry] LINE_CHANNEL_SECRET/TOKEN not set — skipping platform bot");
    return;
  }

  const platform: BotConfig = {
    botId: "meowchat-platform",
    botName: "น้องแมว",
    businessName: "MeowChat",
    personalityMode: "friendly",
    businessScope: ["AI Chatbot LINE OA สำหรับธุรกิจไทย"],
    lineChannelSecret: secret,
    lineChannelAccessToken: token,
    geminiApiKey: geminiKey,
    model: "gemini-2.0-flash",
    knowledgeBase: [],
  };

  await saveBotConfig(platform);
  console.log("[registry] MeowChat platform bot registered: meowchat-platform");
}
