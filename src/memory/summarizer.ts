import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ChatMessage } from "../types/index.js";

// ใช้ Flash-Lite สำหรับ compression — เร็วและถูกมาก
const SUMMARIZER_MODEL = "gemini-2.0-flash";

function getClient() {
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");
}

// ─── Compress an evicted turn into rolling summary ────────────────────────────

export async function summarizeMemory(
  existingSummary: string,
  evictedTurn: ChatMessage
): Promise<string> {
  const roleLabel = evictedTurn.role === "user" ? "ลูกค้า" : "บอท";
  const turnText = `[${roleLabel}]: "${evictedTurn.content}"`;

  const prompt = existingSummary
    ? `สรุปที่มีอยู่:\n${existingSummary}\n\nเพิ่มข้อมูลจาก: ${turnText}`
    : `สรุปข้อความนี้: ${turnText}`;

  const model = getClient().getGenerativeModel({
    model: SUMMARIZER_MODEL,
    systemInstruction: `คุณคือระบบสรุปการสนทนาร้านค้าไทย
สรุปเป็น bullet สั้นๆ ภาษาไทย ไม่เกิน 60 คำ
เน้น: สิ่งที่ลูกค้าถาม, สิ่งที่สั่ง, ความชอบ, ความตั้งใจที่ยังค้างอยู่
ไม่ใส่ข้อมูลที่ไม่เกี่ยวกับธุรกิจ
ถ้าไม่มีข้อมูลสำคัญ ตอบว่า: (ไม่มีข้อมูลสำคัญ)`,
    generationConfig: { temperature: 0.1, maxOutputTokens: 150 },
  });

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();

  if (text === "(ไม่มีข้อมูลสำคัญ)" || text === "") return existingSummary;
  return text;
}

// ─── End-of-session summary ───────────────────────────────────────────────────

export async function endOfSessionSummary(
  fullSummary: string,
  currentWindow: ChatMessage[]
): Promise<{ preferences: string[]; orderSummary: string }> {
  if (!fullSummary && currentWindow.length === 0) {
    return { preferences: [], orderSummary: "" };
  }

  const conversationText = currentWindow
    .map((m) => `[${m.role === "user" ? "ลูกค้า" : "บอท"}]: ${m.content}`)
    .join("\n");

  const model = getClient().getGenerativeModel({
    model: SUMMARIZER_MODEL,
    systemInstruction: `สกัดข้อมูลสำคัญจากการสนทนาร้านค้าไทย
ตอบในรูปแบบ JSON เท่านั้น:
{"preferences":["ความชอบ/ข้อจำกัด"],"orderSummary":"สรุป 1 ประโยค"}
ถ้าไม่มีข้อมูล: {"preferences":[],"orderSummary":""}`,
    generationConfig: { temperature: 0.1, maxOutputTokens: 200 },
  });

  const prompt = `${fullSummary}\n${conversationText}`;
  const result = await model.generateContent(prompt);

  try {
    const raw = result.response.text().replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(raw);
    return {
      preferences: Array.isArray(parsed.preferences) ? parsed.preferences : [],
      orderSummary: typeof parsed.orderSummary === "string" ? parsed.orderSummary : "",
    };
  } catch {
    return { preferences: [], orderSummary: "" };
  }
}
