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
  if (!signature) return false;
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(body);
  const expected = hmac.digest("base64");
  // Decode both as base64 before comparing to ensure equal byte lengths
  const sigBuf = Buffer.from(signature, "base64");
  const expBuf = Buffer.from(expected, "base64");
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

// ─── MeowChat branding Flex Message (dark navy + gold, premium look) ──────────

function buildBrandingBubble(): Record<string, unknown> {
  return {
    type: "flex",
    altText: "🐱 ขับเคลื่อนโดย MeowChat",
    contents: {
      type: "bubble",
      size: "micro",
      body: {
        type: "box",
        layout: "horizontal",
        backgroundColor: "#1C1B33",
        cornerRadius: "16px",
        paddingTop: "lg",
        paddingBottom: "lg",
        paddingStart: "lg",
        paddingEnd: "lg",
        alignItems: "center",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "🐱",
            size: "xl",
            flex: 0,
          },
          {
            type: "box",
            layout: "vertical",
            flex: 1,
            spacing: "none",
            contents: [
              {
                type: "text",
                text: "POWERED BY",
                color: "#7878A8",
                size: "xxs",
                weight: "bold",
              },
              {
                type: "text",
                text: "MeowChat",
                color: "#E8C56B",
                size: "md",
                weight: "bold",
              },
            ],
          },
        ],
      },
    },
  };
}

// ─── Reply to LINE via Messaging API ─────────────────────────────────────────

// ─── Product image lookup + Flex Message builder ─────────────────────────────

async function lookupProductImage(
  botId: string,
  name: string
): Promise<{ name: string; price: number; imageUrl?: string } | null> {
  const backendUrl = process.env.BACKEND_URL;
  const internalKey = process.env.INTERNAL_API_KEY;
  if (!backendUrl || !internalKey) return null;
  try {
    const res = await fetch(
      `${backendUrl}/api/internal/product-image?botId=${encodeURIComponent(botId)}&name=${encodeURIComponent(name)}`,
      { headers: { "x-internal-key": internalKey } }
    );
    if (!res.ok) return null;
    return await res.json() as { name: string; price: number; imageUrl?: string };
  } catch { return null; }
}

function buildProductBubble(product: { name: string; price: number; imageUrl?: string }): Record<string, unknown> {
  const priceText = Number(product.price) > 0 ? `฿${Number(product.price).toLocaleString()}` : "ฟรี";
  return {
    type: "bubble",
    size: "kilo",
    ...(product.imageUrl ? {
      hero: {
        type: "image",
        url: product.imageUrl,
        size: "full",
        aspectRatio: "20:13",
        aspectMode: "cover",
      },
    } : {}),
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      spacing: "sm",
      backgroundColor: "#12121A",
      contents: [
        { type: "text", text: product.name, weight: "bold", size: "md", color: "#FFFFFF", wrap: true },
        { type: "text", text: priceText, size: "xl", weight: "bold", color: "#FF6B35" },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "12px",
      backgroundColor: "#12121A",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#FF6B35",
          height: "sm",
          action: { type: "message", label: "🛒 สั่งเลย", text: `สั่ง${product.name}เลยค่ะ` },
        },
      ],
    },
  };
}

async function replyToLine(
  replyToken: string,
  message: string,
  accessToken: string,
  quickReplies?: Array<{ label: string; text: string }>,
  showBranding?: boolean,
  extraMessages?: Record<string, unknown>[]
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

  const messages: Record<string, unknown>[] = [textMessage];
  if (extraMessages) {
    messages.push(...extraMessages);
  }
  if (showBranding) {
    messages.push(buildBrandingBubble());
  }

  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ replyToken, messages }),
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

// ─── Parse and execute bot signals from LLM reply ────────────────────────────
// Shared between processLineEvent (real LINE) and simulate endpoint (backend proxy)

// ─── Brace-counting JSON extractor (handles nested objects/arrays) ────────────
function extractSignalBlock(text: string, signalName: string): { json: string; fullMatch: string } | null {
  const prefix = `[${signalName}:`;
  const idx = text.indexOf(prefix);
  if (idx === -1) return null;

  const start = text.indexOf("{", idx + prefix.length);
  if (start === -1) return null;

  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return null;

  // Find the closing ] of the signal block
  const closeIdx = text.indexOf("]", end);
  if (closeIdx === -1) return null;

  return {
    json: text.slice(start, end + 1),
    fullMatch: text.slice(idx, closeIdx + 1),
  };
}

export async function processReplySignals(
  rawReply: string,
  botId: string,
  userId: string
): Promise<string> {
  let reply = rawReply;

  // [CREATE_ORDER:...] — create order in backend
  const orderBlock = extractSignalBlock(reply, "CREATE_ORDER");
  if (orderBlock) {
    reply = reply.replace(orderBlock.fullMatch, "").trim();
    try {
      const payload = JSON.parse(orderBlock.json) as { items: Array<{ name: string; qty: number }>; note?: string };
      const result = await notifyBotOrder(botId, userId, payload.items ?? [], payload.note ?? "");
      if (result.ok && result.orderNumber) {
        const totalText = result.total ? `฿${result.total.toLocaleString()}` : "";
        reply += `\n\n📋 หมายเลขออเดอร์: ${result.orderNumber}${totalText ? `\n💰 ยอดรวม: ${totalText}` : ""}\nร้านค้าได้รับออเดอร์แล้ว รอการยืนยันจากร้านค่ะ 🐱`;
      } else if (!result.ok) {
        console.warn(`[engine] bot-order failed: ${result.error}`);
        reply += `\n\n⚠️ ขออภัย บันทึกออเดอร์ไม่สำเร็จ กรุณาติดต่อร้านค้าโดยตรงค่ะ`;
      }
    } catch (e) {
      console.warn("[engine] CREATE_ORDER parse error:", e);
    }
  }

  // [CREATE_BOOKING:...] — create booking in backend
  const bookingBlock = extractSignalBlock(reply, "CREATE_BOOKING");
  if (bookingBlock) {
    reply = reply.replace(bookingBlock.fullMatch, "").trim();
    try {
      const payload = JSON.parse(bookingBlock.json) as { service: string; datetime?: string; note?: string };
      const result = await notifyBotBooking(botId, userId, payload.service ?? "", payload.datetime ?? "", payload.note ?? "");
      if (result.ok) {
        const dateText = payload.datetime ? `\n📅 วัน/เวลา: ${payload.datetime}` : "";
        reply += `\n\n✅ รับนัดหมายแล้วค่ะ!\n🎯 บริการ: ${payload.service}${dateText}\nร้านค้าจะยืนยันนัดหมายกลับหาคุณค่ะ 🐱`;
      } else {
        console.warn(`[engine] bot-booking failed: ${result.error}`);
        reply += `\n\n⚠️ ขออภัย บันทึกนัดหมายไม่สำเร็จ กรุณาติดต่อร้านค้าโดยตรงค่ะ`;
      }
    } catch (e) {
      console.warn("[engine] CREATE_BOOKING parse error:", e);
    }
  }

  return reply;
}

// ─── Create order from bot via backend internal API ──────────────────────────

async function notifyBotOrder(
  botId: string,
  lineUserId: string,
  items: Array<{ name: string; qty: number }>,
  note: string
): Promise<{ ok: boolean; orderNumber?: string; items?: Array<{ productName: string; quantity: number; price: number }>; total?: number; error?: string }> {
  const backendUrl = process.env.BACKEND_URL;
  const internalKey = process.env.INTERNAL_API_KEY;
  if (!backendUrl || !internalKey) return { ok: false, error: "not configured" };

  try {
    const res = await fetch(`${backendUrl}/api/internal/bot-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-key": internalKey },
      body: JSON.stringify({ botId, lineUserId, items, note }),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: (data.error as string) ?? "unknown" };
    return { ok: true, orderNumber: data.orderNumber as string, items: data.items as Array<{ productName: string; quantity: number; price: number }>, total: data.total as number };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ─── Notify backend to create a booking ──────────────────────────────────────

async function notifyBotBooking(
  botId: string,
  lineUserId: string,
  service: string,
  datetime: string,
  note: string
): Promise<{ ok: boolean; bookingId?: string; error?: string }> {
  const backendUrl = process.env.BACKEND_URL;
  const internalKey = process.env.INTERNAL_API_KEY;
  if (!backendUrl || !internalKey) return { ok: false, error: "not configured" };

  try {
    const res = await fetch(`${backendUrl}/api/internal/bot-booking`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-key": internalKey },
      body: JSON.stringify({ botId, lineUserId, service, datetime, note }),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: (data.error as string) ?? "unknown" };
    return { ok: true, bookingId: data.bookingId as string };
  } catch (e) {
    return { ok: false, error: String(e) };
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

  let { reply, escalated, showBranding } = await handleMessage(webhookEvent, config);

  // ─── Process bot signals (CREATE_ORDER, CREATE_BOOKING, strip SHOW_PRODUCT) ─
  reply = await processReplySignals(reply, config.botId, userId);

  // ─── Parse remaining [SHOW_PRODUCT:...] → LINE Flex bubbles ──────────────
  const productNames: string[] = [];
  reply = reply.replace(/\[SHOW_PRODUCT:\s*([^\]]+)\]/g, (_, name: string) => {
    productNames.push(name.trim());
    return "";
  }).trim();

  const flexMessages: Record<string, unknown>[] = [];
  if (productNames.length > 0) {
    const products = await Promise.all(
      productNames.slice(0, 3).map((n) => lookupProductImage(config.botId, n))
    );
    const bubbles = products
      .filter((p): p is { name: string; price: number; imageUrl?: string } => p !== null && !!p.imageUrl)
      .map(buildProductBubble);
    if (bubbles.length === 1) {
      flexMessages.push({ type: "flex", altText: `รายละเอียด: ${bubbles.length > 0 ? productNames[0] : "สินค้า"}`, contents: bubbles[0] });
    } else if (bubbles.length > 1) {
      flexMessages.push({ type: "flex", altText: "รายละเอียดสินค้า", contents: { type: "carousel", contents: bubbles } });
    }
  }

  const qr = !escalated && config.quickReplies?.length ? config.quickReplies : undefined;
  await replyToLine(replyToken, reply, config.lineChannelAccessToken, qr, showBranding, flexMessages.length > 0 ? flexMessages : undefined);

  // Fire-and-forget: log conversation to backend for merchant dashboard
  logConversationToBackend(config.botId, userId, userText, reply, escalated).catch(
    (e) => console.warn("[engine] conversation log failed:", e)
  );
}

// ─── Core message handling pipeline ──────────────────────────────────────────

export async function handleMessage(
  event: LineWebhookEvent,
  config: BotConfig
): Promise<{ reply: string; escalated: boolean; showBranding: boolean }> {
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
  if (shouldEscalate(event.text, profile, config.escalationKeywords)) {
    profile.escalationFlag = true;
    await saveProfile(profile);
    return { reply: buildEscalationMessage(config.botName), escalated: true, showBranding: false };
  }

  // 4. Assemble context BEFORE adding current turn — window must not include
  //    the current user message (assembleContext appends it itself)
  const payload = await assembleContext(config, profile, event.text);

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
      showBranding: false,
    };
  }

  // 8. Check if this is the first turn of the session (before addTurn increments count)
  const isFirstTurn = profile.session.turnCount === 0;

  // 9. Call Gemini
  let reply: string;
  try {
    reply = await callGemini(payload, config.geminiApiKey);
  } catch (err) {
    console.error("[engine] Claude error:", err);
    reply = `ขออภัยนะคะ ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งค่ะ`;
  }

  // 10. Parse and save delivery address signal from Gemini reply
  const addressMatch = reply.match(/\[SAVE_ADDRESS:\s*(.+?)\]/);
  if (addressMatch) {
    profile.deliveryAddress = addressMatch[1].trim();
    reply = reply.replace(/\s*\[SAVE_ADDRESS:\s*.+?\]/, "").trim();
  }

  // 11. Add both turns to buffer (clean, no branding mixed in)
  await addTurn(profile, "user", event.text);
  await addTurn(profile, "assistant", reply);

  // 12. Show branding as a separate bubble on first turn only (trial/free plans)
  const showBranding =
    isFirstTurn &&
    config.showBranding !== false &&
    config.subscriptionStatus !== "active";

  // 13. Passive preference extraction (simple heuristic, non-blocking)
  extractPreferences(event.text, profile);
  await saveProfile(profile);

  const latencyMs = Date.now() - startMs;
  console.log(`[engine] done in ${latencyMs}ms`);

  return { reply, escalated: false, showBranding };
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
