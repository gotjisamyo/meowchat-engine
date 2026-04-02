#!/usr/bin/env python3
"""
Generate MeowChat Platform LINE OA Rich Menu Image — 2500×843 px
Usage: python3 scripts/generate-richmenu-image.py [output.png]
"""

import sys
from PIL import Image, ImageDraw, ImageFont

OUTPUT = sys.argv[1] if len(sys.argv) > 1 else "platform-richmenu.png"

W, H = 2500, 843
ROW_H = H // 2     # 421
COL_W = W // 3     # 833

# ─── Fonts ────────────────────────────────────────────────────────────────────

def load(path, size):
    return ImageFont.truetype(path, size)

BASE  = "/usr/share/fonts/truetype/noto/"
F_THAI_B = BASE + "NotoSansThai-Bold.ttf"
F_THAI_R = BASE + "NotoSansThai-Regular.ttf"
F_LAT_B  = BASE + "NotoSans-Bold.ttf"
F_LAT_R  = BASE + "NotoSans-Regular.ttf"
F_EMOJI  = BASE + "NotoColorEmoji.ttf"   # only 109px bitmap

fonts_label = [load(F_LAT_B, 72), load(F_THAI_B, 72)]   # [latin, thai]
fonts_sub   = [load(F_LAT_R, 42), load(F_THAI_R, 42)]
font_badge  = load(F_THAI_B, 36)
font_emoji  = load(F_EMOJI, 109)

# ─── Mixed-script text renderer ───────────────────────────────────────────────
# Each character picks Latin or Thai font based on Unicode block.

def is_thai(ch):
    return 0x0E00 <= ord(ch) <= 0x0E7F

def text_width(draw, text, fonts):
    w = 0
    for ch in text:
        f = fonts[1] if is_thai(ch) else fonts[0]
        w += draw.textlength(ch, font=f)
    return w

def draw_text_mixed(draw, cx, cy, text, fonts, fill):
    """Center-aligned mixed Thai/Latin text."""
    tw = text_width(draw, text, fonts)
    x = cx - tw / 2
    for ch in text:
        f = fonts[1] if is_thai(ch) else fonts[0]
        draw.text((x, cy), ch, font=f, fill=fill, anchor="lm")
        x += draw.textlength(ch, font=f)

# ─── Cell definitions ─────────────────────────────────────────────────────────
#  (col, row, bg_hex, icon, label, sublabel)

CELLS = [
    (0, 0, "#4F46E5", "🎮", "ดูตัวอย่าง",       "เห็นผลก่อนตัดสินใจ"),
    (1, 0, "#0284C7", "💰", "ราคา / แผน",       "เริ่มต้น ฿199/เดือน"),
    (2, 0, "#059669", "🚀", "ทดลองฟรี 14 วัน",   "ไม่ต้องใส่บัตรเครดิต"),
    (0, 1, "#374151", "❓", "เหมียวแชทคืออะไร",  "AI บอท LINE OA"),
    (1, 1, "#B45309", "📞", "คุยกับทีมงาน",      "ให้คำปรึกษาฟรี"),
    (2, 1, "#BE185D", "⭐", "รีวิวจากลูกค้า",    "ลูกค้าพูดถึงเรา"),
]

# ─── Helpers ──────────────────────────────────────────────────────────────────

def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def darken(rgb, f=0.65):
    return tuple(int(c * f) for c in rgb)

def draw_cell(img, draw, col, row, bg, icon, label, sub):
    x0, y0 = col * COL_W, row * ROW_H
    x1, y1 = x0 + COL_W, y0 + ROW_H
    bg_rgb  = hex_rgb(bg)
    dk_rgb  = darken(bg_rgb)

    # Solid background
    draw.rectangle([x0, y0, x1, y1], fill=bg_rgb)

    # Bottom-to-dark gradient (depth effect) — 80px fade
    fade = 80
    for i in range(fade):
        t = i / fade
        c = tuple(int(bg_rgb[j] * (1 - t) + dk_rgb[j] * t) for j in range(3))
        draw.line([(x0, y1 - fade + i), (x1, y1 - fade + i)], fill=c)

    cx = x0 + COL_W // 2

    # ── Emoji icon ───────────────────────────────────────────────────────────
    icon_y = y0 + ROW_H // 2 - 125
    em_size = 100
    try:
        em = Image.new("RGBA", (220, 220), (0, 0, 0, 0))
        ImageDraw.Draw(em).text((10, 10), icon, font=font_emoji, embedded_color=True)
        bbox = em.getbbox()
        if bbox:
            em = em.crop(bbox)
            em = em.resize((em_size, em_size), Image.LANCZOS)
        img.paste(em, (cx - em.width // 2, icon_y), em)
    except Exception:
        draw.text((cx, icon_y + em_size // 2), icon, font=fonts_label[0], fill="white", anchor="mm")

    # ── Main label ───────────────────────────────────────────────────────────
    label_y = y0 + ROW_H // 2 + 25
    draw_text_mixed(draw, cx, label_y, label, fonts_label, "white")

    # ── Sub-label ────────────────────────────────────────────────────────────
    sub_y = label_y + 65
    draw_text_mixed(draw, cx, sub_y, sub, fonts_sub, (220, 220, 220))

# ─── Main ─────────────────────────────────────────────────────────────────────

img  = Image.new("RGB", (W, H), "#1A1740")
draw = ImageDraw.Draw(img)

for args in CELLS:
    draw_cell(img, draw, *args)

# White dividers
WHITE = (255, 255, 255)
D = 3
draw.rectangle([COL_W - D, 0, COL_W + D, H], fill=WHITE)
draw.rectangle([COL_W * 2 - D, 0, COL_W * 2 + D, H], fill=WHITE)
draw.rectangle([0, ROW_H - D, W, ROW_H + D], fill=WHITE)

# ✨ Badge on "ทดลองฟรี" cell (top-right)
bx, by = COL_W * 2 + 18, 18
bw, bh = 260, 54
draw.rounded_rectangle([bx, by, bx + bw, by + bh], radius=10, fill="#FCD34D")
draw_text_mixed(draw, bx + bw // 2, by + bh // 2 + 2, "★ แนะนำ!", [load(F_LAT_B, 34), font_badge], "#78350F")

img.save(OUTPUT, "PNG", optimize=True)
print(f"✅ Saved: {OUTPUT} ({W}x{H})")
