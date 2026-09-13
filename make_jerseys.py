"""Jersey masters (PNG) -> shipped board art (JPG).

Was make_goose_jerseys.py until 2026-09-13. Renamed rather than copied when the red
champion jersey arrived: the conversion is identical for every master this generator
produces, and a second copy of it is the FP_SCALE mistake in a build script. Add a row
to JERSEYS below; do not write another converter.

Matches the Kasseistampers precedent exactly on the things that are matched-able:
560px wide, JPEG quality 84, 4:2:0 subsampling, progressive. Height follows the art,
because the reference back (560x418) is a landscape crop of a narrower pose and
forcing the goose back into it would cut the jersey.

Also erases the "Gemini Notebook" generator watermark, which sits on bare background
in the bottom right of every master and MUST NOT SHIP. A file that goes out with it
tells the board who made it. It was present on both goose masters and on the red.
"""
from PIL import Image, ImageFilter
import numpy as np, os, sys

OUT_W       = 560
QUALITY     = 84      # measured off jersey-kasseistampers-front.jpg
SUBSAMPLING = 2       # 4:2:0, measured off the same file
SIDE_MARGIN = 0.0732  # 41/560, measured off the same file
VERT_MARGIN = 0.006

def erase_watermark(im):
    """Fill the bottom-right watermark plate with background mirrored from above."""
    a = np.asarray(im).copy()
    h, w, _ = a.shape
    x0, y0 = int(w * 0.80), int(h * 0.94)
    band = a[y0 - (h - y0):y0, x0:]        # equally tall band of clean background above
    a[y0:, x0:] = band[::-1]                # mirror it down over the mark
    return Image.fromarray(a)

def jersey_bbox(im):
    g = im.convert('L')
    hp = np.abs(np.asarray(g).astype(float) -
                np.asarray(g.filter(ImageFilter.GaussianBlur(9))).astype(float))
    m = hp > 3.0
    h, w = m.shape
    cols = np.where(m.sum(axis=0) > h * 0.02)[0]
    rows = np.where(m.sum(axis=1) > w * 0.02)[0]
    return cols[0], rows[0], cols[-1], rows[-1]

def convert(src, dst):
    im = Image.open(src).convert('RGB')
    im = erase_watermark(im)
    l, t, r, b = jersey_bbox(im)
    jw, jh = r - l + 1, b - t + 1
    cw = jw / (1 - 2 * SIDE_MARGIN)
    ch = jh * (1 + 2 * VERT_MARGIN)
    cx, cy = (l + r) / 2, (t + b) / 2
    box = (round(cx - cw / 2), round(cy - ch / 2), round(cx + cw / 2), round(cy + ch / 2))
    box = (max(0, box[0]), max(0, box[1]), min(im.width, box[2]), min(im.height, box[3]))
    crop = im.crop(box)
    out_h = round(crop.height * OUT_W / crop.width)
    out = crop.resize((OUT_W, out_h), Image.LANCZOS)
    out.save(dst, 'JPEG', quality=QUALITY, subsampling=SUBSAMPLING,
             progressive=True, optimize=True)
    print(f'{dst:28s} jersey {jw}x{jh} -> crop {crop.width}x{crop.height} '
          f'-> {OUT_W}x{out_h}  {os.path.getsize(dst)/1024:.1f} KB')
    return dst

# THE SET. master -> shipped file.
JERSEYS = [
    ('goose_plumage_clean_front_jersey.png', 'jersey-goose-front.jpg'),
    ('goose_plumage_clean_back_jersey.png',  'jersey-goose-back.jpg'),
    ('poppy_red_front_jersey.png',           'jersey-red.jpg'),
]

if __name__ == '__main__':
    only = sys.argv[1:]
    for src, dst in JERSEYS:
        if only and dst not in only and src not in only:
            continue
        if not os.path.exists(src):
            print(f'{dst:28s} SKIPPED, master {src} is not here')
            continue
        convert(src, dst)
