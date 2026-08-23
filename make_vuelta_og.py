"""Build vuelta-og.png from the repo's own tour-og.png.

Two changes, and the second is the one that matters. Recoloring alone would ship a
share card that still reads TOUR DE FRANCE 2026 while linking to the Vuelta board,
which is the same wrong-race-reads-as-real failure the rest of this work removed,
just on a link preview. So the eyebrow is repainted as well as recolored.

  1. the Tour gold becomes the Vuelta red, across the mountains and any gold pixel
  2. the eyebrow line is cleared and redrawn as VUELTA A ESPAÑA 2026

Everything else, the wordmark, the strapline, the moon, the mountain silhouette and
the dark ground, is untouched, so the two cards stay recognisably the same design.
"""
import io
from PIL import Image, ImageDraw, ImageFont

SRC = 'tour-og.png'
OUT = 'vuelta-og.png'

GOLD = (232, 179, 30)      # sampled from tour-og.png
RED = (216, 24, 48)        # #d81830, the Vuelta general classification red
GROUND = (27, 26, 23)      # sampled dark background
EYEBROW = 'VUELTA A ESPAÑA 2026'

# eyebrow text box, measured off the source
BOX = (60, 70, 700, 122)

im = Image.open(SRC).convert('RGB')
assert im.size == (1200, 630), im.size

# ---- 1. gold -> red, with tolerance so anti-aliased edges move too
px = im.load()
w, h = im.size
moved = 0
for y in range(h):
    for x in range(w):
        r, g, b = px[x, y]
        # near the gold hue: high red, mid green, low blue
        if r > 150 and 100 < g < 215 and b < 110 and r > b + 80:
            # keep the pixel's own brightness so anti-aliasing survives
            t = (r + g + b) / (GOLD[0] + GOLD[1] + GOLD[2])
            t = min(1.25, max(0.0, t))
            px[x, y] = (min(255, int(RED[0] * t)), min(255, int(RED[1] * t)), min(255, int(RED[2] * t)))
            moved += 1
print('recolored %d gold pixels' % moved)

# ---- 2. repaint the eyebrow
d = ImageDraw.Draw(im)
d.rectangle(BOX, fill=GROUND)


def load(size):
    for p in [r'C:\Windows\Fonts\seguibl.ttf', r'C:\Windows\Fonts\arialbd.ttf',
              r'C:\Windows\Fonts\verdanab.ttf', r'C:\Windows\Fonts\calibrib.ttf']:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


def draw_tracked(draw, xy, text, font, fill, tracking):
    """The original eyebrow is widely letter-spaced; PIL has no tracking, so step it."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + tracking
    return x


SIZE, TRACK = 30, 6.0
font = load(SIZE)
# match the source eyebrow width (about 455 px) by nudging tracking
probe = ImageDraw.Draw(Image.new('RGB', (10, 10)))
width = sum(probe.textlength(c, font=font) for c in EYEBROW) + TRACK * (len(EYEBROW) - 1)
print('eyebrow width %.0f px' % width)

end = draw_tracked(d, (72, 78), EYEBROW, font, RED, TRACK)
print('eyebrow drawn, ends at x=%.0f' % end)

im.save(OUT, 'PNG', optimize=True)
chk = Image.open(OUT)
print('%s written: %s %s' % (OUT, chk.size, chk.mode))
