import type { BotConfig, CustomerProfile, LLMPayload } from "../types/index.js";
import { buildPersonalityBlock, getTemperature } from "./personality.js";
import { buildGuardrailBlock } from "./guardrails.js";
import { buildProfileBlock } from "../memory/customer-profile.js";
import { getWindow } from "../memory/conversation-buffer.js";
import { retrieveKBSnippet, buildKBBlock } from "./knowledge-base.js";

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
2. ตอบสั้น กระชับ 1–3 ประโยค เว้นแต่ลูกค้าขอรายละเอียด
3. ห้ามเดาราคาหรือสต็อก ใช้ข้อมูลจาก "ข้อมูลธุรกิจ" เท่านั้น
4. รักษาบุคลิกให้สม่ำเสมอตลอดการสนทนา`
  );

  return sections.join("\n\n");
}

// ─── Main assembly function ───────────────────────────────────────────────────
// Call this before every LLM request

export function assembleContext(
  config: BotConfig,
  customer: CustomerProfile,
  userMessage: string
): LLMPayload {
  // 1. Personality block (~100 tokens)
  const personalityBlock = buildPersonalityBlock(
    config.botName,
    config.personalityMode
  );

  // 2. Guardrail + scope block (~150 tokens)
  const guardrailBlock = buildGuardrailBlock(config.businessScope);

  // 3. KB snippet — retrieve relevant chunks (~200–400 tokens)
  const kbSnippet = retrieveKBSnippet(userMessage, config.knowledgeBase, 3);
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
