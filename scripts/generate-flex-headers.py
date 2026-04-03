#!/usr/bin/env python3
"""
MeowChat Flex Message Hero Images — 1200×400 px
Brand: Art Oracle direction — purple/peach/cream
Usage: python3 generate-flex-headers.py [output_dir]

Font: NotoMerged-Bold (NotoSans-Bold merged with NotoSansThai-Bold)
so both Latin numerals/ASCII and Thai glyphs render correctly.
"""

import sys, os, math, tempfile
from PIL import Image, ImageDraw, ImageFont

# ─── Config ───────────────────────────────────────────────────────────────────

OUTPUT_DIR = sys.argv[1] if len(sys.argv) > 1 else "public/assets/flex"
W, H = 1200, 400

# ─── Brand Colors (Art Oracle) ────────────────────────────────────────────────

PURPLE_DARK  = (74, 45, 138)    # #4A2D8A
PURPLE_MID   = (110, 72, 170)   # #6E48AA
PURPLE_LIGHT = (177, 156, 217)  # #B19CD9
PURPLE_BAND  = (103, 65, 165)   # #6741A5
CREAM_BG     = (255, 253, 245)  # #FFFDF5
CREAM_BAND   = (237, 232, 248)  # #EDE8F8
PEACH        = (255, 183, 77)   # #FFB74D
PEACH_DARK   = (230, 152, 40)
TEXT_DARK    = (75, 55, 100)    # #4B3764
TEXT_WHITE   = (255, 255, 255)
TEXT_GOLD    = (255, 215, 0)    # #FFD700

# ─── Build merged font ────────────────────────────────────────────────────────
# NotoSans-Bold has full Latin/numeral glyphs; NotoSansThai-Bold has Thai glyphs.
# Merge them so a single font covers both scripts without tofu (replacement squares).

def build_merged_font():
    """Merge NotoSans-Bold + NotoSansThai-Bold into a temp file and return path."""
    try:
        from fontTools.merge import Merger
    except ImportError:
        # fontTools not available — fall back to NotoSansThai (Thai-only, numbers may tofu)
        print("WARNING: fontTools not available, using NotoSansThai-Bold (numbers may not render)")
        return "/usr/share/fonts/truetype/noto/NotoSansThai-Bold.ttf"

    base = "/usr/share/fonts/truetype/noto/"
    sans_bold = base + "NotoSans-Bold.ttf"
    thai_bold = base + "NotoSansThai-Bold.ttf"

    if not os.path.exists(sans_bold) or not os.path.exists(thai_bold):
        print(f"WARNING: Font files not found, falling back to Thai-only font")
        return thai_bold if os.path.exists(thai_bold) else sans_bold

    merged_path = os.path.join(tempfile.gettempdir(), "NotoMerged-Bold.ttf")
    if not os.path.exists(merged_path):
        merger = Merger()
        # NotoSans first so Latin glyphs take priority; Thai fills the rest
        merged = merger.merge([sans_bold, thai_bold])
        merged.save(merged_path)
        print(f"Merged font saved to {merged_path}")
    return merged_path

MERGED_FONT_PATH = build_merged_font()


def font(size):
    return ImageFont.truetype(MERGED_FONT_PATH, size)

# ─── Helpers ──────────────────────────────────────────────────────────────────

def vertical_gradient(size, top_rgb, bot_rgb, alpha=255):
    w, h = size
    img = Image.new("RGBA", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        r = int(top_rgb[0] * (1-t) + bot_rgb[0] * t)
        g = int(top_rgb[1] * (1-t) + bot_rgb[1] * t)
        b = int(top_rgb[2] * (1-t) + bot_rgb[2] * t)
        d.line([(0, y), (w, y)], fill=(r, g, b, alpha))
    return img


def draw_sparkles(draw, x0, y0, w, h, accent, n=10, seed=0):
    import random
    random.seed(seed)
    r, g, b = accent
    for _ in range(n):
        sx = random.randint(x0 + 20, x0 + w - 20)
        sy = random.randint(y0 + 20, y0 + h - 20)
        size = random.randint(4, 14)
        a = random.randint(80, 160)
        pts = []
        for i in range(8):
            angle = math.pi / 4 * i - math.pi / 2
            dist = size if i % 2 == 0 else size // 3
            pts.append((sx + dist * math.cos(angle), sy + dist * math.sin(angle)))
        draw.polygon(pts, fill=(r, g, b, a))


def draw_badge(draw, cx, y, text, bg_color, text_color, fnt, pad_x=24, pad_h=44, radius=22):
    """Draw a rounded-rect badge centered at cx, top at y."""
    bbox = fnt.getbbox(text)
    tw = bbox[2] - bbox[0]
    bw = tw + pad_x * 2
    bh = pad_h
    bx = cx - bw // 2
    by = y
    draw.rounded_rectangle([bx, by, bx + bw, by + bh], radius=radius, fill=bg_color)
    draw.text((cx, by + bh // 2), text, font=fnt, fill=text_color, anchor="mm")


# ─── Image builders ───────────────────────────────────────────────────────────

def make_purple_header(
    title, price, subtitle,
    badge=None,
    top_color=PURPLE_MID, bot_color=PURPLE_DARK,
):
    """Purple gradient header for Starter / Pro / Business."""
    canvas = Image.new("RGBA", (W, H))
    bg = vertical_gradient((W, H), top_color, bot_color, alpha=255)
    canvas.paste(bg.convert("RGB"))
    draw = ImageDraw.Draw(canvas, "RGBA")

    # Sparkles
    draw_sparkles(draw, 0, 0, W, H, PURPLE_LIGHT, n=18, seed=hash(title) % 9999)

    # Soft glow circles
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.ellipse([W * 3 // 4 - 200, H // 2 - 200, W * 3 // 4 + 200, H // 2 + 200],
               fill=(*PURPLE_LIGHT, 30))
    od.ellipse([80, H // 2 - 120, 360, H // 2 + 120], fill=(*PURPLE_LIGHT, 20))
    canvas.alpha_composite(overlay)

    draw = ImageDraw.Draw(canvas, "RGBA")

    # Main content — center left area
    cx = W // 2
    cy = H // 2

    # Badge (e.g. "⭐ ยอดนิยม")
    by_start = 40
    if badge:
        draw_badge(draw, cx, by_start, badge,
                   bg_color=(255, 215, 0, 230),
                   text_color=PURPLE_DARK,
                   fnt=font(30))
        cy -= 20

    # Price (large)
    draw.text((cx, cy - 40), price, font=font(90), fill=TEXT_WHITE, anchor="mm")

    # Title
    draw.text((cx, cy + 65), title, font=font(46), fill=TEXT_WHITE, anchor="mm")

    # Subtitle
    draw.text((cx, cy + 120), subtitle, font=font(30), fill=(*PURPLE_LIGHT, 220), anchor="mm")

    # Bottom bar
    draw.rectangle([0, H - 6, W, H], fill=(*PEACH, 200))

    return canvas.convert("RGB")


def make_trial_header():
    """Peach CTA header for free trial."""
    canvas = Image.new("RGBA", (W, H))
    bg = vertical_gradient((W, H), PEACH, PEACH_DARK, alpha=255)
    canvas.paste(bg.convert("RGB"))
    draw = ImageDraw.Draw(canvas, "RGBA")

    # Sparkles
    draw_sparkles(draw, 0, 0, W, H, (255, 255, 255), n=20, seed=42)

    # Soft glow
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.ellipse([W // 2 - 250, H // 2 - 250, W // 2 + 250, H // 2 + 250],
               fill=(255, 255, 255, 20))
    canvas.alpha_composite(overlay)

    draw = ImageDraw.Draw(canvas, "RGBA")

    cx = W // 2
    cy = H // 2

    # Badge
    draw_badge(draw, cx, 30, "ยอดนิยม",
               bg_color=(255, 255, 255, 220),
               text_color=PURPLE_MID,
               fnt=font(30))

    # Price
    draw.text((cx, cy - 30), "ฟรี 14 วัน", font=font(86), fill=TEXT_DARK, anchor="mm")

    # Subtitle lines
    draw.text((cx, cy + 60), "ทดลองใช้ฟรี ไม่ต้องใส่บัตรเครดิต", font=font(38), fill=TEXT_DARK, anchor="mm")
    draw.text((cx, cy + 110), "ครบฟีเจอร์ Starter เต็มรูปแบบ", font=font(28), fill=(*TEXT_DARK, 180), anchor="mm")

    # Bottom bar
    draw.rectangle([0, H - 6, W, H], fill=(*PURPLE_MID, 200))

    return canvas.convert("RGB")


def make_reviews_header():
    """Purple header for reviews section."""
    canvas = Image.new("RGBA", (W, H))
    bg = vertical_gradient((W, H), PURPLE_MID, PURPLE_DARK, alpha=255)
    canvas.paste(bg.convert("RGB"))
    draw = ImageDraw.Draw(canvas, "RGBA")

    draw_sparkles(draw, 0, 0, W, H, PURPLE_LIGHT, n=16, seed=777)

    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.ellipse([W - 300, -100, W + 100, 300], fill=(*PURPLE_LIGHT, 25))
    canvas.alpha_composite(overlay)

    draw = ImageDraw.Draw(canvas, "RGBA")

    cx = W // 2
    cy = H // 2

    # Stars
    draw.text((cx, 50), "⭐⭐⭐⭐⭐", font=font(36), fill=TEXT_GOLD, anchor="mm")

    # Headline
    draw.text((cx, cy - 20), "เสียงจากลูกค้าจริง", font=font(64), fill=TEXT_WHITE, anchor="mm")

    # Stats
    draw.text((cx, cy + 55), "200+ ร้านค้าทั่วไทย", font=font(38), fill=(*PURPLE_LIGHT, 230), anchor="mm")
    draw.text((cx, cy + 105), "คะแนน 4.9 / 5", font=font(30), fill=TEXT_GOLD, anchor="mm")

    # Bottom bar
    draw.rectangle([0, H - 6, W, H], fill=(*PEACH, 200))

    return canvas.convert("RGB")


# ─── Define all 5 headers ─────────────────────────────────────────────────────

HEADERS = [
    ("flex-header-trial.jpg",    make_trial_header),
    ("flex-header-starter.jpg",  lambda: make_purple_header(
        title="Starter",
        price="฿490 / เดือน",
        subtitle="3,000 ข้อความ · AI ตอบภาษาไทย",
        top_color=PURPLE_MID,
        bot_color=PURPLE_DARK,
    )),
    ("flex-header-pro.jpg",      lambda: make_purple_header(
        title="Pro",
        price="฿990 / เดือน",
        subtitle="15,000 ข้อความ · Broadcast · Human Handoff",
        badge="⭐ ยอดนิยม",
        top_color=(90, 58, 154),
        bot_color=PURPLE_DARK,
    )),
    ("flex-header-business.jpg", lambda: make_purple_header(
        title="Business",
        price="฿2,490 / เดือน",
        subtitle="50,000 ข้อความ · Team Inbox · CRM",
        top_color=PURPLE_DARK,
        bot_color=(35, 20, 70),
    )),
    ("flex-header-reviews.jpg",  make_reviews_header),
]

# ─── Generate ─────────────────────────────────────────────────────────────────

os.makedirs(OUTPUT_DIR, exist_ok=True)

for filename, builder in HEADERS:
    out_path = os.path.join(OUTPUT_DIR, filename)
    img = builder()
    img.save(out_path, "JPEG", quality=90, optimize=True)
    size_kb = os.path.getsize(out_path) // 1024
    print(f"  {filename} — {W}x{H} — {size_kb} KB")

print(f"\nDone: {len(HEADERS)} images saved to {OUTPUT_DIR}/")
