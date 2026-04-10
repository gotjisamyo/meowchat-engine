"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadOrCreateProfile = loadOrCreateProfile;
exports.saveProfile = saveProfile;
exports.updateCustomerName = updateCustomerName;
exports.addPreference = addPreference;
exports.addTag = addTag;
exports.buildProfileBlock = buildProfileBlock;
exports.resetSession = resetSession;
const redis_js_1 = require("./redis.js");
const PROFILE_TTL = 60 * 60 * 24 * 90; // 90 days
function profileKey(botId, customerId) {
    return `profile:${botId}:${customerId}`;
}
// ─── Load or create customer profile ─────────────────────────────────────────
async function loadOrCreateProfile(botId, customerId, channel = "line") {
    const key = profileKey(botId, customerId);
    const raw = await redis_js_1.redis.get(key);
    if (raw) {
        const profile = JSON.parse(raw);
        // Refresh lastSeen
        profile.lastSeen = new Date().toISOString();
        await saveProfile(profile);
        return profile;
    }
    // New customer
    const now = new Date().toISOString();
    const profile = {
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
async function saveProfile(profile) {
    const key = profileKey(profile.botId, profile.customerId);
    await redis_js_1.redis.setex(key, PROFILE_TTL, JSON.stringify(profile));
}
// ─── Update customer name when detected in conversation ──────────────────────
function updateCustomerName(profile, name) {
    if (!profile.name) {
        profile.name = name;
        if (!profile.tags.includes("named"))
            profile.tags.push("named");
    }
}
// ─── Update preferences (called when bot detects preference info) ─────────────
function addPreference(profile, preference) {
    if (!profile.preferences.raw.includes(preference)) {
        profile.preferences.raw.push(preference);
        // Rebuild quick summary (first 4 prefs)
        profile.preferences.summary = profile.preferences.raw.slice(0, 4).join(", ");
    }
}
// ─── Tag helpers ──────────────────────────────────────────────────────────────
function addTag(profile, tag) {
    if (!profile.tags.includes(tag))
        profile.tags.push(tag);
}
// ─── Build abbreviated profile block for LLM injection ───────────────────────
// Keep this lean: ~60–80 tokens max
function buildProfileBlock(profile) {
    const parts = [];
    if (profile.name)
        parts.push(`ชื่อ: ${profile.name}`);
    if (profile.preferences.summary)
        parts.push(`ความชอบ: ${profile.preferences.summary}`);
    if (profile.orderSummary)
        parts.push(`ประวัติ: ${profile.orderSummary}`);
    if (profile.deliveryAddress)
        parts.push(`ที่อยู่จัดส่ง: ${profile.deliveryAddress}`);
    if (profile.tags.includes("vip"))
        parts.push("สถานะ: VIP");
    return parts.length > 0
        ? `[ข้อมูลลูกค้า]\n${parts.join("\n")}`
        : "";
}
// ─── Session helpers ──────────────────────────────────────────────────────────
function createFreshSession() {
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
function resetSession(profile) {
    profile.session = createFreshSession();
}
