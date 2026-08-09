#!/usr/bin/env python3
"""Col du Fantasy - single-source board build.
One source (board.src.html) regenerates every board file. The ONLY per-file
difference is DEFAULT_POOL; the build stamp is shared across one run. Emits the
three live files plus a staging copy.
Usage: python3 build_boards.py [--staging-only]   (on Dragon: py -3)
"""
import sys, hashlib
from datetime import datetime, timezone
SRC = 'board.src.html'
# One stamp per run, computed once at import. tour.html and index.html must stay
# byte-identical, so the stamp must not be allowed to tick between two writes.
STAMP = '<!-- build:%s -->' % datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%SZ')
def h(s): return hashlib.sha256(s.encode()).hexdigest()[:12]
def build(default_pool):
    s = open(SRC, encoding='utf-8').read()
    assert '{{DEFAULT_POOL}}' in s, 'source is missing the {{DEFAULT_POOL}} placeholder'
    assert '{{BUILD_STAMP}}' in s, 'source is missing the {{BUILD_STAMP}} placeholder'
    return s.replace('{{DEFAULT_POOL}}', default_pool).replace('{{BUILD_STAMP}}', STAMP)
def write(path, content):
    open(path,'w',encoding='utf-8').write(content); print(f"  {path}: {len(content)} bytes  sha={h(content)}")
if __name__ == '__main__':
    staging_only = '--staging-only' in sys.argv
    tour = build('col-du-fantasy')      # primary pool board
    board = build('')                   # generic pool board (resolves ?pool=)
    print(f"Build stamp: {STAMP}")
    print("Staging build:")
    write('tour-staging.html', tour)    # identical to tour.html, served at a separate URL for testing
    if not staging_only:
        print("Live build:")
        write('tour.html', tour)
        write('index.html', tour)       # byte-identical mirror of tour.html
        write('board.html', board)
    print("done.")
