// ─── Core Types ───────────────────────────────────────────────────────────────

export type PersonalityMode = "friendly" | "formal" | "sales" | "cute";
export type MessageRole = "user" | "assistant";
export type Channel = "line" | "messenger" | "web";

// ─── Bot Configuration (stored per merchant in DB) ────────────────────────────

export interface BotConfig {
  botId: string;
  botName: string;           // e.g. "น้องแมว"
  businessName: string;      // e.g. "ร้านข้าวแม่มณี"
  personalityMode: PersonalityMode;
  businessScope: string[];   // what the bot can answer
  lineChannelSecret: string;
  lineChannelAccessToken: string;
  geminiApiKey: string;
  model: "gemini-2.0-flash" | "gemini-2.5-pro"; // routing
  knowledgeBase: KBEntry[];  // product/menu/price list
  showBranding?: boolean;    // append MeowChat footer (default true on trial/free)
  botLocked?: boolean;       // trial expired + no payment → lock bot
  subscriptionStatus?: "trial" | "active" | "expired" | "grace";
  slipVerifyMode?: "off" | "auto" | "manual"; // payment slip detection via Gemini Vision
  quickReplies?: Array<{ label: string; text: string }>; // LINE quick reply buttons
  escalationKeywords?: string[]; // custom merchant-defined escalation triggers
}

export interface KBEntry {
  id: string;
  topic: string;             // e.g. "เมนูอาหาร", "ราคา", "เวลาทำการ"
  content: string;           // e.g. "ข้าวผัดหมู ราคา 80 บาท ..."
  keywords: string[];
}

// ─── Customer Profile (persisted in Redis + DB) ───────────────────────────────

export interface CustomerProfile {
  customerId: string;        // LINE userId or platform user id
  botId: string;
  channel: Channel;
  name: string | null;       // filled once customer mentions name
  firstSeen: string;         // ISO datetime
  lastSeen: string;
  preferences: {
    raw: string[];           // e.g. ["ชอบเผ็ดน้อย", "แพ้กุ้ง"]
    summary: string;         // compressed: "เผ็ดน้อย แพ้กุ้ง"
  };
  orderSummary: string;      // "สั่งบ่อย: ข้าวผัด, น้ำมะนาว (3 ครั้ง)"
  tags: string[];            // ["vip", "repeat_buyer"]
  session: ConversationSession;
  escalationFlag: boolean;
}

// ─── Conversation Session (ephemeral, in Redis) ───────────────────────────────

export interface ConversationSession {
  sessionId: string;
  startedAt: string;
  turnCount: number;
  window: ChatMessage[];     // last N raw turns
  memorySummary: string;     // compressed older turns
  unansweredCount: number;   // for escalation detection
}

export interface ChatMessage {
  role: MessageRole;
  content: string;
  ts: number;                // unix ms
}

// ─── LLM Payload ──────────────────────────────────────────────────────────────

export interface LLMPayload {
  system: string;
  messages: Array<{ role: MessageRole; content: string }>;
  model: string;
  maxTokens: number;
  temperature: number;
}

// ─── LINE Webhook ─────────────────────────────────────────────────────────────

export interface LineWebhookEvent {
  botId: string;
  userId: string;
  replyToken: string;
  text: string;
  channel: Channel;
}
