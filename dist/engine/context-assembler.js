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
Object.defineProperty(exports, "__esModule", { value: true });
exports.assembleContext = assembleContext;
exports.estimateTokens = estimateTokens;
const personality_js_1 = require("./personality.js");
const guardrails_js_1 = require("./guardrails.js");
const customer_profile_js_1 = require("../memory/customer-profile.js");
const conversation_buffer_js_1 = require("../memory/conversation-buffer.js");
const knowledge_base_js_1 = require("./knowledge-base.js");
const kb_store_js_1 = require("../memory/kb-store.js");
const kb_vectors_js_1 = require("../memory/kb-vectors.js");
// ─── System prompt template ───────────────────────────────────────────────────
function buildSystemPrompt(params) {
    const { botName, businessName, personalityBlock, guardrailBlock, profileBlock, memorySummary, kbBlock, } = params;
    const sections = [];
    // Identity
    sections.push(`## ตัวตน\nคุณชื่อ "${botName}" ผู้ช่วย AI ของ ${businessName}\n${personalityBlock}`);
    // Guardrail + scope
    sections.push(guardrailBlock);
    // KB (only if available)
    if (kbBlock)
        sections.push(kbBlock);
    // Customer profile (only if available)
    if (profileBlock)
        sections.push(profileBlock);
    // Memory summary of older turns (only if available)
    if (memorySummary) {
        sections.push(`## บริบทการสนทนาก่อนหน้า (สรุป)\n${memorySummary}`);
    }
    // Always-on rules
    sections.push(`## กฎสำคัญ
1. ตอบภาษาไทยเสมอ เว้นแต่ลูกค้าพิมพ์ภาษาอังกฤษก่อน
2. ตอบให้เป็นธรรมชาติเหมือนคนจริงๆ ไม่ใช่หุ่นยนต์ ความยาวให้เหมาะกับคำถาม
3. ห้ามเดาราคาหรือสต็อก ใช้ข้อมูลจาก "ข้อมูลธุรกิจ" เท่านั้น ถ้าไม่รู้บอกตรงๆ
4. ห้ามตอบซ้ำโครงสร้างเดิมทุกข้อความ หรือลงท้ายแบบเดิมทุกครั้ง`);
    return sections.join("\n\n");
}
// ─── Main assembly function ───────────────────────────────────────────────────
// Call this before every LLM request
async function assembleContext(config, customer, userMessage) {
    // 1. Personality block (~100 tokens)
    const personalityBlock = (0, personality_js_1.buildPersonalityBlock)(config.botName, config.personalityMode);
    // 2. Guardrail + scope block (~150 tokens)
    const guardrailBlock = (0, guardrails_js_1.buildGuardrailBlock)(config.businessScope);
    // 3. KB retrieval — vector search (RAG) with keyword index fallback
    await (0, kb_store_js_1.migrateKBFromConfig)(config.botId, config.knowledgeBase);
    let kbChunks = [];
    const useVector = await (0, kb_vectors_js_1.hasVectorIndex)(config.botId);
    if (useVector) {
        // RAG: embed query → cosine similarity
        const hits = await (0, kb_vectors_js_1.vectorSearchKB)(config.botId, userMessage, config.geminiApiKey, 3);
        if (hits.length > 0) {
            const raws = await Promise.all(hits.map((h) => Promise.resolve().then(() => __importStar(require("../memory/redis.js"))).then(({ redis }) => redis.get(`kb:chunk:${config.botId}:${h.chunkId}`))));
            kbChunks = raws
                .filter((r) => r !== null)
                .map((r) => JSON.parse(r));
        }
        // If vector search returned nothing, fall back to keyword search
        if (kbChunks.length === 0) {
            kbChunks = await (0, kb_store_js_1.retrieveKBChunks)(config.botId, userMessage, 3);
        }
        // Trigger background indexing for any new chunks not yet indexed
        (0, kb_vectors_js_1.indexKBEmbeddings)(config.botId, config.knowledgeBase, config.geminiApiKey).catch(() => { });
    }
    else {
        // Fallback: keyword inverted index + trigger vector indexing in background
        kbChunks = await (0, kb_store_js_1.retrieveKBChunks)(config.botId, userMessage, 3);
        if (config.knowledgeBase.length > 0) {
            (0, kb_vectors_js_1.indexKBEmbeddings)(config.botId, config.knowledgeBase, config.geminiApiKey).catch(() => { });
        }
    }
    // Filter out template placeholder entries (content with [xxx] that wasn't filled in)
    const PLACEHOLDER_RE = /\[[^\]]{1,20}\]/;
    const filledChunks = kbChunks.filter((e) => !PLACEHOLDER_RE.test(e.content));
    const kbSnippet = filledChunks.map((e) => `[${e.topic}]\n${e.content}`).join("\n\n");
    const kbBlock = (0, knowledge_base_js_1.buildKBBlock)(kbSnippet);
    // 4. Customer profile block (~60–80 tokens)
    const profileBlock = (0, customer_profile_js_1.buildProfileBlock)(customer);
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
    const windowMessages = (0, conversation_buffer_js_1.getWindow)(customer);
    // 8. Return full LLM payload
    return {
        system: systemPrompt,
        messages: [
            ...windowMessages,
            { role: "user", content: userMessage },
        ],
        model: config.model,
        maxTokens: 512,
        temperature: (0, personality_js_1.getTemperature)(config.personalityMode),
    };
}
// ─── Token estimate (for logging/monitoring) ──────────────────────────────────
function estimateTokens(payload) {
    const systemTokens = Math.ceil(payload.system.length / 4);
    const messageTokens = payload.messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
    return systemTokens + messageTokens;
}
