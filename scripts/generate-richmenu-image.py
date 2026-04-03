#!/usr/bin/env python3
"""
MeowChat Platform Rich Menu — 2500×1686 px
Brand: Art Oracle direction — purple/lavender row0, cream+peach row1
Usage: python3 generate-richmenu-image.py [output.jpg]
"""

import sys, os, math, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUTPUT = sys.argv[1] if len(sys.argv) > 1 else "platform-richmenu.jpg"
ASSETS = "/home/got/Pictures"
BASE   = "/usr/share/fonts/truetype/noto/"
MERGED = "/tmp/NotoMerged-Bold.ttf"  # Thai + Latin merged (no tofu)

W, H   = 2500, 1686
COLS   = 3
ROWS   = 2
CW     = W // COLS   # 833
RH     = H // ROWS   # 843
BAND   = 160          # label band height
IMG_H  = RH - BAND   # cat image area: 683

# ─── Brand Colors (Art Oracle) ────────────────────────────────────────────────
PURPLE_TOP  = (110, 72, 170)   # #6E48AA
PURPLE_BOT  = (177, 156, 217)  # #B19CD9 lavender
PURPLE_BAND = (103, 65, 165)   # darker purple for band
CREAM_BG    = (255, 253, 245)  # #FFFDF5
CREAM_BAND  = (237, 232, 248)  # #EDE8F8 light lavender band
PEACH       = (255, 183, 77)   # #FFB74D CTA color
TEXT_DARK   = (75, 55, 100)    # #4B3764 dark purple text
TEXT_WHITE  = (255, 255, 255)

# ─── Fonts ────────────────────────────────────────────────────────────────────

def font(path, size):
    return ImageFont.truetype(path, size)

F_LABEL    = font(MERGED, 58)
F_SUBLABEL = font(MERGED, 34)
F_CTA_BIG  = font(MERGED, 78)
F_CTA_SUB  = font(MERGED, 40)
F_BADGE    = font(MERGED, 30)

# ─── Cell definitions ──────────────────────────────────────────────────────────
# type "purple": cat + purple gradient (row 0)
# type "cream":  cat + cream bg (row 1)
# type "cta":    no cat, full peach, big text (row 1 center)

CELLS = [
    # Row 0 — purple/lavender, cat images
    {
        "col": 0, "row": 0, "type": "purple",
        "img": "meowchat_info_cat_clay_1775158207645.png",
        "label": "เหมียวแชทคืออะไร",
    },
    {
        "col": 1, "row": 0, "type": "purple",
        "img": "meowchat_sample_cat_clay_1775158139197.png",
        "label": "ดูตัวอย่าง",
    },
    {
        "col": 2, "row": 0, "type": "purple",
        "img": "meowchat_review_cat_clay_1775158250657.png",
        "label": "รีวิวลูกค้า",
        "badge": "200+ ร้าน",
    },
    # Row 1 — cream + peach CTA
    {
        "col": 0, "row": 1, "type": "cream",
        "img": "meowchat_price_cat_clay_1775158171510.png",
        "label": "ราคาและแผน",
        "sublabel": "เริ่มต้นใช้ฟรี",
    },
    {
        "col": 1, "row": 1, "type": "cta",
        "label": "ทดลองฟรี",
        "sublabel": "14 วัน ไม่ต้องใส่บัตร",
    },
    {
        "col": 2, "row": 1, "type": "cream",
        "img": "meowchat_support_cat_clay_1775158229403.png",
        "label": "คุยกับทีมงาน",
    },
]

# ─── Helpers ──────────────────────────────────────────────────────────────────

def cover_crop(img_path, cw, img_h):
    cat = Image.open(img_path).convert("RGBA")
    sw, sh = cat.size
    ratio  = max(cw / sw, img_h / sh)
    nw     = math.ceil(sw * ratio)
    nh     = math.ceil(sh * ratio)
    cat    = cat.resize((nw, nh), Image.LANCZOS)
    left   = (nw - cw) // 2
    top    = (nh - img_h) // 2
    return cat.crop((left, top, left + cw, top + img_h))

def vertical_gradient(size, top_rgb, bot_rgb, alpha=255):
    w, h  = size
    img   = Image.new("RGBA", (w, h))
    d     = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        r = int(top_rgb[0] * (1-t) + bot_rgb[0] * t)
        g = int(top_rgb[1] * (1-t) + bot_rgb[1] * t)
        b = int(top_rgb[2] * (1-t) + bot_rgb[2] * t)
        d.line([(0, y), (w, y)], fill=(r, g, b, alpha))
    return img

def draw_sparkles(draw, x0, y0, cw, img_h, accent, n=7, seed=0):
    random.seed(seed)
    r, g, b = accent
    for _ in range(n):
        sx   = random.randint(x0 + 20, x0 + cw - 20)
        sy   = random.randint(y0 + 20, y0 + img_h - 20)
        size = random.randint(6, 18)
        a    = random.randint(100, 180)
        pts  = []
        for i in range(8):
            angle = math.pi / 4 * i - math.pi / 2
            dist  = size if i % 2 == 0 else size // 3
            pts.append((sx + dist * math.cos(angle), sy + dist * math.sin(angle)))
        draw.polygon(pts, fill=(r, g, b, a))

def glow_circle(canvas, cx, cy, radius, rgb, alpha=50):
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    r, g, b = rgb
    for i in range(3):
        r2 = radius - i * radius // 4
        d.ellipse([cx-r2, cy-r2, cx+r2, cy+r2], fill=(r, g, b, alpha//(i+1)))
    canvas.alpha_composite(overlay)

# ─── Build canvas ──────────────────────────────────────────────────────────────

canvas = Image.new("RGBA", (W, H), (*CREAM_BG, 255))
draw   = ImageDraw.Draw(canvas, "RGBA")

for cell in CELLS:
    col  = cell["col"]
    row  = cell["row"]
    x0   = col * CW
    y0   = row * RH
    cx   = x0 + CW // 2
    band_y = y0 + IMG_H

    # ── TYPE: PURPLE (row 0) ────────────────────────────────────────────────
    if cell["type"] == "purple":
        # 1. Purple gradient bg
        bg = vertical_gradient((CW, IMG_H), PURPLE_TOP, PURPLE_BOT, alpha=255)
        canvas.paste(bg.convert("RGB"), (x0, y0))

        # 2. Cat image (semi-transparent over gradient)
        cat = cover_crop(os.path.join(ASSETS, cell["img"]), CW, IMG_H)
        # Lighten cat slightly so purple shows through
        blend = Image.new("RGBA", (CW, IMG_H), (*PURPLE_TOP, 20))
        cat   = Image.alpha_composite(cat, blend)
        canvas.alpha_composite(cat, (x0, y0))

        # 3. Glow
        glow_circle(canvas, cx, y0 + IMG_H // 2, int(CW * 0.4), PURPLE_BOT, alpha=40)

        # 4. Top dark fade
        top_fade = Image.new("RGBA", (CW, 80), (0, 0, 0, 0))
        td = ImageDraw.Draw(top_fade)
        for y in range(60):
            a = int(70 * (1 - y / 60))
            td.line([(0, y), (CW, y)], fill=(0, 0, 0, a))
        canvas.alpha_composite(top_fade, (x0, y0))

        # 5. Sparkles (white/light purple)
        draw_sparkles(draw, x0, y0, CW, IMG_H, (220, 210, 240), n=7, seed=x0+y0)

        # 6. Purple band
        draw.rectangle([x0, band_y, x0 + CW, y0 + RH], fill=(*PURPLE_BAND, 255))
        draw.line([(x0, band_y), (x0 + CW, band_y)], fill=(255, 255, 255, 60), width=2)

        # 7. White label
        draw.text((cx, band_y + BAND // 2), cell["label"],
                  font=F_LABEL, fill=TEXT_WHITE, anchor="mm")

        # 8. Badge
        if cell.get("badge"):
            btext = cell["badge"]
            bx, by, bw, bh = x0 + 16, y0 + 16, 200, 48
            draw.rounded_rectangle([bx, by, bx+bw, by+bh], radius=24,
                                   fill=(255, 255, 255, 220))
            draw.text((bx + bw//2, by + bh//2), btext,
                      font=F_BADGE, fill=(*PURPLE_TOP,), anchor="mm")

    # ── TYPE: CREAM (row 1, non-CTA) ───────────────────────────────────────
    elif cell["type"] == "cream":
        # 1. Cream background
        draw.rectangle([x0, y0, x0 + CW, y0 + RH], fill=(*CREAM_BG, 255))

        # 2. Cat image at lower opacity
        cat = cover_crop(os.path.join(ASSETS, cell["img"]), CW, IMG_H)
        # Make cat lighter / more transparent to sit on cream
        cat_arr = cat.split()
        if len(cat_arr) == 4:
            r, g, b, a = cat_arr
        else:
            r, g, b = cat_arr
            a = Image.new("L", cat.size, 200)
        # Reduce opacity to 75% so cream shows
        a = a.point(lambda x: int(x * 0.72))
        cat_light = Image.merge("RGBA", (r, g, b, a))
        canvas.alpha_composite(cat_light, (x0, y0))

        # 3. Soft light glow (lavender)
        glow_circle(canvas, cx, y0 + IMG_H // 2, int(CW * 0.38), PURPLE_BOT, alpha=30)

        # 4. Lavender band
        draw.rectangle([x0, band_y, x0+CW, y0+RH], fill=(*CREAM_BAND, 255))
        draw.line([(x0, band_y), (x0+CW, band_y)], fill=(*PURPLE_BOT, 80), width=2)

        # 5. Dark label
        draw.text((cx, band_y + BAND // 2 - (12 if cell.get("sublabel") else 0)),
                  cell["label"], font=F_LABEL, fill=TEXT_DARK, anchor="mm")

        # 6. Sub-label
        if cell.get("sublabel"):
            draw.text((cx, band_y + BAND // 2 + 36),
                      cell["sublabel"], font=F_SUBLABEL,
                      fill=(*PURPLE_TOP, 180), anchor="mm")

    # ── TYPE: CTA (peach full-cell, no cat) ────────────────────────────────
    elif cell["type"] == "cta":
        # 1. Full peach fill
        draw.rectangle([x0, y0, x0 + CW, y0 + RH], fill=(*PEACH, 255))

        # 2. Subtle diagonal texture (light sparkles)
        draw_sparkles(draw, x0, y0, CW, RH, (255, 255, 255), n=12, seed=999)

        # 3. Big CTA text centered vertically
        text_cy = y0 + RH // 2 - 30
        draw.text((cx, text_cy), cell["label"],
                  font=F_CTA_BIG, fill=TEXT_DARK, anchor="mm")

        # 4. Sub text
        draw.text((cx, text_cy + 80), cell["sublabel"],
                  font=F_CTA_SUB, fill=(*TEXT_DARK, 180), anchor="mm")

        # 5. Top badge "ยอดนิยม"
        bx, by, bw, bh = cx - 100, y0 + 24, 200, 52
        draw.rounded_rectangle([bx, by, bx+bw, by+bh], radius=26,
                               fill=(255, 255, 255, 200))
        draw.text((bx+bw//2, by+bh//2), "ยอดนิยม",
                  font=F_BADGE, fill=(*PURPLE_TOP,), anchor="mm")

# ─── Dividers ─────────────────────────────────────────────────────────────────

for c in [CW, CW * 2]:
    draw.line([(c, 0), (c, H)], fill=(200, 190, 220, 120), width=3)
draw.line([(0, RH), (W, RH)], fill=(200, 190, 220, 120), width=3)

# ─── Save ─────────────────────────────────────────────────────────────────────

out_dir = os.path.dirname(OUTPUT)
if out_dir:
    os.makedirs(out_dir, exist_ok=True)
canvas.convert("RGB").save(OUTPUT, "JPEG", quality=90, optimize=True)
print(f"✅ Saved: {OUTPUT} ({W}x{H})")
