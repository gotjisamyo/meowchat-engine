"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_server_1 = require("@hono/node-server");
const serve_static_1 = require("@hono/node-server/serve-static");
const hono_1 = require("hono");
const node_path_1 = __importDefault(require("node:path"));
const redis_js_1 = require("./memory/redis.js");
const line_webhook_js_1 = require("./proxy/line-webhook.js");
const bot_registry_js_1 = require("./proxy/bot-registry.js");
const platform_richmenu_js_1 = require("./proxy/platform-richmenu.js");
const bot_registry_js_2 = require("./proxy/bot-registry.js");
// ─── App ──────────────────────────────────────────────────────────────────────
const app = new hono_1.Hono();
// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/health", async (c) => {
    let redisOk = false;
    try {
        await redis_js_1.redis.ping();
        redisOk = true;
    }
    catch { }
    return c.json({
        ok: true,
        redis: redisOk,
        ts: new Date().toISOString(),
        v: "order-signal-v3",
        backendConfigured: !!(process.env.BACKEND_URL && process.env.INTERNAL_API_KEY),
    });
});
// ─── LINE OA webhook (per bot) ────────────────────────────────────────────────
// Vercel/Railway: set env LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN per bot
// URL pattern: POST /webhook/line/:botId
// ─── Static assets (product screenshots for LINE image messages) ──────────────
// root is relative to CWD (project root), not dist/
const ASSETS_ROOT = node_path_1.default.resolve(process.cwd(), "public");
app.use("/assets/*", (0, serve_static_1.serveStatic)({ root: ASSETS_ROOT }));
app.post("/webhook/line/:botId", line_webhook_js_1.lineWebhookHandler);
// ─── Bot config management (internal API — protect with API key in prod) ──────
app.post("/admin/bots", async (c) => {
    const apiKey = c.req.header("x-admin-key");
    if (apiKey !== process.env.ADMIN_API_KEY) {
        return c.json({ error: "unauthorized" }, 401);
    }
    const config = (await c.req.json());
    await (0, bot_registry_js_2.saveBotConfig)(config);
    return c.json({ ok: true, botId: config.botId });
});
// ─── GET bot config (for KB sync from backend) ───────────────────────────────
app.get("/admin/bots/:botId", async (c) => {
    const apiKey = c.req.header("x-admin-key");
    if (apiKey !== process.env.ADMIN_API_KEY) {
        return c.json({ error: "unauthorized" }, 401);
    }
    const config = await (0, bot_registry_js_2.getBotConfig)(c.req.param("botId"));
    if (!config)
        return c.json({ error: "not found" }, 404);
    return c.json(config);
});
// ─── Debug: list all registered bots ─────────────────────────────────────────
app.get("/admin/list", async (c) => {
    const apiKey = c.req.header("x-admin-key");
    if (apiKey !== process.env.ADMIN_API_KEY) {
        return c.json({ error: "unauthorized" }, 401);
    }
    const ids = (0, bot_registry_js_2.listBotIds)();
    return c.json({ count: ids.length, botIds: ids });
});
// ─── KB management endpoint ───────────────────────────────────────────────────
// POST /admin/bots/:botId/kb  { chunks: KBEntry[] }
// Saves chunks + triggers vector embedding in background
app.post("/admin/bots/:botId/kb", async (c) => {
    const apiKey = c.req.header("x-admin-key");
    if (apiKey !== process.env.ADMIN_API_KEY)
        return c.json({ error: "unauthorized" }, 401);
    const botId = c.req.param("botId");
    const config = await (0, bot_registry_js_2.getBotConfig)(botId);
    if (!config)
        return c.json({ error: "bot not found" }, 404);
    const { chunks } = (await c.req.json());
    if (!Array.isArray(chunks))
        return c.json({ error: "chunks must be array" }, 400);
    const { saveKBChunks } = await Promise.resolve().then(() => __importStar(require("./memory/kb-store.js")));
    const { indexKBEmbeddings } = await Promise.resolve().then(() => __importStar(require("./memory/kb-vectors.js")));
    await saveKBChunks(botId, chunks);
    // Index embeddings in background — don't block response
    indexKBEmbeddings(botId, chunks, config.geminiApiKey).catch((e) => console.error(`[kb] embed index error bot=${botId}:`, e));
    return c.json({ ok: true, chunks: chunks.length, status: "indexing" });
});
// ─── Admin simulate: test bot reply without sending to LINE ──────────────────
app.post("/admin/bots/:botId/simulate", async (c) => {
    const apiKey = c.req.header("x-admin-key");
    if (apiKey !== process.env.ADMIN_API_KEY)
        return c.json({ error: "unauthorized" }, 401);
    const botId = c.req.param("botId");
    const config = await (0, bot_registry_js_2.getBotConfig)(botId);
    if (!config)
        return c.json({ error: "bot not found" }, 404);
    const { message } = (await c.req.json());
    if (!message)
        return c.json({ error: "message required" }, 400);
    const { handleMessage, processReplySignals } = await Promise.resolve().then(() => __importStar(require("./proxy/line-webhook.js")));
    const fakeEvent = {
        botId: config.botId,
        userId: "simulate-user",
        replyToken: "simulate",
        text: message,
        channel: "line",
    };
    const { reply: rawReply, escalated } = await handleMessage(fakeEvent, config);
    // Process signals (order/booking creation) + strip SHOW_PRODUCT
    let reply = await processReplySignals(rawReply, config.botId, "simulate-user");
    reply = reply.replace(/\[SHOW_PRODUCT:\s*[^\]]+\]/g, "").trim();
    return c.json({ reply, escalated, botName: config.botName });
});
// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 3100);
async function start() {
    await redis_js_1.redis.connect();
    // Register demo bot on first start (remove in production)
    if (process.env.REGISTER_DEMO === "1") {
        await (0, bot_registry_js_1.registerDemoBot)();
    }
    // Register MeowChat platform bot (own LINE OA for sales funnel)
    await (0, bot_registry_js_1.registerPlatformBot)();
    // Auto-setup rich menu (idempotent — skips if already configured)
    const platformToken = process.env.PLATFORM_LINE_CHANNEL_ACCESS_TOKEN ??
        process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (platformToken) {
        (0, platform_richmenu_js_1.setupPlatformRichMenu)(platformToken); // fire-and-forget (non-fatal)
    }
    (0, node_server_1.serve)({ fetch: app.fetch, port: PORT });
    console.log(`
╔════════════════════════════════════════╗
║  🐱 MeowChat Engine                   ║
║  PORT: ${PORT.toString().padEnd(31)}║
║  REDIS: ${(process.env.REDIS_URL ?? "localhost:6379").slice(0, 30).padEnd(30)}║
╚════════════════════════════════════════╝
  `);
}
start().catch(console.error);
