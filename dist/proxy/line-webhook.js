"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.lineWebhookHandler = lineWebhookHandler;
exports.handleMessage = handleMessage;
const node_crypto_1 = __importDefault(require("node:crypto"));
const customer_profile_js_1 = require("../memory/customer-profile.js");
const conversation_buffer_js_1 = require("../memory/conversation-buffer.js");
const guardrails_js_1 = require("../engine/guardrails.js");
const context_assembler_js_1 = require("../engine/context-assembler.js");
const gemini_client_js_1 = require("../engine/gemini-client.js");
const qr_scanner_js_1 = require("../engine/qr-scanner.js");
const bot_registry_js_1 = require("./bot-registry.js");
const platform_handler_js_1 = require("./platform-handler.js");
// ─── Verify LINE signature ────────────────────────────────────────────────────
function verifyLineSignature(body, signature, secret) {
    if (!signature)
        return false;
    const hmac = node_crypto_1.default.createHmac("sha256", secret);
    hmac.update(body);
    const expected = hmac.digest("base64");
    // Decode both as base64 before comparing to ensure equal byte lengths
    const sigBuf = Buffer.from(signature, "base64");
    const expBuf = Buffer.from(expected, "base64");
    if (sigBuf.length !== expBuf.length)
        return false;
    return node_crypto_1.default.timingSafeEqual(sigBuf, expBuf);
}
// ─── MeowChat branding Flex Message (dark navy + gold, premium look) ──────────
function buildBrandingBubble() {
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
async function replyToLine(replyToken, message, accessToken, quickReplies, showBranding) {
    const textMessage = { type: "text", text: message };
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
    const messages = [textMessage];
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
async function lineWebhookHandler(c) {
    const botId = c.req.param("botId");
    // Load bot config
    const config = await (0, bot_registry_js_1.getBotConfig)(botId ?? "");
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
    await Promise.allSettled(events.map((event) => config.botId === "meowchat-platform"
        ? (0, platform_handler_js_1.processPlatformEvent)(event, config)
        : processLineEvent(event, config)));
    return c.json({ ok: true });
}
// ─── Process a single LINE event ─────────────────────────────────────────────
// Map non-text LINE message types to a natural Thai prompt for the LLM
function nonTextToPrompt(msgType) {
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
async function downloadLineImage(messageId, accessToken) {
    try {
        const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok)
            return null;
        const contentType = res.headers.get("content-type") ?? "image/jpeg";
        const mimeType = contentType.split(";")[0].trim();
        const buffer = await res.arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");
        return { base64, mimeType };
    }
    catch {
        return null;
    }
}
// ─── Notify backend to create a slip order ───────────────────────────────────
async function notifySlipOrder(botId, lineUserId, slipData, mode) {
    const backendUrl = process.env.BACKEND_URL;
    const internalKey = process.env.INTERNAL_API_KEY;
    if (!backendUrl || !internalKey)
        return;
    await fetch(`${backendUrl}/api/internal/slip-order`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-internal-key": internalKey,
        },
        body: JSON.stringify({ botId, lineUserId, ...slipData, mode }),
    });
}
async function processLineEvent(event, config) {
    if (event.type !== "message")
        return;
    const msg = event.message;
    const userId = event.source?.userId;
    const replyToken = event.replyToken;
    if (!userId || !replyToken)
        return;
    // ─── Handle image messages with slip detection ────────────────────────────
    if (msg?.type === "image" && config.slipVerifyMode && config.slipVerifyMode !== "off") {
        const imageData = await downloadLineImage(msg.id, config.lineChannelAccessToken);
        if (imageData) {
            try {
                // ── 1. Try QR scan first (free, no API cost) ──────────────────────
                const qrData = await (0, qr_scanner_js_1.scanSlipQR)(imageData.base64);
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
                        confidence: "high",
                    };
                }
                else {
                    // ── 2. Fallback: Gemini Vision (~฿0.005/image) ────────────────────
                    console.log("[engine] no QR found, falling back to Gemini Vision");
                    slip = await (0, gemini_client_js_1.analyzeSlipImage)(imageData.base64, imageData.mimeType, config.geminiApiKey);
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
                    let replyText;
                    if (mode === "auto") {
                        const amountText = slip.amount ? `฿${slip.amount.toLocaleString()}` : "ไม่ทราบจำนวน";
                        replyText =
                            `✅ ได้รับสลิปการโอนเงินแล้วค่ะ\n` +
                                `💰 จำนวน: ${amountText}\n` +
                                (slip.bankName ? `🏦 ธนาคาร: ${slip.bankName}\n` : "") +
                                (slip.refNumber ? `📋 เลขอ้างอิง: ${slip.refNumber}\n` : "") +
                                `\n✨ ระบบบันทึกข้อมูลเรียบร้อยแล้ว ทีมงานจะดำเนินการให้ค่ะ ขอบคุณที่ใช้บริการ 🐱`;
                    }
                    else {
                        // manual mode — notify merchant to verify
                        replyText =
                            `📨 ได้รับสลิปแล้วค่ะ กำลังแจ้งทีมงานให้ตรวจสอบ\n` +
                                `⏳ กรุณารอสักครู่ ทีมงานจะยืนยันการโอนเงินให้ค่ะ 🐱`;
                    }
                    await replyToLine(replyToken, replyText, config.lineChannelAccessToken);
                    logConversationToBackend(config.botId, userId, "[ส่งสลิปโอนเงิน]", replyText, false).catch((e) => console.warn("[engine] conversation log failed:", e));
                    return;
                }
            }
            catch (err) {
                console.warn("[engine] slip analysis failed:", err);
                // fall through to generic image handling
            }
        }
    }
    let userText;
    if (msg?.type === "text") {
        userText = (msg.text ?? "").trim();
        if (!userText)
            return;
    }
    else {
        // Non-text message — convert to a descriptive prompt so the LLM can respond naturally
        const syntheticPrompt = nonTextToPrompt(msg?.type);
        if (!syntheticPrompt)
            return; // unknown type — skip silently
        userText = syntheticPrompt;
    }
    const webhookEvent = {
        botId: config.botId,
        userId,
        replyToken,
        text: userText,
        channel: "line",
    };
    const { reply, escalated, showBranding } = await handleMessage(webhookEvent, config);
    const qr = !escalated && config.quickReplies?.length ? config.quickReplies : undefined;
    await replyToLine(replyToken, reply, config.lineChannelAccessToken, qr, showBranding);
    // Fire-and-forget: log conversation to backend for merchant dashboard
    logConversationToBackend(config.botId, userId, userText, reply, escalated).catch((e) => console.warn("[engine] conversation log failed:", e));
}
// ─── Core message handling pipeline ──────────────────────────────────────────
async function handleMessage(event, config) {
    const startMs = Date.now();
    // 1. Load or create customer profile
    const profile = await (0, customer_profile_js_1.loadOrCreateProfile)(config.botId, event.userId, event.channel);
    // 2. Reset session if idle too long
    if ((0, conversation_buffer_js_1.isSessionIdle)(profile)) {
        (0, customer_profile_js_1.resetSession)(profile);
    }
    // 3. Check escalation BEFORE calling LLM (saves a call)
    if ((0, guardrails_js_1.shouldEscalate)(event.text, profile, config.escalationKeywords)) {
        profile.escalationFlag = true;
        await (0, customer_profile_js_1.saveProfile)(profile);
        return { reply: (0, guardrails_js_1.buildEscalationMessage)(config.botName), escalated: true, showBranding: false };
    }
    // 4. Assemble context BEFORE adding current turn — window must not include
    //    the current user message (assembleContext appends it itself)
    const payload = await (0, context_assembler_js_1.assembleContext)(config, profile, event.text);
    // 6. Log token estimate
    const tokenEstimate = (0, context_assembler_js_1.estimateTokens)(payload);
    console.log(`[engine] botId=${config.botId} userId=${event.userId} ` +
        `tokens≈${tokenEstimate} model=${payload.model}`);
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
    let reply;
    try {
        reply = await (0, gemini_client_js_1.callGemini)(payload, config.geminiApiKey);
    }
    catch (err) {
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
    await (0, conversation_buffer_js_1.addTurn)(profile, "user", event.text);
    await (0, conversation_buffer_js_1.addTurn)(profile, "assistant", reply);
    // 12. Show branding as a separate bubble on first turn only (trial/free plans)
    const showBranding = isFirstTurn &&
        config.showBranding !== false &&
        config.subscriptionStatus !== "active";
    // 13. Passive preference extraction (simple heuristic, non-blocking)
    extractPreferences(event.text, profile);
    await (0, customer_profile_js_1.saveProfile)(profile);
    const latencyMs = Date.now() - startMs;
    console.log(`[engine] done in ${latencyMs}ms`);
    return { reply, escalated: false, showBranding };
}
// ─── Log conversation to backend (for merchant dashboard) ────────────────────
async function logConversationToBackend(botId, lineUserId, userText, botReply, escalated = false) {
    const backendUrl = process.env.BACKEND_URL;
    const internalKey = process.env.INTERNAL_API_KEY;
    if (!backendUrl || !internalKey)
        return; // not configured, skip silently
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
const PREFERENCE_PATTERNS = [
    [/แพ้กุ้ง|ไม่กินกุ้ง/i, "แพ้กุ้ง"],
    [/แพ้แป้งสาลี|celiac/i, "แพ้แป้งสาลี"],
    [/เผ็ดน้อย|ไม่เผ็ด/i, "ชอบเผ็ดน้อย"],
    [/เผ็ดมาก|ชอบเผ็ด/i, "ชอบเผ็ดมาก"],
    [/ไม่ใส่ผัก|ไม่ชอบผัก/i, "ไม่ชอบผัก"],
    [/ไม่ใส่น้ำแข็ง/i, "ไม่ต้องน้ำแข็ง"],
    [/มังสวิรัติ|เจ|vegan/i, "มังสวิรัติ"],
];
function extractPreferences(message, profile) {
    for (const [pattern, label] of PREFERENCE_PATTERNS) {
        if (pattern.test(message)) {
            (0, customer_profile_js_1.addPreference)(profile, label);
        }
    }
}
