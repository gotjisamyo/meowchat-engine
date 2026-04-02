import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { redis } from "./memory/redis.js";
import { lineWebhookHandler } from "./proxy/line-webhook.js";
import { registerDemoBot, registerPlatformBot } from "./proxy/bot-registry.js";
import { setupPlatformRichMenu } from "./proxy/platform-richmenu.js";
import { saveBotConfig, getBotConfig, listBotIds } from "./proxy/bot-registry.js";
import type { BotConfig } from "./types/index.js";

// ─── App ──────────────────────────────────────────────────────────────────────

const app = new Hono();

// ─── Health check ─────────────────────────────────────────────────────────────

app.get("/health", async (c) => {
  let redisOk = false;
  try {
    await redis.ping();
    redisOk = true;
  } catch {}
  return c.json({ ok: true, redis: redisOk, ts: new Date().toISOString() });
});

// ─── LINE OA webhook (per bot) ────────────────────────────────────────────────
// Vercel/Railway: set env LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN per bot
// URL pattern: POST /webhook/line/:botId

app.post("/webhook/line/:botId", lineWebhookHandler);

// ─── Bot config management (internal API — protect with API key in prod) ──────

app.post("/admin/bots", async (c) => {
  const apiKey = c.req.header("x-admin-key");
  if (apiKey !== process.env.ADMIN_API_KEY) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const config = (await c.req.json()) as BotConfig;
  await saveBotConfig(config);
  return c.json({ ok: true, botId: config.botId });
});

// ─── GET bot config (for KB sync from backend) ───────────────────────────────

app.get("/admin/bots/:botId", async (c) => {
  const apiKey = c.req.header("x-admin-key");
  if (apiKey !== process.env.ADMIN_API_KEY) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const config = await getBotConfig(c.req.param("botId"));
  if (!config) return c.json({ error: "not found" }, 404);
  return c.json(config);
});

// ─── Debug: list all registered bots ─────────────────────────────────────────
app.get("/admin/list", async (c) => {
  const apiKey = c.req.header("x-admin-key");
  if (apiKey !== process.env.ADMIN_API_KEY) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const ids = listBotIds();
  return c.json({ count: ids.length, botIds: ids });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3100);

async function start() {
  await redis.connect();

  // Register demo bot on first start (remove in production)
  if (process.env.REGISTER_DEMO === "1") {
    await registerDemoBot();
  }

  // Register MeowChat platform bot (own LINE OA for sales funnel)
  await registerPlatformBot();

  // Auto-setup rich menu (idempotent — skips if already configured)
  const platformToken =
    process.env.PLATFORM_LINE_CHANNEL_ACCESS_TOKEN ??
    process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (platformToken) {
    setupPlatformRichMenu(platformToken); // fire-and-forget (non-fatal)
  }

  serve({ fetch: app.fetch, port: PORT });

  console.log(`
╔════════════════════════════════════════╗
║  🐱 MeowChat Engine                   ║
║  PORT: ${PORT.toString().padEnd(31)}║
║  REDIS: ${(process.env.REDIS_URL ?? "localhost:6379").slice(0, 30).padEnd(30)}║
╚════════════════════════════════════════╝
  `);
}

start().catch(console.error);
