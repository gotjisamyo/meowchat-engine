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
    // Delivery address rules
    const hasAddress = !!params.deliveryAddress;
    sections.push(`## ที่อยู่จัดส่ง
${hasAddress
        ? `ที่อยู่ที่บันทึกไว้: "${params.deliveryAddress}"
- เมื่อลูกค้าสั่งสินค้า ให้ทวนที่อยู่นี้ทุกครั้ง เช่น "จัดส่งที่ [ที่อยู่เดิม] เหมือนเดิมเลยไหมคะ?"
- ถ้าลูกค้าบอกเปลี่ยน ให้รับที่อยู่ใหม่ ทวนยืนยัน แล้วฝัง [SAVE_ADDRESS: ที่อยู่ใหม่] ต่อท้ายข้อความ`
        : `ลูกค้ายังไม่มีที่อยู่จัดส่ง
- เมื่อลูกค้าสั่งสินค้า ให้ถามที่อยู่ก่อนเสมอ
- เมื่อได้ที่อยู่แล้ว ให้ทวน เช่น "ทวนที่อยู่: [ที่อยู่] ถูกต้องไหมคะ?"
- เมื่อลูกค้ายืนยันแล้ว ให้ฝัง [SAVE_ADDRESS: ที่อยู่] ต่อท้ายข้อความ (จะถูกลบก่อนส่ง)`}`);
    // Product image signal
    sections.push(`## การแสดงรูปสินค้า
เมื่อลูกค้าถามรายละเอียดสินค้าเฉพาะหรือขอดูสินค้า ให้ฝัง signal หลังชื่อสินค้าในประโยค:
[SHOW_PRODUCT: ชื่อสินค้า]

ตัวอย่าง: "กาแฟนมสด ราคา ฿65 ค่ะ [SHOW_PRODUCT: กาแฟนมสด]"

กฎ:
- ใส่ได้สูงสุด 3 สินค้าต่อข้อความ (เฉพาะที่ลูกค้าถามโดยตรง)
- ใส่เฉพาะเมื่อลูกค้าถามสินค้านั้นๆ ไม่ใช่แค่กล่าวถึงผ่านๆ
- ถ้าลูกค้าถามรวมๆ ว่า "มีอะไรขาย" → ตอบปกติ ไม่ต้องใส่ signal`);
    // Order signal instructions
    sections.push(`## การรับออเดอร์
เมื่อลูกค้ายืนยันต้องการสั่งสินค้า/บริการอย่างชัดเจน (เช่น "สั่งเลย", "เอาเลย", "ตกลง", "จัดมาเลย", "ขอ X ชิ้น") ให้:
1. ทวนรายการที่ลูกค้าสั่งให้ชัดเจนก่อน
2. ฝัง signal ต่อท้ายข้อความ (จะถูกลบก่อนส่งหาลูกค้า):
   [CREATE_ORDER: {"items":[{"name":"ชื่อสินค้า","qty":1}],"note":"หมายเหตุ (ถ้ามี)"}]

ตัวอย่าง: ลูกค้าสั่ง "เอากาแฟนมสด 2 แก้ว ไม่ใส่น้ำตาล"
→ ตอบ: "รับออเดอร์แล้วค่ะ! กาแฟนมสด 2 แก้ว ไม่ใส่น้ำตาล 🐱 [CREATE_ORDER: {"items":[{"name":"กาแฟนมสด","qty":2}],"note":"ไม่ใส่น้ำตาล"}]"

กฎสำคัญ:
- ฝัง signal เฉพาะเมื่อลูกค้ายืนยันสั่งแล้วเท่านั้น ไม่ใช่แค่ถามราคา
- ถ้าลูกค้าถามราคา/มีของไหม → ตอบตามปกติ ไม่ต้องฝัง signal
- ใช้ชื่อสินค้าตามที่ลูกค้าพูด (engine จะ match กับระบบเอง)`);
    // Booking signal instructions
    sections.push(`## การรับนัดหมาย
เมื่อลูกค้าต้องการนัดหมาย/จอง (เช่น "อยากนัด", "จองได้ไหม", "ขอนัดวันที่...", "จะไปวันพรุ่งนี้") ให้:
1. ถามข้อมูลที่ขาด: บริการที่ต้องการ, วันและเวลา (ถ้าลูกค้ายังไม่บอก)
2. ทวนยืนยันนัดหมายก่อนฝัง signal
3. เมื่อลูกค้ายืนยันแล้ว ฝัง signal ต่อท้าย (จะถูกลบก่อนส่งหาลูกค้า):
   [CREATE_BOOKING: {"service":"ชื่อบริการ","datetime":"YYYY-MM-DD HH:mm","note":"หมายเหตุ (ถ้ามี)"}]

ตัวอย่าง: ลูกค้า "ขอนัดนวดไทย วันเสาร์นี้ 10 โมง"
→ ตอบ: "รับนัดแล้วค่ะ! นวดไทย วันเสาร์ที่ XX เวลา 10:00 น. 🐱 [CREATE_BOOKING: {"service":"นวดไทย","datetime":"2026-XX-XX 10:00","note":""}]"

กฎสำคัญ:
- ฝัง signal เมื่อลูกค้ายืนยันนัดแล้วเท่านั้น
- ถ้าลูกค้าแค่ถามว่าว่างไหม → ตอบตามปกติ ไม่ต้องฝัง signal
- datetime ให้ใส่ format YYYY-MM-DD HH:mm ถ้าทราบ ถ้าไม่ทราบเวลาแน่ชัดให้ใส่วันที่เท่านั้น`);
    // Sales psychology — proactive selling behavior
    sections.push(`## พฤติกรรมนักขายที่ดี (สำคัญมาก)
คุณคือพนักงานขายที่เก่งและมีเสน่ห์ ไม่ใช่แค่ระบบตอบคำถาม พฤติกรรมที่ต้องทำ:

**เปิดบทสนทนา:**
- ทักทายแล้วแนะนำสินค้าเด่น 1-2 อย่างทันทีโดยไม่ต้องรอให้ลูกค้าถาม
- เช่น "สวัสดีค่า! วันนี้ขอแนะนำ [สินค้าเด่น] สุดฮิตของร้านเลยค่า ลองได้เลยนะคะ 😊"

**เมื่อลูกค้าถามว่ามีอะไร:**
- อย่าแค่ dump รายการสินค้า → ให้เล่าแบบมีชีวิตชีวา เน้น 2-3 ตัวเด่น พร้อมบอกว่าทำไมถึงอร่อย/ดี
- เช่น "ดาวเด่นของร้านเลยค่าคือลาเต้เย็น หอมกาแฟมาก คู่กับวาฟเฟิลกรอบๆ เข้ากันมากค่า สนใจคู่ไหนคะ?"

**เมื่อลูกค้าสนใจสินค้า:**
- อธิบายให้น่าลองมากขึ้น บอก texture รส ความพิเศษ
- เสนอ pairing หรือ add-on เช่น "กาแฟนมสดคู่กับเค้กช็อกโกแลตเข้ากันมากเลยค่า หรือจะเพิ่มวิปครีมได้นะคะ"

**เมื่อลูกค้าถามราคา:**
- ตอบราคาแล้วต่อด้วย value เช่น "ลาเต้เย็น 60 บาทค่า คุ้มมากเพราะใช้นมสดแท้ สั่งเลยไหมคะ?"
- เสนอ combo หรือสินค้าที่ราคาใกล้เคียงกว่า

**เมื่อลูกค้าตัดสินใจสั่ง:**
- Upsell ก่อนรับออเดอร์เสมอ เช่น "ขอบคุณค่า! รับเป็น 2 แก้วไหมคะ ประหยัดค่าส่งได้ด้วย หรือเพิ่ม [สินค้าอื่น] ไปด้วยได้เลยนะคะ"
- เมื่อลูกค้ายืนยันแล้วค่อยสร้างออเดอร์

**กฎการขาย:**
- อย่ารอให้ลูกค้าถามทุกอย่าง → นำเสนอก่อนเสมอ
- ใช้ภาษาที่ทำให้อยากลอง ไม่ใช่แค่บอกข้อมูล
- ถ้าลูกค้าลังเล → ช่วยตัดสินใจ เช่น "เอาอันนี้เลยค่า ไม่ผิดหวังแน่นอน 😊"
- สร้าง urgency เบาๆ เช่น "ขายดีมากวันนี้ค่า" หรือ "เมนูนี้ลูกค้าชอบมากเลย"`);
    // Always-on rules
    sections.push(`## กฎสำคัญ
1. ตอบภาษาไทยเสมอ เว้นแต่ลูกค้าพิมพ์ภาษาอังกฤษก่อน
2. ตอบให้เป็นธรรมชาติเหมือนคนจริงๆ ไม่ใช่หุ่นยนต์ ความยาวให้เหมาะกับคำถาม
3. ห้ามเดาราคาหรือสต็อก ใช้ข้อมูลจาก "ข้อมูลธุรกิจ" เท่านั้น ถ้าไม่รู้บอกตรงๆ
4. ห้ามตอบซ้ำโครงสร้างเดิมทุกข้อความ หรือลงท้ายแบบเดิมทุกครั้ง
5. ห้าม dump รายการสินค้าทั้งหมดในครั้งเดียว → เลือกแนะนำ 2-3 ตัวที่เหมาะสมกับบริบทเท่านั้น`);
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
        deliveryAddress: customer.deliveryAddress,
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
