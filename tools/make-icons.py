"""Draw the Tabhaven icon (a teal rounded square holding a shelf of tab bars) at all sizes."""
import sys
from PIL import Image, ImageDraw

TEAL, AMBER, WHITE = (15, 118, 110, 255), (245, 158, 11, 255), (255, 255, 255, 255)

def icon(size):
    s = 8  # supersample
    W = size * s
    im = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, W - 1, W - 1], radius=int(W * 0.22), fill=TEAL)
    pad = W * 0.2
    bar_h = W * 0.11
    gap = W * 0.07
    y = W * 0.22
    widths = [0.6, 0.48, 0.55]
    for i, wf in enumerate(widths):
        d.rounded_rectangle([pad, y, pad + W * wf, y + bar_h], radius=bar_h / 2, fill=WHITE)
        y += bar_h + gap
    # the shelf
    d.rounded_rectangle([W * 0.14, y + gap * 0.2, W * 0.86, y + gap * 0.2 + bar_h * 0.9], radius=bar_h / 3, fill=AMBER)
    return im.resize((size, size), Image.LANCZOS)

out = sys.argv[1]
for n in (16, 32, 48, 128):
    icon(n).save(f'{out}/{n}.png')
