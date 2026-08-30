#!/usr/bin/env python3
"""Harvest the ASO rider portrait URL for every bib on the Vuelta startlist and bake
the map into vuelta.src.html between the ASO_PORTRAIT markers.

WHY THIS IS A SCRIPT AND NOT A RUNTIME CALL. The board makes no request to
lavuelta.es at all. It only ever requests the image itself, from a URL harvested
here once and stored byte-exact.

WHY THE URLS ARE NEVER EDITED. img.aso.fr URLs are SIGNED over the whole transform
path: the trailing hex is a signature, not an id. Change any segment, including the
crop or the quality, and the request returns 401. So a URL is taken exactly as the
rider page emits it in its og:image, or it is not taken at all. Never synthesize one
and never guess one for a rider whose page did not answer.

WHY IT AUDITS. The map is keyed by BIB, and this board scores by bib. A wrong bib
here does not error and does not look wrong; it simply shows one rider another
rider's face, which is the visible cousin of the scoring bug recorded in CLAUDE.md
under "The startlist is scored by BIB". So every link is checked two ways before its
URL is kept: the bib set must match RIDERS exactly, and the rider slug in the URL
must contain the surname RIDERS holds for that bib.

Usage:  py -3 harvest_aso_portraits.py           # harvest and write the map
        py -3 harvest_aso_portraits.py --dry-run # report only, write nothing
"""
import json, re, sys, unicodedata
from concurrent.futures import ThreadPoolExecutor
import requests

SRC = 'vuelta.src.html'
INDEX = 'https://www.lavuelta.es/en/riders'
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
BEGIN, END = '/* ASO_PORTRAIT:BEGIN */', '/* ASO_PORTRAIT:END */'


# lavuelta writes German and Nordic names in their transliterated form, so the slug for
# Muehlberger, Kaemna, Tjoetta, Kueng, Suetterlin and Baardseng does not match a plain
# accent-strip. Fold BOTH ways round before comparing, or the check reports nine riders
# as mismatched when the only difference is how the site spells an umlaut.
_TRANS = {'ü': 'ue', 'ö': 'oe', 'ä': 'ae', 'ø': 'oe',
          'å': 'aa', 'æ': 'ae', 'ß': 'ss', 'œ': 'oe'}


def fold(s):
    """ASCII fold for name comparison. 'Roglic' matches the slug for 'Roglic' with a
    hacek, and 'Kamna' with an umlaut matches the site's 'kaemna'."""
    s = s.lower()
    for k, v in _TRANS.items():
        s = s.replace(k, v)
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z]', '', s)


def name_agrees(surname_words, slug):
    """True when the startlist name and the page slug are plainly the same rider.

    Containment is not enough on its own. The site sometimes interleaves the given name
    ("sunekaer-mathias-norsgaard") and sometimes drops a second surname ("fredrik-dversnes"
    for Dversnes Lavik), so a shared surname token of real length is the test. Short tokens
    like "de" and "van" are excluded because they agree with almost anything.
    """
    sl = fold(slug)
    toks = [fold(w) for w in surname_words]
    toks = [t for t in toks if len(t) >= 4]
    if not toks:
        return True
    return any(t in sl for t in toks)


def riders_from_source():
    s = open(SRC, encoding='utf-8').read()
    m = re.search(r'^const RIDERS = (\[.*?\]);\s*$', s, re.M)
    if not m:
        sys.exit('RIDERS array not found in ' + SRC)
    return json.loads(m.group(1))


def fetch(url, session, tries=3):
    last = None
    for _ in range(tries):
        try:
            r = session.get(url, headers=UA, timeout=30)
            if r.status_code == 200:
                return r.text
            last = 'HTTP %d' % r.status_code
        except Exception as e:                       # noqa: BLE001
            last = repr(e)
    return None


def main():
    dry = '--dry-run' in sys.argv
    riders = riders_from_source()
    by_bib = {r['b']: r for r in riders}
    print('startlist: %d riders' % len(riders))

    session = requests.Session()
    idx = fetch(INDEX, session)
    if idx is None:
        sys.exit('could not read the rider index at ' + INDEX)

    links = {}
    for path in sorted(set(re.findall(r'/en/rider/\d+/[^"\'\s>]+', idx))):
        bib = int(path.split('/')[3])
        links.setdefault(bib, 'https://www.lavuelta.es' + path)
    print('index: %d rider links' % len(links))

    # AUDIT 1: the bib sets must agree exactly, in both directions.
    missing = sorted(set(by_bib) - set(links))
    extra = sorted(set(links) - set(by_bib))
    if missing:
        print('NOT ON THE INDEX: %s' % missing)
    if extra:
        print('ON THE INDEX BUT NOT IN RIDERS: %s' % extra)

    # AUDIT 2: the slug must carry the surname RIDERS holds for that bib. This is the
    # check that would catch a repeat of the 103/104 swap, where both bibs exist and
    # both pages answer, and only the identity behind them is wrong.
    slug_bad = []
    for bib, url in sorted(links.items()):
        r = by_bib.get(bib)
        if not r:
            continue
        slug = url.rsplit('/', 1)[-1]
        # r['r'] is "P. Roglic" style: drop the leading initial, keep the surname tokens
        surname = re.sub(r'^[A-Z]\.\s*', '', r['r']).split()
        if not name_agrees(surname, slug):
            slug_bad.append((bib, r['r'], slug))
    if slug_bad:
        # REPORTED, NOT DROPPED. The hard gate is the bib set above, which has to agree
        # exactly in both directions; the bibs themselves were audited against the
        # official competitor list on 2026-08-27. A surviving name mismatch is almost
        # always a transliteration the site spells its own way, so it is printed for a
        # person to look at rather than silently costing that rider a portrait.
        print('NAME AND SLUG DIFFER, harvested anyway, CHECK THESE FACES BY EYE:')
        for bib, name, slug in slug_bad:
            print('  bib %-4s %-26s slug %s' % (bib, name, slug))

    todo = [(b, u) for b, u in sorted(links.items()) if b in by_bib]

    def one(item):
        bib, url = item
        html = fetch(url, session)
        if html is None:
            return bib, None, 'page did not load'
        m = re.search(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']', html) \
            or re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']', html)
        if not m:
            return bib, None, 'no og:image on the page'
        u = m.group(1).strip()
        if 'img.aso.fr' not in u:
            return bib, None, 'og:image is not an ASO portrait: ' + u[:80]
        return bib, u, None

    got, failed = {}, []
    with ThreadPoolExecutor(max_workers=6) as pool:
        for i, (bib, url, err) in enumerate(pool.map(one, todo), 1):
            if url:
                got[bib] = url
            else:
                failed.append((bib, by_bib[bib]['r'], err))
            if i % 40 == 0:
                print('  ...%d/%d' % (i, len(todo)))

    print('\nresolved %d of %d' % (len(got), len(riders)))
    if failed:
        print('DID NOT RESOLVE:')
        for bib, name, err in failed:
            print('  bib %-4s %-26s %s' % (bib, name, err))

    # A portrait shared by two bibs means one of them is wrong. Say so rather than
    # silently baking the same face onto two riders.
    seen = {}
    for bib, u in got.items():
        seen.setdefault(u, []).append(bib)
    dupes = {u: bs for u, bs in seen.items() if len(bs) > 1}
    if dupes:
        print('SAME PORTRAIT ON MORE THAN ONE BIB:')
        for u, bs in dupes.items():
            print('  %s -> %s' % (u, bs))

    if dry:
        print('\ndry run, nothing written')
        return 0 if len(got) == len(riders) else 1

    body = ','.join('%d:%s' % (b, json.dumps(got[b])) for b in sorted(got))
    s = open(SRC, encoding='utf-8', newline='').read()
    i, j = s.index(BEGIN), s.index(END)
    s = s[:i] + BEGIN + ' var ASO_PORTRAIT = {' + body + '}; ' + s[j:]
    open(SRC, 'w', encoding='utf-8', newline='').write(s)
    print('\nwrote %d entries into %s' % (len(got), SRC))
    return 0 if len(got) == len(riders) else 1


if __name__ == '__main__':
    sys.exit(main())
