// ─── Setup Rich Menu for MeowChat Platform LINE OA ───────────────────────────
// Run: bun scripts/setup-platform-richmenu.ts
//
// Required env vars:
//   PLATFORM_LINE_CHANNEL_ACCESS_TOKEN=<token>
//
// What this does:
//   1. Generates a rich menu image via generate-richmenu-image.py (Python/Pillow)
//   2. Creates the rich menu structure via LINE API
//   3. Uploads the image
//   4. Sets the menu as default for all users

import { spawnSync } from "node:child_process";
import { readFile, unlink, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ACCESS_TOKEN = process.env.PLATFORM_LINE_CHANNEL_ACCESS_TOKEN;
if (!ACCESS_TOKEN) {
  console.error("❌ PLATFORM_LINE_CHANNEL_ACCESS_TOKEN is not set");
  process.exit(1);
}

const LINE_API = "https://api.line.me";

// ─── Rich Menu Structure ──────────────────────────────────────────────────────

const RICH_MENU = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: "MeowChat Platform Menu",
  chatBarText: "เมนู 🐱",
  // Layout matches generate-richmenu-image.py CELLS order:
  // Row 0: เหมียวแชทคืออะไร | ดูตัวอย่าง | รีวิวจากลูกค้า
  // Row 1: ราคาและแผน        | ทดลองฟรี   | คุยกับทีมงาน
  areas: [
    // Row 0
    {
      bounds: { x: 0, y: 0, width: 833, height: 843 },
      action: { type: "message", label: "เหมียวแชทคืออะไร", text: "MeowChat คืออะไร" },
    },
    {
      bounds: { x: 833, y: 0, width: 834, height: 843 },
      action: { type: "message", label: "ดูตัวอย่าง", text: "ดูตัวอย่าง" },
    },
    {
      bounds: { x: 1667, y: 0, width: 833, height: 843 },
      action: { type: "message", label: "รีวิวจากลูกค้า", text: "รีวิว" },
    },
    // Row 1
    {
      bounds: { x: 0, y: 843, width: 833, height: 843 },
      action: { type: "message", label: "ราคาและแผน", text: "ราคา" },
    },
    {
      bounds: { x: 833, y: 843, width: 834, height: 843 },
      action: {
        type: "uri",
        label: "ทดลองฟรีสิบสี่วัน",
        uri: "https://my.meowchat.store/register",
      },
    },
    {
      bounds: { x: 1667, y: 843, width: 833, height: 843 },
      action: { type: "message", label: "คุยกับทีมงาน", text: "ติดต่อทีม" },
    },
  ],
};

// ─── Generate rich menu image via Python/Pillow ───────────────────────────────
// Uses generate-richmenu-image.py (NotoSansThai + NotoColorEmoji fonts)

function generateImage(outputPath: string): void {
  console.log("🎨 Generating rich menu image (Python/Pillow)...");
  const pyScript = path.join(__dirname, "generate-richmenu-image.py");
  const result = spawnSync("python3", [pyScript, outputPath], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Image generation failed:\n${result.stderr || result.stdout}`);
  }
  console.log(result.stdout.trim());
}

// ─── LINE API helpers ─────────────────────────────────────────────────────────

async function lineApi(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const res = await fetch(`${LINE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      ...(body && !(body instanceof Buffer) ? { "Content-Type": "application/json" } : {}),
    },
    body: body instanceof Buffer
      ? body
      : body
      ? JSON.stringify(body)
      : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`LINE API ${method} ${path} → ${res.status}: ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const tmpDir = path.join(__dirname, "../.tmp");
  await mkdir(tmpDir, { recursive: true });
  const imagePath = path.join(tmpDir, "platform-richmenu.jpg");

  // 1. Generate image
  generateImage(imagePath);

  // 2. Create rich menu structure
  console.log("📋 Creating rich menu structure...");
  const created = (await lineApi("POST", "/v2/bot/richmenu", RICH_MENU)) as { richMenuId: string };
  const richMenuId = created.richMenuId;
  console.log(`✅ Rich menu created: ${richMenuId}`);

  // 3. Upload image
  console.log("📤 Uploading rich menu image...");
  const imageBuffer = await readFile(imagePath);
  await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "image/jpeg",
    },
    body: imageBuffer,
  }).then(async (res) => {
    if (!res.ok) throw new Error(`Image upload failed: ${res.status} ${await res.text()}`);
    console.log("✅ Image uploaded");
  });

  // 4. Set as default for all users
  console.log("🔗 Setting as default rich menu...");
  await lineApi("POST", `/v2/bot/user/all/richmenu/${richMenuId}`);
  console.log("✅ Set as default rich menu for all users");

  // Cleanup
  await unlink(imagePath).catch(() => {});

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅  MeowChat Platform Rich Menu Setup Complete!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Rich Menu ID: ${richMenuId}

Buttons:
  [ดูตัวอย่าง]     → message: "ดูตัวอย่าง"
  [ราคา/แผน]      → message: "ราคา"
  [ทดลองฟรี]      → uri: https://my.meowchat.store/register
  [คืออะไร?]      → message: "MeowChat คืออะไร"
  [คุยกับทีมงาน]  → message: "ติดต่อทีม"
  [รีวิวลูกค้า]   → message: "รีวิว"

💡 To update image: LINE Console → Messaging API → Rich menu
   Upload a 2500×843 px image for a professional look

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch((err) => {
  console.error("❌ Setup failed:", err);
  process.exit(1);
});
