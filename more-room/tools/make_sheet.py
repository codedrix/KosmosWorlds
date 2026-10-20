"""
@kosmos-system   More Room (world://more-room.micknerks, world://more-room-mr.micknerks)
@kosmos-owner    micknerks

A side-by-side sheet: the CEO's two holographic-glass references beside the
More Room renders, so the look can be judged against what was asked for.

Usage (Pillow through uv; the references stay outside this repo):
  uv run --with pillow python more-room/tools/make_sheet.py <ref1> <ref2> <renders_png_dir> <out.jpg>

The sheet is a review image for the CEO, not a world asset: write it outside
the repo (the references are his, not ours to redistribute).
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

REF1, REF2, PNG, OUT = sys.argv[1:5]
CELL_W, CELL_H, CAP, GAP, TITLE = 800, 450, 34, 12, 64
BG, FG, DIM = (8, 12, 20), (235, 240, 245), (95, 230, 255)

# (path, caption) per cell, three per row.
ROWS = [
    [(REF1, "Reference 1: the glass wall"), (os.path.join(PNG, "vr-morning-eye.png"), "VR, Morning, from the eye"), (os.path.join(PNG, "mr-morning-eye.png"), "MR, Morning, against a real wall")],
    [(REF2, "Reference 2: floating panels"), (os.path.join(PNG, "vr-triage-eye.png"), "VR, Triage: the fan and the draft"), (os.path.join(PNG, "mr-triage-eye.png"), "MR, Triage, against a real wall")],
    [(os.path.join(PNG, "vr-focus-eye.png"), "VR, Focus: the dark glass shell"), (os.path.join(PNG, "vr-morning-overview.png"), "VR, the floor ring and grid"), (os.path.join(PNG, "vr-morning-left.png"), "VR, the capsules and the window")],
]


def font(size):
    for name in ("segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def fit(path):
    """The image scaled to cover the cell, centre-cropped (no letterbox bars)."""
    im = Image.open(path).convert("RGB")
    s = max(CELL_W / im.width, CELL_H / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    x, y = (im.width - CELL_W) // 2, (im.height - CELL_H) // 2
    return im.crop((x, y, x + CELL_W, y + CELL_H))


cols = max(len(r) for r in ROWS)
W = GAP + cols * (CELL_W + GAP)
H = TITLE + len(ROWS) * (CELL_H + CAP + GAP) + GAP
sheet = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(sheet)
d.text((GAP + 4, 14), "More Room v2: the holographic-glass pass, beside the CEO's two references", font=font(30), fill=FG)
cap = font(22)
for r, row in enumerate(ROWS):
    for c, (path, label) in enumerate(row):
        x = GAP + c * (CELL_W + GAP)
        y = TITLE + r * (CELL_H + CAP + GAP)
        sheet.paste(fit(path), (x, y))
        d.rectangle((x, y, x + CELL_W - 1, y + CELL_H - 1), outline=DIM if "Reference" in label else (40, 60, 80), width=2)
        d.text((x + 6, y + CELL_H + 5), label, font=cap, fill=DIM if "Reference" in label else FG)
sheet.save(OUT, quality=88)
print(f"wrote {OUT} ({W}x{H})")
