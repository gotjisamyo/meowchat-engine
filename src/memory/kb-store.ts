// ─── KB Store: Redis-backed inverted index ────────────────────────────────────
// Stores KB chunks separately from BotConfig so large KBs don't bloat every request.
//
// Keys used:
//   kb:chunk:{botId}:{chunkId}        → JSON (KBEntry)
//   kb:idx:{botId}:{keyword}          → Set of chunkIds
//   kb:all:{botId}                    → List of all chunkIds (for fallback)

import type { KBEntry } from "../types/index.js";
import { redis } from "./redis.js";

const CHUNK_TTL = 60 * 60 * 24 * 365; // 1 year
const IDX_TTL = 60 * 60 * 24 * 365;

function chunkKey(botId: string, chunkId: string) {
  return `kb:chunk:${botId}:${chunkId}`;
}
function idxKey(botId: string, keyword: string) {
  return `kb:idx:${botId}:${keyword.toLowerCase()}`;
}
function allKey(botId: string) {
  return `kb:all:${botId}`;
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function saveKBChunks(botId: string, chunks: KBEntry[]): Promise<void> {
  if (chunks.length === 0) return;

  const pipeline = redis.pipeline();

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

export async function retrieveKBChunks(
  botId: string,
  query: string,
  topK = 3
): Promise<KBEntry[]> {
  // Extract candidate keywords from query (simple: split by space + Thai chars)
  const words = query
    .toLowerCase()
    .split(/[\s,.\-!?]+/)
    .filter((w) => w.length >= 2);

  // Look up all matching chunkIds from index
  const chunkIdSets = await Promise.all(
    words.map((w) => redis.smembers(idxKey(botId, w)))
  );

  // Score: count how many keywords matched this chunkId
  const scoreMap = new Map<string, number>();
  for (const ids of chunkIdSets) {
    for (const id of ids) {
      scoreMap.set(id, (scoreMap.get(id) ?? 0) + 1);
    }
  }

  let candidateIds: string[] = [];

  if (scoreMap.size > 0) {
    // Sort by score, take topK
    candidateIds = [...scoreMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([id]) => id);
  }

  if (candidateIds.length === 0) {
    // Thai text has no spaces — do substring matching across all chunks
    const allIds = await redis.lrange(allKey(botId), 0, -1);
    if (allIds.length === 0) return [];

    const allRaws = await Promise.all(allIds.map((id) => redis.get(chunkKey(botId, id))));
    const allChunks = allRaws
      .filter((r): r is string => r !== null)
      .map((r) => JSON.parse(r) as KBEntry);

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
  const raws = await Promise.all(
    candidateIds.map((id) => redis.get(chunkKey(botId, id)))
  );

  return raws
    .filter((r): r is string => r !== null)
    .map((r) => JSON.parse(r) as KBEntry);
}

// ─── Migrate: load from BotConfig knowledgeBase array (one-time) ─────────────

export async function migrateKBFromConfig(botId: string, chunks: KBEntry[]): Promise<void> {
  // Check if already migrated
  const count = await redis.llen(allKey(botId));
  if (count > 0) return; // already in store
  if (chunks.length === 0) return;
  await saveKBChunks(botId, chunks);
}
