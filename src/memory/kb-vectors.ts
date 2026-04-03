// ─── KB Vector Store: Gemini Embeddings + Cosine Similarity ──────────────────
// Uses text-embedding-004 (768-dim) stored in Redis per chunk.
// At query time: embed query → cosine similarity → return topK chunks.
//
// Redis keys:
//   kb:emb:{botId}:{chunkId}   → JSON float array (768 dims)
//   kb:embids:{botId}          → Set of indexed chunkIds

import type { KBEntry } from "../types/index.js";
import { redis } from "./redis.js";

const EMB_TTL = 60 * 60 * 24 * 365; // 1 year

// ─── Gemini embedding API ─────────────────────────────────────────────────────

async function embed(text: string, apiKey: string): Promise<number[]> {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/text-embedding-004",
        content: { parts: [{ text }] },
      }),
    }
  );
  if (!resp.ok) throw new Error(`Embedding API ${resp.status}: ${await resp.text()}`);
  const data = (await resp.json()) as { embedding: { values: number[] } };
  return data.embedding.values;
}

// ─── Cosine similarity ────────────────────────────────────────────────────────

function cosine(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Index KB chunks (call after saveKBChunks) ────────────────────────────────

export async function indexKBEmbeddings(
  botId: string,
  chunks: KBEntry[],
  apiKey: string
): Promise<void> {
  // Check which chunks are already indexed
  const indexed = await redis.smembers(`kb:embids:${botId}`);
  const indexedSet = new Set(indexed);

  const toIndex = chunks.filter((c) => !indexedSet.has(c.id));
  if (toIndex.length === 0) return;

  console.log(`[kb-vectors] indexing ${toIndex.length} chunks for bot=${botId}`);

  // Embed in batches of 5 (avoid rate limit)
  for (let i = 0; i < toIndex.length; i += 5) {
    const batch = toIndex.slice(i, i + 5);
    await Promise.all(
      batch.map(async (chunk) => {
        try {
          // Embed topic + content together for richer representation
          const text = `${chunk.topic}: ${chunk.content}`;
          const vec = await embed(text, apiKey);
          await redis.setex(
            `kb:emb:${botId}:${chunk.id}`,
            EMB_TTL,
            JSON.stringify(vec)
          );
          await redis.sadd(`kb:embids:${botId}`, chunk.id);
          await redis.expire(`kb:embids:${botId}`, EMB_TTL);
        } catch (err) {
          console.error(`[kb-vectors] embed failed for chunk=${chunk.id}:`, err);
        }
      })
    );
    // Small delay between batches
    if (i + 5 < toIndex.length) await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`[kb-vectors] indexed ${toIndex.length} chunks for bot=${botId}`);
}

// ─── Query: embed query → cosine similarity → return topK chunks ──────────────

export async function vectorSearchKB(
  botId: string,
  query: string,
  apiKey: string,
  topK = 3
): Promise<{ chunkId: string; score: number }[]> {
  // Get all indexed chunkIds for this bot
  const chunkIds = await redis.smembers(`kb:embids:${botId}`);
  if (chunkIds.length === 0) return [];

  // Embed the query
  const queryVec = await embed(query, apiKey);

  // Load all embeddings and compute similarity
  const embKeys = chunkIds.map((id) => `kb:emb:${botId}:${id}`);
  const raws = await redis.mget(...embKeys);

  const scored: { chunkId: string; score: number }[] = [];
  for (let i = 0; i < chunkIds.length; i++) {
    const raw = raws[i];
    if (!raw) continue;
    const vec = JSON.parse(raw) as number[];
    const score = cosine(queryVec, vec);
    scored.push({ chunkId: chunkIds[i], score });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

// ─── Check if vector index exists for this bot ────────────────────────────────

export async function hasVectorIndex(botId: string): Promise<boolean> {
  const count = await redis.scard(`kb:embids:${botId}`);
  return count > 0;
}
