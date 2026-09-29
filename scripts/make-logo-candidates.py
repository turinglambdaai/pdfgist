# Generates three logo candidates at 1024px + a comparison grid.
# A: document with a highlighted "gist" line   B: ring + paper plane   C: monogram P
from PIL import Image, ImageDraw, ImageFont

SIZE = 2048  # supersampled canvas, downscaled to 1024
OUT = "design"

TOP = (232, 146, 106)
BOTTOM = (196, 98, 62)

def gradient_square(size):
    im = Image.new("RGB", (size, size))
    d = ImageDraw.Draw(im)
    r = int(size * 0.215)
    m = int(size * 0.03)
    for y in range(size):
        t = y / (size - 1)
        color = tuple(int(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
        d.line([(0, y), (size, y)], fill=color)
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([m, m, size - m, size - m], radius=r, fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    return out

def base(size):
    im = gradient_square(size * 2).resize((size, size), Image.LANCZOS).convert("RGBA")
    d = ImageDraw.Draw(im)
    d.rounded_rectangle(
        [size * 0.03, size * 0.03, size * 0.97, size * 0.97],
        radius=size * 0.215, outline=(255, 255, 255, 0), width=0
    )
    return im

# ---- A: document with highlighted gist line ----
def cand_a():
    im = base(1024)
    d = ImageDraw.Draw(im)
    # white sheet with folded corner
    sw, sh = 520, 660
    x0, y0 = (1024 - sw) / 2, (1024 - sh) / 2
    fold = 110
    d.rounded_rectangle([x0, y0, x0 + sw, y0 + sh], radius=36, fill=(255, 255, 255, 255))
    d.polygon([(x0 + sw - fold, y0), (x0 + sw, y0 + fold), (x0 + sw - fold, y0 + fold)], fill=(232, 146, 106, 255))
    d.polygon([(x0 + sw - fold, y0), (x0 + sw - fold + 14, y0), (x0 + sw - fold + 14, y0 + fold - 14), (x0 + sw - fold, y0 + fold)], fill=(255, 255, 255, 255))
    # text lines; the second one is the highlighted gist
    lx, lw, lh = x0 + 80, sw - 170, 34
    ys = [y0 + 150, y0 + 260, y0 + 370, y0 + 480]
    widths = [lw, lw * 0.62, lw, lw * 0.8]
    colors = [(214, 220, 228, 255), (217, 119, 87, 255), (214, 220, 228, 255), (214, 220, 228, 255)]
    for y, w, c in zip(ys, widths, colors):
        d.rounded_rectangle([lx, y, lx + w, y + lh], radius=lh / 2, fill=c)
    return im

# ---- B: ring + paper plane (keeps the mark, ring balances it) ----
def plane_points(cx, cy, height):
    scale = height / 18
    x0 = cx - (21 * scale) / 2
    y0 = cy - height / 2
    return [(x0 + (x - 2) * scale, y0 + (y - 3) * scale) for x, y in
            [(2, 21), (23, 12), (2, 3), (2, 10), (17, 12), (2, 14)]]

def cand_b():
    im = base(1024)
    d = ImageDraw.Draw(im)
    cx = cy = 512
    ring_r = 330
    d.ellipse([cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r], outline=(255, 255, 255, 255), width=52)
    # plane centered INSIDE the ring, small enough that the ring frames it
    d.polygon(plane_points(cx - 10, cy + 6, 300), fill=(255, 255, 255, 255))
    return im

# ---- C: monogram P ----
def cand_c():
    im = base(1024)
    d = ImageDraw.Draw(im)
    font = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 640)
    text = "P"
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text((512 - tw / 2 - bbox[0], 512 - th / 2 - bbox[1]), text, font=font, fill=(255, 255, 255, 255))
    # small plane dot accent at top-right of the P bowl
    d.ellipse([660, 180, 724, 244], fill=(255, 255, 255, 255))
    return im

import os
os.makedirs(OUT, exist_ok=True)
for name, fn in [("cand-a.png", cand_a), ("cand-b.png", cand_b), ("cand-c.png", cand_c)]:
    im = fn()
    im.resize((512, 512), Image.LANCZOS).save(f"{OUT}/{name}", optimize=True)

# comparison grid
grid = Image.new("RGBA", (512 * 3 + 80 * 4, 512 + 160), (245, 242, 237, 255))
gd = ImageDraw.Draw(grid)
try:
    font = ImageFont.truetype("C:/Windows/Fonts/segoeuisl.ttf", 44)
except OSError:
    font = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 44)
for i, (name, label) in enumerate([("cand-a.png", "A 文档要点"), ("cand-b.png", "B 圆环纸飞机"), ("cand-c.png", "C 字母 P")]):
    x = 80 + i * (512 + 80)
    icon = Image.open(f"{OUT}/{name}")
    grid.paste(icon, (x, 80), icon)
    gd.text((x + 256, 512 + 40), label, font=font, fill=(28, 25, 23, 255), anchor="mm")
grid.convert("RGB").save(f"{OUT}/logo-candidates.png", optimize=True)
print("candidates ok")
