import type { BotConfig, CustomerProfile, LLMPayload } from "../types/index.js";
import { buildPersonalityBlock, getTemperature } from "./personality.js";
import { buildGuardrailBlock } from "./guardrails.js";
import { buildProfileBlock } from "../memory/customer-profile.js";
import { getWindow } from "../memory/conversation-buffer.js";
import { buildKBBlock } from "./knowledge-base.js";
import { retrieveKBChunks, migrateKBFromConfig } from "../memory/kb-store.js";

// ─── System prompt template ───────────────────────────────────────────────────

function buildSystemPrompt(params: {
  botName: string;
  businessName: string;
  personalityBlock: string;
  guardrailBlock: string;
  profileBlock: string;
  memorySummary: string;
  kbBlock: string;
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

  // 3. KB snippet — Redis inverted index (migrate from config on first call)
  await migrateKBFromConfig(config.botId, config.knowledgeBase);
  const kbChunks = await retrieveKBChunks(config.botId, userMessage, 3);
  const kbSnippet = kbChunks.map((e) => `[${e.topic}]\n${e.content}`).join("\n\n");
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
