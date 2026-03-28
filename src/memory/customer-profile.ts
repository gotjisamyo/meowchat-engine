import type { CustomerProfile, ConversationSession } from "../types/index.js";
import { redis } from "./redis.js";

const PROFILE_TTL = 60 * 60 * 24 * 90; // 90 days

function profileKey(botId: string, customerId: string): string {
  return `profile:${botId}:${customerId}`;
}

// ─── Load or create customer profile ─────────────────────────────────────────

export async function loadOrCreateProfile(
  botId: string,
  customerId: string,
  channel: "line" | "messenger" | "web" = "line"
): Promise<CustomerProfile> {
  const key = profileKey(botId, customerId);
  const raw = await redis.get(key);

  if (raw) {
    const profile = JSON.parse(raw) as CustomerProfile;
    // Refresh lastSeen
    profile.lastSeen = new Date().toISOString();
    await saveProfile(profile);
    return profile;
  }

  // New customer
  const now = new Date().toISOString();
  const profile: CustomerProfile = {
    customerId,
    botId,
    channel,
    name: null,
    firstSeen: now,
    lastSeen: now,
    preferences: { raw: [], summary: "" },
    orderSummary: "",
    tags: [],
    escalationFlag: false,
    session: createFreshSession(),
  };

  await saveProfile(profile);
  return profile;
}

export async function saveProfile(profile: CustomerProfile): Promise<void> {
  const key = profileKey(profile.botId, profile.customerId);
  await redis.setex(key, PROFILE_TTL, JSON.stringify(profile));
}

// ─── Update customer name when detected in conversation ──────────────────────

export function updateCustomerName(
  profile: CustomerProfile,
  name: string
): void {
  if (!profile.name) {
    profile.name = name;
    if (!profile.tags.includes("named")) profile.tags.push("named");
  }
}

// ─── Update preferences (called when bot detects preference info) ─────────────

export function addPreference(
  profile: CustomerProfile,
  preference: string
): void {
  if (!profile.preferences.raw.includes(preference)) {
    profile.preferences.raw.push(preference);
    // Rebuild quick summary (first 4 prefs)
    profile.preferences.summary = profile.preferences.raw.slice(0, 4).join(", ");
  }
}

// ─── Tag helpers ──────────────────────────────────────────────────────────────

export function addTag(profile: CustomerProfile, tag: string): void {
  if (!profile.tags.includes(tag)) profile.tags.push(tag);
}

// ─── Build abbreviated profile block for LLM injection ───────────────────────
// Keep this lean: ~60–80 tokens max

export function buildProfileBlock(profile: CustomerProfile): string {
  const parts: string[] = [];

  if (profile.name) parts.push(`ชื่อ: ${profile.name}`);
  if (profile.preferences.summary)
    parts.push(`ความชอบ: ${profile.preferences.summary}`);
  if (profile.orderSummary) parts.push(`ประวัติ: ${profile.orderSummary}`);
  if (profile.tags.includes("vip")) parts.push("สถานะ: VIP");

  return parts.length > 0
    ? `[ข้อมูลลูกค้า]\n${parts.join("\n")}`
    : "";
}

// ─── Session helpers ──────────────────────────────────────────────────────────

function createFreshSession(): ConversationSession {
  return {
    sessionId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    turnCount: 0,
    window: [],
    memorySummary: "",
    unansweredCount: 0,
  };
}

// Reset session after long idle (called by proxy if gap > 30 min)
export function resetSession(profile: CustomerProfile): void {
  profile.session = createFreshSession();
}
