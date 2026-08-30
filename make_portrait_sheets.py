#!/usr/bin/env python3
"""Tile every harvested rider-*.jpg into contact sheets so they can be LOOKED AT.

This exists because of a rule in CLAUDE.md that was learned the hard way: a file
returning HTTP 200 with a valid free licence is NOT evidence that the image shows the
rider. Four of seventeen Commons images passed both checks and were unusable, one of
them a picture of traffic cones with a rider somewhere in the distance. The only check
that catches that is a person reading the sheet.

It also re-checks the EXIF orientation rule from the same section. Every file is opened
with ImageOps.exif_transpose before it is drawn, so a sheet shows exactly what the board
will show, and a portrait that shipped rotated would be visible here rather than live.

Writes portrait-sheet-N.png into the scratch directory, not the repo.
"""
import glob
import json
import os
import re
import sys

from PIL import Image, ImageDraw, ImageOps

SRC = 'vuelta.src.html'
CW, CH, COLS, PER = 118, 146, 9, 54


def riders():
    s = open(SRC, encoding='utf-8').read()
    return {r['b']: r for r in json.loads(re.search(r'^const RIDERS = (\[.*?\]);\s*$', s, re.M).group(1))}


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else '.'
    R = riders()
    files = sorted(glob.glob('rider-*.jpg'), key=lambda f: int(re.search(r'(\d+)', f).group(1)))
    print('%d harvested portraits' % len(files))
    made = []
    for page in range((len(files) + PER - 1) // PER):
        chunk = files[page * PER:(page + 1) * PER]
        rows = (len(chunk) + COLS - 1) // COLS
        sheet = Image.new('RGB', (CW * COLS, CH * rows), 'white')
        d = ImageDraw.Draw(sheet)
        for i, f in enumerate(chunk):
            b = int(re.search(r'(\d+)', f).group(1))
            x, y = (i % COLS) * CW, (i // COLS) * CH
            im = ImageOps.exif_transpose(Image.open(f))
            if im.mode != 'RGB':
                im = im.convert('RGB')
            im = ImageOps.contain(im, (CW - 6, CH - 26))
            sheet.paste(im, (x + 3, y + 2))
            nm = R.get(b, {}).get('r', '?')
            d.text((x + 4, y + CH - 22), '%d %s' % (b, nm[:15]), fill='black')
        p = os.path.join(out_dir, 'portrait-sheet-%d.png' % (page + 1))
        sheet.save(p)
        made.append(p)
        print(p, len(chunk))
    return made


if __name__ == '__main__':
    main()
