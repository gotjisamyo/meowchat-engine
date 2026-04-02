// ─── Auto-setup Rich Menu for MeowChat Platform LINE OA ──────────────────────
// Called on startup — idempotent: skips if default rich menu already exists.
// Image is generated via Python/Pillow (scripts/generate-richmenu-image.py).

import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync, mkdirSync } from "node:fs";
import path from "node:path";
const LINE_DATA_API = "https://api-data.line.me";
const LINE_API      = "https://api.line.me";

const RICH_MENU = {
  size: { width: 2500, height: 843 },
  selected: true,
  name: "MeowChat Platform Menu",
  chatBarText: "เมนู 🐱",
  areas: [
    {
      bounds: { x: 0, y: 0, width: 833, height: 421 },
      action: { type: "message", label: "ดูตัวอย่าง", text: "ดูตัวอย่าง" },
    },
    {
      bounds: { x: 833, y: 0, width: 834, height: 421 },
      action: { type: "message", label: "ราคา/แผน", text: "ราคา" },
    },
    {
      bounds: { x: 1667, y: 0, width: 833, height: 421 },
      action: { type: "uri", label: "ทดลองฟรี", uri: "https://my.meowchat.store/register" },
    },
    {
      bounds: { x: 0, y: 421, width: 833, height: 422 },
      action: { type: "message", label: "เหมียวแชทคืออะไร", text: "MeowChat คืออะไร" },
    },
    {
      bounds: { x: 833, y: 421, width: 834, height: 422 },
      action: { type: "message", label: "คุยกับทีมงาน", text: "ติดต่อทีม" },
    },
    {
      bounds: { x: 1667, y: 421, width: 833, height: 422 },
      action: { type: "message", label: "รีวิวจากลูกค้า", text: "รีวิว" },
    },
  ],
};

async function lineGet(path: string, token: string): Promise<unknown> {
  const res = await fetch(`${LINE_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`LINE GET ${path} → ${res.status}`);
  return res.json();
}

async function linePost(path: string, token: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${LINE_API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`LINE POST ${path} → ${res.status}: ${text}`);
  return JSON.parse(text);
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function setupPlatformRichMenu(accessToken: string): Promise<void> {
  try {
    // 1. Check if default rich menu already exists
    const existing = (await lineGet("/v2/bot/user/all/richmenu", accessToken).catch(() => null)) as
      | { richMenuId: string }
      | null;

    if (existing?.richMenuId) {
      console.log(`[richmenu] Already set: ${existing.richMenuId} — skipping`);
      return;
    }

    console.log("[richmenu] No default menu found — creating...");

    // 2. Generate image via Python/Pillow
    const tmpDir = path.join(__dirname, "../../.tmp");
    mkdirSync(tmpDir, { recursive: true });
    const imgPath = path.join(tmpDir, "platform-richmenu.png");
    const pyScript = path.join(__dirname, "../../scripts/generate-richmenu-image.py");

    const gen = spawnSync("python3", [pyScript, imgPath], { encoding: "utf8" });
    if (gen.status !== 0) {
      throw new Error(`Image gen failed: ${gen.stderr || gen.stdout}`);
    }
    console.log("[richmenu]", gen.stdout.trim());

    // 3. Create rich menu structure
    const created = (await linePost("/v2/bot/richmenu", accessToken, RICH_MENU)) as {
      richMenuId: string;
    };
    const richMenuId = created.richMenuId;
    console.log(`[richmenu] Created: ${richMenuId}`);

    // 4. Upload image
    const imgBuf = readFileSync(imgPath);
    const uploadRes = await fetch(`${LINE_DATA_API}/v2/bot/richmenu/${richMenuId}/content`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "image/png" },
      body: imgBuf,
    });
    if (!uploadRes.ok) {
      throw new Error(`Image upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
    }
    console.log("[richmenu] Image uploaded");

    // 5. Set as default
    await fetch(`${LINE_API}/v2/bot/user/all/richmenu/${richMenuId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    console.log(`[richmenu] Set as default ✅`);

    // Cleanup
    try { unlinkSync(imgPath); } catch { /* ignore */ }
  } catch (err) {
    // Non-fatal: log and continue (bot works without rich menu)
    console.warn("[richmenu] Setup failed (non-fatal):", (err as Error).message);
  }
}
