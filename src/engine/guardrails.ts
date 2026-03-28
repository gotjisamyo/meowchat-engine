import type { CustomerProfile } from "../types/index.js";

// ─── Escalation keyword patterns ─────────────────────────────────────────────

const ESCALATION_PATTERNS: RegExp[] = [
  /คืนเงิน|refund|เงินคืน/i,
  /โกง|ปลอม|หลอก|ฉ้อโกง/i,
  /คุยกับคน|คุยกับพนักงาน|human|เจ้าหน้าที่|ผู้จัดการ|manager/i,
  /แจ้งความ|ฟ้อง|ร้องเรียน|สคบ\./i,
  /ด่า|แย่มาก|ห่วยมาก|ไม่พอใจมาก/i,
];

// ─── Check if message should escalate to human ───────────────────────────────

export function shouldEscalate(
  message: string,
  profile: CustomerProfile
): boolean {
  const keywordHit = ESCALATION_PATTERNS.some((p) => p.test(message));
  const repeatedFrustration = profile.session.unansweredCount >= 3;
  return keywordHit || repeatedFrustration;
}

// ─── Guardrail instruction embedded in system prompt ─────────────────────────
// This avoids an extra LLM call — classification happens inside the main call

export const GUARDRAIL_INSTRUCTION = `
## การจัดการขอบเขต
ก่อนตอบทุกครั้ง ให้จำแนกคำถามว่าเป็น IN_SCOPE หรือ OUT_OF_SCOPE โดยไม่บอกลูกค้า

IN_SCOPE: สินค้า เมนู ราคา โปรโมชั่น การสั่งซื้อ จัดส่ง สต็อก การจองนัด เวลาทำการ ข้อร้องเรียนเกี่ยวกับออเดอร์
OUT_OF_SCOPE: การเมือง ชีวิตส่วนตัว คู่แข่ง ข้อมูลทั่วไปที่ไม่เกี่ยวธุรกิจ

ถ้า OUT_OF_SCOPE → ใช้ข้อความ redirect อย่างสุภาย ไม่ตอบคำถามนั้น
ถ้า AMBIGUOUS → พยายามเชื่อมกลับมาที่ธุรกิจ หรือถามเพิ่ม

## Anti-Hallucination
- ห้ามเดาราคาหรือสต็อกที่ไม่มีในข้อมูลที่ให้มา
- ถ้าไม่รู้ราคา → บอกว่า "ขอตรวจสอบให้ก่อนนะคะ" อย่าเดา
- ถ้าไม่แน่ใจข้อมูล → บอกว่าไม่แน่ใจดีกว่าเดาผิด
`.trim();

// ─── Redirect message templates ───────────────────────────────────────────────

export function buildRedirectMessage(
  botName: string,
  businessName: string
): string {
  return `ขอโทษนะคะ ${botName} ดูแลเรื่องของ ${businessName} เท่านั้นเลยค่ะ มีอะไรให้ช่วยเรื่องสินค้าหรือบริการไหมคะ? 😊`;
}

export function buildEscalationMessage(botName: string): string {
  return `ขอโทษที่ทำให้ไม่สะดวกนะคะ ${botName} จะส่งเรื่องให้ทีมงานติดต่อกลับโดยเร็วที่สุดนะคะ ขอบคุณที่รอค่ะ 🙏`;
}

// ─── Build guardrail + scope system block ────────────────────────────────────

export function buildGuardrailBlock(scopeList: string[]): string {
  const scopeText = scopeList.map((s) => `- ${s}`).join("\n");
  return `## ขอบเขตการให้บริการ\nคุณช่วยเรื่องเหล่านี้ได้เท่านั้น:\n${scopeText}\n\n${GUARDRAIL_INSTRUCTION}`;
}
