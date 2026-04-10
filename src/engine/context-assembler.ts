import type { BotConfig, CustomerProfile, LLMPayload } from "../types/index.js";
import { buildPersonalityBlock, getTemperature } from "./personality.js";
import { buildGuardrailBlock } from "./guardrails.js";
import { buildProfileBlock } from "../memory/customer-profile.js";
import { getWindow } from "../memory/conversation-buffer.js";
import { buildKBBlock } from "./knowledge-base.js";
import { retrieveKBChunks, migrateKBFromConfig } from "../memory/kb-store.js";
import { vectorSearchKB, hasVectorIndex, indexKBEmbeddings } from "../memory/kb-vectors.js";

// ─── System prompt template ───────────────────────────────────────────────────

function buildSystemPrompt(params: {
  botName: string;
  businessName: string;
  personalityBlock: string;
  guardrailBlock: string;
  profileBlock: string;
  memorySummary: string;
  kbBlock: string;
  deliveryAddress?: string;
}): string {
  const {
    botName,
    businessName,
    personalityBlock,
    guardrailBlock,
    profileBlock,
    memorySummary,
    kbBlock,
  } = params;

  const sections: string[] = [];

  // Identity
  sections.push(
    `## ตัวตน\nคุณชื่อ "${botName}" ผู้ช่วย AI ของ ${businessName}\n${personalityBlock}`
  );

  // Guardrail + scope
  sections.push(guardrailBlock);

  // KB (only if available)
  if (kbBlock) sections.push(kbBlock);

  // Customer profile (only if available)
  if (profileBlock) sections.push(profileBlock);

  // Memory summary of older turns (only if available)
  if (memorySummary) {
    sections.push(
      `## บริบทการสนทนาก่อนหน้า (สรุป)\n${memorySummary}`
    );
  }

  // Delivery address rules
  const hasAddress = !!params.deliveryAddress;
  sections.push(
    `## ที่อยู่จัดส่ง
${hasAddress
  ? `ที่อยู่ที่บันทึกไว้: "${params.deliveryAddress}"
- เมื่อลูกค้าสั่งสินค้า ให้ทวนที่อยู่นี้ทุกครั้ง เช่น "จัดส่งที่ [ที่อยู่เดิม] เหมือนเดิมเลยไหมคะ?"
- ถ้าลูกค้าบอกเปลี่ยน ให้รับที่อยู่ใหม่ ทวนยืนยัน แล้วฝัง [SAVE_ADDRESS: ที่อยู่ใหม่] ต่อท้ายข้อความ`
  : `ลูกค้ายังไม่มีที่อยู่จัดส่ง
- เมื่อลูกค้าสั่งสินค้า ให้ถามที่อยู่ก่อนเสมอ
- เมื่อได้ที่อยู่แล้ว ให้ทวน เช่น "ทวนที่อยู่: [ที่อยู่] ถูกต้องไหมคะ?"
- เมื่อลูกค้ายืนยันแล้ว ให้ฝัง [SAVE_ADDRESS: ที่อยู่] ต่อท้ายข้อความ (จะถูกลบก่อนส่ง)`}`
  );

  // Always-on rules
  sections.push(
    `## กฎสำคัญ
1. ตอบภาษาไทยเสมอ เว้นแต่ลูกค้าพิมพ์ภาษาอังกฤษก่อน
2. ตอบให้เป็นธรรมชาติเหมือนคนจริงๆ ไม่ใช่หุ่นยนต์ ความยาวให้เหมาะกับคำถาม
3. ห้ามเดาราคาหรือสต็อก ใช้ข้อมูลจาก "ข้อมูลธุรกิจ" เท่านั้น ถ้าไม่รู้บอกตรงๆ
4. ห้ามตอบซ้ำโครงสร้างเดิมทุกข้อความ หรือลงท้ายแบบเดิมทุกครั้ง`
  );

  return sections.join("\n\n");
}

// ─── Main assembly function ───────────────────────────────────────────────────
// Call this before every LLM request

export async function assembleContext(
  config: BotConfig,
  customer: CustomerProfile,
  userMessage: string
): Promise<LLMPayload> {
  // 1. Personality block (~100 tokens)
  const personalityBlock = buildPersonalityBlock(
    config.botName,
    config.personalityMode
  );

  // 2. Guardrail + scope block (~150 tokens)
  const guardrailBlock = buildGuardrailBlock(config.businessScope);

  // 3. KB retrieval — vector search (RAG) with keyword index fallback
  await migrateKBFromConfig(config.botId, config.knowledgeBase);

  let kbChunks: import("../types/index.js").KBEntry[] = [];
  const useVector = await hasVectorIndex(config.botId);

  if (useVector) {
    // RAG: embed query → cosine similarity
    const hits = await vectorSearchKB(config.botId, userMessage, config.geminiApiKey, 3);
    if (hits.length > 0) {
      const raws = await Promise.all(
        hits.map((h) =>
          import("../memory/redis.js").then(({ redis }) =>
            redis.get(`kb:chunk:${config.botId}:${h.chunkId}`)
          )
        )
      );
      kbChunks = raws
        .filter((r): r is string => r !== null)
        .map((r) => JSON.parse(r) as import("../types/index.js").KBEntry);
    }
    // If vector search returned nothing, fall back to keyword search
    if (kbChunks.length === 0) {
      kbChunks = await retrieveKBChunks(config.botId, userMessage, 3);
    }
    // Trigger background indexing for any new chunks not yet indexed
    indexKBEmbeddings(config.botId, config.knowledgeBase, config.geminiApiKey).catch(() => {});
  } else {
    // Fallback: keyword inverted index + trigger vector indexing in background
    kbChunks = await retrieveKBChunks(config.botId, userMessage, 3);
    if (config.knowledgeBase.length > 0) {
      indexKBEmbeddings(config.botId, config.knowledgeBase, config.geminiApiKey).catch(() => {});
    }
  }

  // Filter out template placeholder entries (content with [xxx] that wasn't filled in)
  const PLACEHOLDER_RE = /\[[^\]]{1,20}\]/;
  const filledChunks = kbChunks.filter((e) => !PLACEHOLDER_RE.test(e.content));

  const kbSnippet = filledChunks.map((e) => `[${e.topic}]\n${e.content}`).join("\n\n");
  const kbBlock = buildKBBlock(kbSnippet);

  // 4. Customer profile block (~60–80 tokens)
  const profileBlock = buildProfileBlock(customer);

  // 5. Memory summary of compressed older turns (~60–80 tokens)
  const memorySummary = customer.session.memorySummary;

  // 6. Assemble system prompt
  const systemPrompt = buildSystemPrompt({
    botName: config.botName,
    businessName: config.businessName,
    personalityBlock,
    guardrailBlock,
    profileBlock,
    memorySummary,
    kbBlock,
    deliveryAddress: customer.deliveryAddress,
  });

  // 7. Raw window (last 6 turns, ~250 tokens)
  const windowMessages = getWindow(customer);

  // 8. Return full LLM payload
  return {
    system: systemPrompt,
    messages: [
      ...windowMessages,
      { role: "user", content: userMessage },
    ],
    model: config.model,
    maxTokens: 512,
    temperature: getTemperature(config.personalityMode),
  };
}

// ─── Token estimate (for logging/monitoring) ──────────────────────────────────

export function estimateTokens(payload: LLMPayload): number {
  const systemTokens = Math.ceil(payload.system.length / 4);
  const messageTokens = payload.messages.reduce(
    (sum, m) => sum + Math.ceil(m.content.length / 4),
    0
  );
  return systemTokens + messageTokens;
}
