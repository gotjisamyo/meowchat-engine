// ─── Setup Rich Menu for MeowChat Platform LINE OA ───────────────────────────
// Run: bun scripts/setup-platform-richmenu.ts
//
// Required env vars:
//   PLATFORM_LINE_CHANNEL_ACCESS_TOKEN=<token>
//
// What this does:
//   1. Generates a rich menu image (2500×843 px) using jimp
//   2. Creates the rich menu structure via LINE API
//   3. Uploads the image
//   4. Sets the menu as default for all users

import Jimp from "jimp";
import { createWriteStream } from "node:fs";
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
  size: { width: 2500, height: 843 },
  selected: true,
  name: "MeowChat Platform Menu",
  chatBarText: "เมนู 🐱",
  areas: [
    // Row 1
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
      action: {
        type: "uri",
        label: "ทดลองฟรี",
        uri: "https://my.meowchat.store/register",
      },
    },
    // Row 2
    {
      bounds: { x: 0, y: 421, width: 833, height: 422 },
      action: {
        type: "message",
        label: "MeowChat คืออะไร?",
        text: "MeowChat คืออะไร",
      },
    },
    {
      bounds: { x: 833, y: 421, width: 834, height: 422 },
      action: {
        type: "message",
        label: "คุยกับทีมงาน",
        text: "ติดต่อทีม",
      },
    },
    {
      bounds: { x: 1667, y: 421, width: 833, height: 422 },
      action: { type: "message", label: "รีวิวจากลูกค้า", text: "รีวิว" },
    },
  ],
};

// ─── Color palette ────────────────────────────────────────────────────────────
// Each cell gets a distinct brand-aligned color (RGBA as 32-bit int)

function rgba(r: number, g: number, b: number, a = 255): number {
  return ((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff);
}

const COLORS = {
  // Row 1
  demo:     rgba(124, 58, 237),  // violet-600 — ดูตัวอย่าง
  price:    rgba(14, 165, 233),  // sky-500 — ราคา/แผน
  freeTrial: rgba(16, 185, 129), // emerald-500 — ทดลองฟรี ✨
  // Row 2
  about:    rgba(71, 85, 105),   // slate-600 — คืออะไร
  team:     rgba(245, 158, 11),  // amber-500 — คุยกับทีม
  reviews:  rgba(239, 68, 68),   // red-500 — รีวิว
  // Dividers
  divider:  rgba(255, 255, 255), // white
  darkBg:   rgba(30, 27, 75),    // deep purple bg (unused but keeping for ref)
};

// ─── Fill rectangle helper ────────────────────────────────────────────────────

function fillRect(
  image: Jimp,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number
): void {
  image.scan(x, y, w, h, (_px, _py, offset) => {
    image.bitmap.data.writeUInt32BE(color, offset);
  });
}

// ─── Generate rich menu image ─────────────────────────────────────────────────

async function generateImage(outputPath: string): Promise<void> {
  console.log("🎨 Generating rich menu image...");

  const W = 2500;
  const H = 843;
  const MID_Y = 421;
  const COL1 = 833;
  const COL2 = 1667;
  const DIVIDER = 4;

  // Create blank white image
  const image = new Jimp(W, H, 0xffffffff);

  // Fill cells
  fillRect(image, 0,    0,     COL1,          MID_Y,      COLORS.demo);
  fillRect(image, COL1, 0,     COL2 - COL1,   MID_Y,      COLORS.price);
  fillRect(image, COL2, 0,     W - COL2,       MID_Y,      COLORS.freeTrial);

  fillRect(image, 0,    MID_Y, COL1,          H - MID_Y,  COLORS.about);
  fillRect(image, COL1, MID_Y, COL2 - COL1,   H - MID_Y,  COLORS.team);
  fillRect(image, COL2, MID_Y, W - COL2,       H - MID_Y,  COLORS.reviews);

  // White dividers
  fillRect(image, COL1 - DIVIDER / 2, 0,     DIVIDER, H, COLORS.divider);
  fillRect(image, COL2 - DIVIDER / 2, 0,     DIVIDER, H, COLORS.divider);
  fillRect(image, 0,                  MID_Y - DIVIDER / 2, W, DIVIDER, COLORS.divider);

  // Load bitmap font and print labels
  try {
    const font64 = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);
    const font32 = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);

    const labels: Array<{
      x: number; y: number; w: number; h: number;
      line1: string; line2: string;
    }> = [
      { x: 0,    y: 0,     w: COL1,         h: MID_Y,     line1: "  Demo", line2: "  du dtua yang" },
      { x: COL1, y: 0,     w: COL2 - COL1,  h: MID_Y,     line1: "  Price", line2: "  raa kaa / phaen" },
      { x: COL2, y: 0,     w: W - COL2,      h: MID_Y,     line1: "  FREE", line2: "  14-day trial" },
      { x: 0,    y: MID_Y, w: COL1,         h: H - MID_Y, line1: "  About", line2: "  kue a-rai" },
      { x: COL1, y: MID_Y, w: COL2 - COL1,  h: H - MID_Y, line1: "  Team", line2: "  kuy gap team" },
      { x: COL2, y: MID_Y, w: W - COL2,      h: H - MID_Y, line1: "  Reviews", line2: "  ri-wu luk kha" },
    ];

    for (const { x, y, w, h, line1, line2 } of labels) {
      const textY1 = y + h / 2 - 55;
      const textY2 = y + h / 2 + 5;
      image.print(font64, x, textY1, { text: line1, alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER, alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE }, w, 70);
      image.print(font32, x, textY2, { text: line2, alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER, alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE }, w, 40);
    }
  } catch (err) {
    console.warn("⚠️  Font rendering failed (image will be colors only):", (err as Error).message);
  }

  await image.writeAsync(outputPath);
  console.log(`✅ Image saved: ${outputPath}`);
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
  const imagePath = path.join(tmpDir, "platform-richmenu.png");

  // 1. Generate image
  await generateImage(imagePath);

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
      "Content-Type": "image/png",
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
