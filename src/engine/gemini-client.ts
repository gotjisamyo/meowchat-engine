import {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
  type Content,
} from "@google/generative-ai";
import type { LLMPayload } from "../types/index.js";

// ─── Safety settings (relax for business chat, not creative content) ──────────

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

// ─── Model routing ────────────────────────────────────────────────────────────
// Short/simple → Flash (fast, cheap ~฿0.02/msg)
// Complex/long  → Pro (smart, ~฿0.15/msg)

export function routeModel(userMessage: string, defaultModel: string): string {
  const isSimple =
    userMessage.length < 40 ||
    /^(สวัสดี|ขอบคุณ|โอเค|ok|hi|hello|ราคา|มีไหม|เปิดไหม)$/i.test(
      userMessage.trim()
    );
  return isSimple ? "gemini-2.0-flash" : defaultModel;
}

// ─── Convert our internal message format → Gemini Content[] ──────────────────

function toGeminiContents(
  messages: Array<{ role: "user" | "assistant"; content: string }>
): Content[] {
  return messages.map((m) => ({
    // Gemini uses "model" not "assistant"
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

// ─── Main Gemini call ─────────────────────────────────────────────────────────

export async function callGemini(
  payload: LLMPayload,
  apiKey: string
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);

  const modelName = routeModel(
    payload.messages.at(-1)?.content ?? "",
    payload.model
  );

  const model = genAI.getGenerativeModel({
    model: modelName,
    // system_instruction keeps it OUT of the conversation history
    // — this is Gemini's native way, cleaner than Claude's approach
    systemInstruction: payload.system,
    safetySettings: SAFETY_SETTINGS,
    generationConfig: {
      temperature: payload.temperature,
      maxOutputTokens: payload.maxTokens,
      // Thai text: disable thinking for Flash (faster, cheaper)
      ...(modelName === "gemini-2.5-pro"
        ? { thinkingConfig: { thinkingBudget: 0 } }  // disable thinking for biz chat
        : {}),
    },
  });

  // All messages except the last (which is the current user turn)
  const history = toGeminiContents(payload.messages.slice(0, -1));
  const currentMessage = payload.messages.at(-1)?.content ?? "";

  const chat = model.startChat({ history });
  const result = await chat.sendMessage(currentMessage);

  return result.response.text().trim();
}
