# Generates NSIS installer art (sidebar 164x314, header 150x57) in the
# PDFGist brand: terracotta gradient + white paper plane. Outputs BMPs.
from PIL import Image, ImageDraw

TOP = (232, 146, 106)
BOTTOM = (196, 98, 62)
PLANE_24 = [(2, 21), (23, 12), (2, 3), (2, 10), (17, 12), (2, 14)]

def gradient(w, h):
    im = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / max(h - 1, 1)
        color = tuple(int(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
        d.line([(0, y), (w, y)], fill=color)
    return im

def plane_points(cx, cy, height):
    # plane bbox in 24-unit space: x 2..23 (21 wide), y 3..21 (18 tall)
    scale = height / 18
    x0 = cx - (21 * scale) / 2
    y0 = cy - height / 2
    return [(x0 + (x - 2) * scale, y0 + (y - 3) * scale) for x, y in PLANE_24]

def with_plane(w, h, plane_h):
    ss = 4
    big = gradient(w * ss, h * ss).convert("RGB")
    d = ImageDraw.Draw(big)
    d.polygon(plane_points(w * ss / 2, h * ss / 2, plane_h * ss), fill=(255, 255, 255))
    return big.resize((w, h), Image.LANCZOS)

with_plane(164, 314, 110).save("src-tauri/installer/sidebar.bmp")
with_plane(150, 57, 34).save("src-tauri/installer/header.bmp")
print("installer art ok")
