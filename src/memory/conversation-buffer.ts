import type { CustomerProfile, ChatMessage, MessageRole } from "../types/index.js";
import { saveProfile } from "./customer-profile.js";
import { summarizeMemory } from "./summarizer.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const WINDOW_SIZE = 4; // raw turns kept in context (2 exchanges)

// ─── Add a turn to the sliding window ────────────────────────────────────────
// When the window is full, the oldest turn is evicted and folded into memory_summary

export async function addTurn(
  profile: CustomerProfile,
  role: MessageRole,
  content: string
): Promise<void> {
  const msg: ChatMessage = { role, content, ts: Date.now() };
  const { session } = profile;

  session.window.push(msg);
  session.turnCount++;

  // Track unanswered questions for escalation
  if (role === "user") {
    session.unansweredCount++;
  } else {
    session.unansweredCount = 0; // bot replied → reset
  }

  // Evict oldest turn if window is over limit
  if (session.window.length > WINDOW_SIZE) {
    const evicted = session.window.shift()!;

    // Fold evicted turn into rolling summary + persist (async, non-blocking)
    summarizeMemory(session.memorySummary, evicted)
      .then((newSummary) => {
        session.memorySummary = newSummary;
        return saveProfile(profile);
      })
      .catch((err) =>
        console.error("[buffer] summarizer error:", err.message)
      );
  }
  // Skip per-turn Redis write — profile is saved once per request in handleMessage
}

// ─── Get current window for context assembly ──────────────────────────────────

export function getWindow(
  profile: CustomerProfile
): Array<{ role: MessageRole; content: string }> {
  const msgs = profile.session.window.map(({ role, content }) => ({ role, content }));
  // Gemini requires history to start with "user" — trim any leading assistant turns
  const firstUserIdx = msgs.findIndex((m) => m.role === "user");
  return firstUserIdx <= 0 ? msgs : msgs.slice(firstUserIdx);
}

// ─── Check if session is idle (>30 min since last turn) ──────────────────────

export function isSessionIdle(profile: CustomerProfile): boolean {
  const lastTurn = profile.session.window.at(-1);
  if (!lastTurn) return true;
  const idleMs = Date.now() - lastTurn.ts;
  return idleMs > 30 * 60 * 1000;
}
