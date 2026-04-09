import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import path from "node:path";
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

// ─── Static assets (product screenshots for LINE image messages) ──────────────
// root is relative to CWD (project root), not dist/
const ASSETS_ROOT = path.resolve(process.cwd(), "public");
app.use("/assets/*", serveStatic({ root: ASSETS_ROOT }));

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

// ─── KB management endpoint ───────────────────────────────────────────────────
// POST /admin/bots/:botId/kb  { chunks: KBEntry[] }
// Saves chunks + triggers vector embedding in background

app.post("/admin/bots/:botId/kb", async (c) => {
  const apiKey = c.req.header("x-admin-key");
  if (apiKey !== process.env.ADMIN_API_KEY) return c.json({ error: "unauthorized" }, 401);

  const botId = c.req.param("botId");
  const config = await getBotConfig(botId);
  if (!config) return c.json({ error: "bot not found" }, 404);

  const { chunks } = (await c.req.json()) as { chunks: import("./types/index.js").KBEntry[] };
  if (!Array.isArray(chunks)) return c.json({ error: "chunks must be array" }, 400);

  const { saveKBChunks } = await import("./memory/kb-store.js");
  const { indexKBEmbeddings } = await import("./memory/kb-vectors.js");

  await saveKBChunks(botId, chunks);
  // Index embeddings in background — don't block response
  indexKBEmbeddings(botId, chunks, config.geminiApiKey).catch((e) =>
    console.error(`[kb] embed index error bot=${botId}:`, e)
  );

  return c.json({ ok: true, chunks: chunks.length, status: "indexing" });
});

// ─── Admin simulate: test bot reply without sending to LINE ──────────────────
app.post("/admin/bots/:botId/simulate", async (c) => {
  const apiKey = c.req.header("x-admin-key");
  if (apiKey !== process.env.ADMIN_API_KEY) return c.json({ error: "unauthorized" }, 401);

  const botId = c.req.param("botId");
  const config = await getBotConfig(botId);
  if (!config) return c.json({ error: "bot not found" }, 404);

  const { message } = (await c.req.json()) as { message: string };
  if (!message) return c.json({ error: "message required" }, 400);

  const { assembleContext } = await import("./engine/context-assembler.js");
  const { callGemini } = await import("./engine/gemini-client.js");
  const { loadOrCreateProfile } = await import("./memory/customer-profile.js");

  const profile = await loadOrCreateProfile("simulate_user", botId);
  const payload = await assembleContext(config, profile, message);
  const reply = await callGemini(payload, config.geminiApiKey);

  return c.json({ reply, botName: config.botName });
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
