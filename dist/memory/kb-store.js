"use strict";
// ─── KB Store: Redis-backed inverted index ────────────────────────────────────
// Stores KB chunks separately from BotConfig so large KBs don't bloat every request.
//
// Keys used:
//   kb:chunk:{botId}:{chunkId}        → JSON (KBEntry)
//   kb:idx:{botId}:{keyword}          → Set of chunkIds
//   kb:all:{botId}                    → List of all chunkIds (for fallback)
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveKBChunks = saveKBChunks;
exports.retrieveKBChunks = retrieveKBChunks;
exports.migrateKBFromConfig = migrateKBFromConfig;
const redis_js_1 = require("./redis.js");
const CHUNK_TTL = 60 * 60 * 24 * 365; // 1 year
const IDX_TTL = 60 * 60 * 24 * 365;
function chunkKey(botId, chunkId) {
    return `kb:chunk:${botId}:${chunkId}`;
}
function idxKey(botId, keyword) {
    return `kb:idx:${botId}:${keyword.toLowerCase()}`;
}
function allKey(botId) {
    return `kb:all:${botId}`;
}
// ─── Write ────────────────────────────────────────────────────────────────────
async function saveKBChunks(botId, chunks) {
    if (chunks.length === 0)
        return;
    const pipeline = redis_js_1.redis.pipeline();
    // Clear old index
    pipeline.del(allKey(botId));
    for (const chunk of chunks) {
        // Store chunk JSON
        pipeline.setex(chunkKey(botId, chunk.id), CHUNK_TTL, JSON.stringify(chunk));
        // Add to all-chunks list
        pipeline.rpush(allKey(botId), chunk.id);
        pipeline.expire(allKey(botId), IDX_TTL);
        // Build inverted index for each keyword
        for (const kw of chunk.keywords) {
            pipeline.sadd(idxKey(botId, kw), chunk.id);
            pipeline.expire(idxKey(botId, kw), IDX_TTL);
        }
    }
    await pipeline.exec();
}
// ─── Read: keyword search ─────────────────────────────────────────────────────
async function retrieveKBChunks(botId, query, topK = 3) {
    // Extract candidate keywords from query (simple: split by space + Thai chars)
    const words = query
        .toLowerCase()
        .split(/[\s,.\-!?]+/)
        .filter((w) => w.length >= 2);
    // Look up all matching chunkIds from index
    const chunkIdSets = await Promise.all(words.map((w) => redis_js_1.redis.smembers(idxKey(botId, w))));
    // Score: count how many keywords matched this chunkId
    const scoreMap = new Map();
    for (const ids of chunkIdSets) {
        for (const id of ids) {
            scoreMap.set(id, (scoreMap.get(id) ?? 0) + 1);
        }
    }
    let candidateIds = [];
    if (scoreMap.size > 0) {
        // Sort by score, take topK
        candidateIds = [...scoreMap.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, topK)
            .map(([id]) => id);
    }
    if (candidateIds.length === 0) {
        // Thai text has no spaces — do substring matching across all chunks
        const allIds = await redis_js_1.redis.lrange(allKey(botId), 0, -1);
        if (allIds.length === 0)
            return [];
        const allRaws = await Promise.all(allIds.map((id) => redis_js_1.redis.get(chunkKey(botId, id))));
        const allChunks = allRaws
            .filter((r) => r !== null)
            .map((r) => JSON.parse(r));
        const queryLower = query.toLowerCase();
        const scored = allChunks.map((chunk) => {
            const kwHits = chunk.keywords.filter((kw) => queryLower.includes(kw.toLowerCase())).length;
            return { chunk, score: kwHits };
        });
        const matched = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
        // If nothing matched, return first topK as general context
        return (matched.length > 0 ? matched : scored).slice(0, topK).map((s) => s.chunk);
    }
    // Fetch chunk JSON for keyword-indexed results
    const raws = await Promise.all(candidateIds.map((id) => redis_js_1.redis.get(chunkKey(botId, id))));
    return raws
        .filter((r) => r !== null)
        .map((r) => JSON.parse(r));
}
// ─── Migrate: load from BotConfig knowledgeBase array (one-time) ─────────────
async function migrateKBFromConfig(botId, chunks) {
    // Check if already migrated
    const count = await redis_js_1.redis.llen(allKey(botId));
    if (count > 0)
        return; // already in store
    if (chunks.length === 0)
        return;
    await saveKBChunks(botId, chunks);
}
