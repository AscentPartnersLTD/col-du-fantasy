#!/usr/bin/env python3
"""Harvest free-licensed Wikimedia Commons portraits for the Vuelta startlist and bake
them into the repo as tier 2 of the rider portrait chain.

Tier 1 is the ASO hotlink (harvest_aso_portraits.py). This is what the board falls back
to when an ASO URL stops resolving, which it will do all at once if the signatures ever
rotate. Coverage is expected to be PATCHY and that is fine: a rider with no tier 2 falls
through to the initials circle, which is tier 3 and always works.

HOW A RIDER IS IDENTIFIED. Not by a Commons text search, which is how you end up with a
photo of traffic cones. The route is Wikidata: search for the rider by name, keep only
entities that are human (P31=Q5) AND a racing cyclist (P106=Q2309784), and take that
entity's image (P18). P18 is the picture Wikidata asserts IS this person, so the subject
is established before the file is ever fetched.

THAT IS STILL NOT PROOF. CLAUDE.md records four of seventeen Commons images that passed
HTTP 200 and a free licence and were unusable anyway: a peloton shot, a distant rider,
traffic cones. So this script also writes a contact sheet, and nothing ships until a
person has LOOKED at it. --reject takes a comma-separated list of bibs to drop.

TWO RULES FROM CLAUDE.md THAT ARE LOAD-BEARING HERE:
  1. ImageOps.exif_transpose BEFORE any crop or resize. Image.open does not apply the
     EXIF orientation tag, so a portrait-orientation source gets cropped on its raw
     sensor pixels and ships rotated 90 degrees with the head cut off. Only 1 of 17
     files carried a bad tag last time, so spot-checking will miss it.
  2. Look at every image. See above.

Licences: only CC0, public domain, CC BY and CC BY-SA are accepted. Anything else,
including any file whose licence cannot be read, is skipped rather than guessed at.

Usage:
  py -3 harvest_commons_portraits.py --dry-run [--limit N]
  py -3 harvest_commons_portraits.py [--reject 12,45]
"""
import io
import json
import os
import re
import sys
import time
import unicodedata
from urllib.parse import quote
import requests
from PIL import Image, ImageOps

SRC = 'vuelta.src.html'
WD = 'https://www.wikidata.org/w/api.php'
COMMONS = 'https://commons.wikimedia.org/w/api.php'
UA = {'User-Agent': 'ColDuFantasy-portrait-harvest/1.0 (private cycling pool; allen@ascentpartnersltd.com)'}
CYCLIST = {'Q2309784'}          # racing cyclist
HUMAN = 'Q5'
OUT_SIZE = 400                  # matches the belgian-*.jpg the Kasseistampers card ships
QUALITY = 84                    # matches the measured Kasseistampers precedent
# Elements Commons hides for machine readers, dropped WITH their content: the Artist
# field is often 'Unknown author<span style="display: none;">Unknown author</span>',
# and a naive tag strip ships that name twice into the credit line.
HIDDEN_EL = re.compile(r'''<(\w+)[^>]*style=["'][^"']*display:\s*none[^"']*["'][^>]*>.*?</\1>''', re.S | re.I)
FREE = re.compile(r'^(cc0|cc[ -]by([ -]sa)?([ -][\d.]+)?|public domain|pd)', re.I)
BEGIN, END = '/* LOCAL_PORTRAIT:BEGIN */', '/* LOCAL_PORTRAIT:END */'
CBEGIN, CEND = '/* RIDER_PHOTO_CREDITS:BEGIN */', '/* RIDER_PHOTO_CREDITS:END */'


def fold(s):
    s = unicodedata.normalize('NFD', s.lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z]', '', s)


def riders():
    s = open(SRC, encoding='utf-8').read()
    return json.loads(re.search(r'^const RIDERS = (\[.*?\]);\s*$', s, re.M).group(1))


class ApiDown(Exception):
    """The API refused or failed, which is NOT the same as the rider having no photo.

    The first run of this script read a Wikimedia rate limit as an empty search result
    and reported 151 riders as having no Wikidata entry, Eddie Dunbar and Milan Vader
    among them. That is the same failure shape CLAUDE.md records twice: a remote source
    that fails soft makes "no data" and "we were refused" look identical. So a refusal
    raises here, and the caller reports it as an error rather than as an absence."""


def api(session, url, **params):
    params.setdefault('format', 'json')
    params.setdefault('maxlag', 5)
    delay = 1.0
    for attempt in range(5):
        try:
            r = session.get(url, params=params, headers=UA, timeout=30)
            if r.status_code == 200:
                d = r.json()
                # maxlag and ratelimit come back as HTTP 200 with an error body
                if isinstance(d, dict) and 'error' in d:
                    code = (d['error'] or {}).get('code', '')
                    if code in ('maxlag', 'ratelimited'):
                        time.sleep(delay); delay *= 2; continue
                    raise ApiDown('api error %r' % code)
                return d
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(delay); delay *= 2; continue
            raise ApiDown('HTTP %d' % r.status_code)
        except requests.RequestException as e:
            if attempt == 4:
                raise ApiDown(repr(e))
            time.sleep(delay); delay *= 2
    raise ApiDown('gave up after 5 attempts')


def full_name(rider):
    """RIDERS holds "P. Roglic" for most riders but plain "Carlos Rodriguez" for the two
    who need a given name to be told apart. Prepending r["n"] blindly produced the search
    term "Carlos Carlos Rodriguez", which matched nothing."""
    surname = re.sub(r'^[A-Z]\.\s*', '', rider['r'])
    given = (rider.get('n') or '').strip()
    if given and fold(surname).startswith(fold(given)):
        return surname, surname
    return surname, ('%s %s' % (given, surname)).strip()


def name_agrees(surname, hay):
    """A shared surname token of real length, over every label and alias in every
    language. Requiring an ENGLISH label rejected Skjelmose, Govekar and Paret-Peintre,
    who are all on Wikidata with a photo and simply have no en label. Requiring the WHOLE
    surname rejected Dversnes Lavik, whom Wikidata records as Dversnes."""
    hay = fold(hay)
    toks = [fold(t) for t in surname.split()]
    toks = [t for t in toks if len(t) >= 4]
    if not toks:
        return True
    return any(t in hay for t in toks)


def wikidata_image(session, rider):
    """Return (commons_filename, qid) for this rider, or (None, reason)."""
    surname, full = full_name(rider)
    d = api(session, WD, action='wbsearchentities', search=full,
            language='en', uselang='en', type='item', limit=10)
    if not d or not d.get('search'):
        return None, 'no wikidata match for "%s"' % full
    ids = [h['id'] for h in d['search']]
    # what the search itself matched on, which is often the only place the name appears
    hit_text = {h['id']: ' '.join(filter(None, [h.get('label'), h.get('description'),
                (h.get('match') or {}).get('text')])) for h in d['search']}
    e = api(session, WD, action='wbgetentities', ids='|'.join(ids), props='claims|labels|aliases')
    if not e or 'entities' not in e:
        return None, 'wikidata entities call failed'
    for qid in ids:                                          # search order is relevance order
        ent = e['entities'].get(qid) or {}
        cl = ent.get('claims') or {}

        def vals(pid):
            out = []
            for c in cl.get(pid, []):
                dv = ((c.get('mainsnak') or {}).get('datavalue') or {}).get('value')
                if isinstance(dv, dict) and 'id' in dv:
                    out.append(dv['id'])
                elif isinstance(dv, str):
                    out.append(dv)
            return out

        if HUMAN not in vals('P31'):
            continue
        if not (set(vals('P106')) & CYCLIST):
            continue
        # it has to actually be this rider, not a namesake cyclist. Every label and every
        # alias in every language, plus whatever the search matched on.
        hay = [hit_text.get(qid, '')]
        for lv in (ent.get('labels') or {}).values():
            hay.append(lv.get('value', ''))
        for al in (ent.get('aliases') or {}).values():
            hay.extend(a.get('value', '') for a in al)
        if not name_agrees(surname, ' '.join(hay)):
            continue
        img = vals('P18')
        if not img:
            return None, 'wikidata has %s but no image' % qid
        return img[0], qid
    return None, 'no wikidata cyclist entity for "%s"' % full


def commons_meta(session, filename):
    d = api(session, COMMONS, action='query', titles='File:' + filename, prop='imageinfo',
            iiprop='url|extmetadata', iiurlwidth=900)
    if not d:
        return None
    pages = (d.get('query') or {}).get('pages') or {}
    for p in pages.values():
        ii = (p.get('imageinfo') or [None])[0]
        if not ii:
            continue
        m = ii.get('extmetadata') or {}

        def g(k):
            v = (m.get(k) or {}).get('value')
            if not isinstance(v, str):
                return None
            # Commons Artist fields are HTML, and many carry a HIDDEN duplicate for
            # machine readers: 'Unknown author<span style="display: none;">Unknown
            # author</span>'. Stripping tags naively ships the name twice. Drop hidden
            # elements WITH their content first, since they are not meant to be read.
            t = HIDDEN_EL.sub(' ', v)
            t = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', t)).strip()
            # belt and braces for any other exact doubling the markup leaves behind
            w = t.split()
            if w and len(w) % 2 == 0 and w[:len(w) // 2] == w[len(w) // 2:]:
                t = ' '.join(w[:len(w) // 2])
            return t.strip(' ,;')

        return {
            'url': ii.get('thumburl') or ii.get('url'),
            # Some files answer without a descriptionurl. The file page is derivable, and
            # a credit line whose link goes nowhere is not an attribution.
            'page': ii.get('descriptionurl') or
                    ('https://commons.wikimedia.org/wiki/File:' +
                     quote(filename.replace(' ', '_'), safe='')),
            'licence': g('LicenseShortName') or '',
            'artist': g('Artist') or '',
        }
    return None


def download(session, url):
    """upload.wikimedia.org rate-limits harder than the API does: an unpaced run of 162
    images got 429 on all but eighteen. Back off and retry, and raise rather than return
    a partial, so a throttled image is never mistaken for a rider without a photo."""
    delay = 1.5
    for attempt in range(6):
        r = session.get(url, headers=UA, timeout=60)
        if r.status_code == 200:
            return r.content
        if r.status_code in (429, 500, 502, 503, 504):
            time.sleep(delay)
            delay *= 1.8
            continue
        raise ApiDown('HTTP %d' % r.status_code)
    raise ApiDown('throttled, gave up after 6 attempts')


# Face detection is OPTIONAL and the harvest works without it, but it is what turns a
# Commons photo into an avatar rather than a square cut out of a race scene.
#
# TWO DEAD ENDS WORTH NOT REPEATING. opencv-python 5.0 ships NO Haar cascade XML at all
# (cv2.data.haarcascades is an empty directory) and 5.0 removed cv2.CascadeClassifier
# outright. The first attempt at this reported "no face detected" for all 162 portraits,
# which is indistinguishable from 162 genuinely faceless photos: the detector was never
# running. That is the fail-open shape CLAUDE.md keeps recording, so the two states are
# now separate. _DET_STATE says whether the detector is present at all and is printed
# every run; if it is down, the report says so instead of blaming the photos.
#
# YuNet is the detector OpenCV 5 does ship, and it is a better fit here than Haar ever
# was: it holds up on helmets, sunglasses and side-on roadside shots, which is most of
# what a cycling photo looks like. Its model is fetched once into TEMP, because it is a
# dev-time dependency of this script and not an asset the board serves.
_MODEL_DIR = os.path.join(os.environ.get('TEMP', '.'), 'cdf-yunet')
_MODEL_NAME = 'face_detection_yunet_2023mar.onnx'
_MODEL_URL = ('https://github.com/opencv/opencv_zoo/raw/main/models/'
              'face_detection_yunet/' + _MODEL_NAME)
_DET = None
_DET_STATE = 'not loaded'
try:
    import cv2
    import numpy as np
except Exception as _e:                                      # noqa: BLE001
    cv2 = None
    _DET_STATE = 'opencv not installed: %r' % _e


def load_detector():
    global _DET, _DET_STATE
    if cv2 is None or not hasattr(cv2, 'FaceDetectorYN'):
        _DET_STATE = 'cv2.FaceDetectorYN unavailable'
        return
    path = os.path.join(_MODEL_DIR, _MODEL_NAME)
    if not os.path.exists(path):
        os.makedirs(_MODEL_DIR, exist_ok=True)
        try:
            r = requests.get(_MODEL_URL, headers=UA, timeout=120)
            if r.status_code != 200:
                _DET_STATE = 'model fetch HTTP %d' % r.status_code
                return
            open(path, 'wb').write(r.content)
        except Exception as e:                               # noqa: BLE001
            _DET_STATE = 'model fetch failed: %r' % e
            return
    try:
        _DET = cv2.FaceDetectorYN.create(path, '', (320, 320), 0.6, 0.3, 5000)
        _DET_STATE = 'ok, YuNet'
    except Exception as e:                                   # noqa: BLE001
        _DET_STATE = 'YuNet would not load: %r' % e


MIN_FACE_PX = 60        # in the 900px-wide fetch. Below this the rider is too far away
MIN_FACE_FRAC = 0.20    # the face must be at least this much of the finished square
FACE_PAD = 2.7          # crop width as a multiple of the face width, head and shoulders


def find_face(im):
    """Largest face in the image as (x, y, w, h) in the image's own pixels, or None.
    Not a guarantee and not treated as one: a hit is used to frame the crop, a miss only
    means this image needs a person to look at it, and a hit that is TINY is the one
    strong signal that the photo is a race scene rather than a portrait."""
    if _DET is None:
        return None
    a = np.array(im)[:, :, ::-1].copy()                      # PIL RGB to OpenCV BGR
    h, w = a.shape[:2]
    scale = 1.0
    if max(w, h) > 1024:                                     # YuNet is happier and faster small
        scale = 1024.0 / max(w, h)
        a = cv2.resize(a, (int(w * scale), int(h * scale)))
        h, w = a.shape[:2]
    try:
        _DET.setInputSize((w, h))
        _, faces = _DET.detect(a)
    except Exception:                                        # noqa: BLE001
        return None
    if faces is None or not len(faces):
        return None
    best = max(faces, key=lambda f: f[2] * f[3])
    return tuple(int(v / scale) for v in best[:4])


def square(im):
    """Returns (400x400 RGB image, note). EXIF FIRST, ALWAYS: Image.open does not apply
    the orientation tag, so cropping before transposing works on raw sensor pixels and
    ships a portrait rotated 90 degrees with the head clipped. That is a real defect this
    repo shipped once, in the Thibau Nys photo.

    The crop is centered on the detected face when there is one. Without detection it
    falls back to a square biased to the upper third, because a person in a photograph
    has their head above the middle of the frame far more often than not."""
    im = ImageOps.exif_transpose(im)
    if im.mode != 'RGB':
        im = im.convert('RGB')
    w, h = im.size
    face = find_face(im)
    note = ''
    if face:
        fx, fy, fw, fh = face
        if fw < MIN_FACE_PX:
            return None, 'face is only %dpx wide, too far away to read at avatar size' % fw
        s = int(min(max(fw * FACE_PAD, fh * FACE_PAD), w, h))
        # The pad CLAMPS to the source, so a small or short original cannot be tightened
        # and the face ends up a minor part of a frame full of bike. Bib 128 was exactly
        # that: a face over the pixel floor, in a crop that was mostly a bicycle. The
        # pixel test and the fraction test catch different failures, so both are applied.
        if fw / float(s) < MIN_FACE_FRAC:
            return None, ('face is %dpx in a %dpx crop, %.0f%% of the frame, too small'
                          % (fw, s, 100.0 * fw / s))
        cx = fx + fw // 2
        cy = fy + int(fh * 0.55)                 # a shade below eye level, for the chin
        left = max(0, min(w - s, cx - s // 2))
        top = max(0, min(h - s, cy - s // 2))
        note = 'face %dpx' % fw
    else:
        # No face is a DROP, not a warning, now that the detector is reliable: it found
        # one in 161 of 162. The single miss was bib 215, a rider alone on a road at
        # middle distance, which is the picture CLAUDE.md warns about. A dropped rider
        # falls through to the initials circle, which is the correct outcome and costs
        # nothing. If the detector is ever down, main() says so and this reads differently.
        return None, 'no face found'
    out = im.crop((left, top, left + s, top + s)).resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS)
    return out, note


def main():
    dry = '--dry-run' in sys.argv
    limit = 0
    if '--limit' in sys.argv:
        limit = int(sys.argv[sys.argv.index('--limit') + 1])
    reject = set()
    if '--reject' in sys.argv:
        reject = {int(x) for x in sys.argv[sys.argv.index('--reject') + 1].split(',') if x.strip()}

    cache_path = os.path.join(os.environ.get('TEMP', '.'), 'cdf-portrait-lookup.json')
    if '--cache' in sys.argv:
        cache_path = sys.argv[sys.argv.index('--cache') + 1]
    rs = riders()
    if limit:
        rs = rs[:limit]
    session = requests.Session()
    load_detector()
    print('face detector: %s' % _DET_STATE)
    # The lookup is 370 paced API calls and takes about three minutes; the download pass
    # is the part that needs re-running after a throttle. Cache the lookup OUTSIDE the
    # repo, and delete the cache to re-check Wikidata.
    # WATCH OUT: the cache holds the OUTPUT of commons_meta, artist and licence already
    # cleaned. So a fix to how those are parsed is invisible until the cache is deleted,
    # which cost one confusing round of "the fix did not take". Change commons_meta,
    # delete the cache.
    cached = None
    if not dry and os.path.exists(cache_path):
        try:
            raw = json.load(open(cache_path, encoding='utf-8'))
            by_bib = {r['b']: r for r in rs}
            cached = [(by_bib[int(b)], m) for b, m in raw.items() if int(b) in by_bib]
            print('using cached wikidata lookup: %d riders (%s)' % (len(cached), cache_path))
        except Exception:                                    # noqa: BLE001
            cached = None
    print('looking up %d riders on wikidata' % len(rs))

    def one(r):
        fn, why = wikidata_image(session, r)
        if not fn:
            return r, None, why
        meta = commons_meta(session, fn)
        if not meta or not meta.get('url'):
            return r, None, 'commons metadata unavailable for ' + fn
        if not FREE.match((meta['licence'] or '').strip()):
            return r, None, 'licence not accepted: %r' % meta['licence']
        meta['file'] = fn
        return r, meta, None

    # SERIAL, on purpose. The Wikimedia API asks for a single connection and this is a
    # two-call lookup per rider, so 184 riders is under 400 requests and takes a couple
    # of minutes. Four threads got the whole run throttled last time.
    hits, misses, errors = [], [], []
    for i, r in enumerate([] if cached else rs, 1):
        try:
            _, meta, why = one(r)
        except ApiDown as e:
            errors.append((r, str(e)))
            time.sleep(2)
            continue
        (hits.append((r, meta)) if meta else misses.append((r, why)))
        time.sleep(0.2)
        if i % 25 == 0:
            print('  ...%d/%d, %d found, %d errors' % (i, len(rs), len(hits), len(errors)))

    if cached:
        hits = cached
    else:
        try:
            json.dump({str(r['b']): m for r, m in hits}, open(cache_path, 'w', encoding='utf-8'))
        except Exception:                                    # noqa: BLE001
            pass
    print('')
    print('wikidata portraits found: %d of %d' % (len(hits), len(rs)))
    if errors:
        # LOUD. These riders were never actually checked, so they are not evidence of
        # anything. Re-run rather than treating them as riders without a photo.
        print('API REFUSED OR FAILED for %d riders, THESE WERE NOT CHECKED:' % len(errors))
        for r, why in errors:
            print('  %-4s %-24s %s' % (r['b'], r['r'], why))
    if dry:
        for r, meta in hits[:12]:
            print('  %-4s %-24s %-14s %s' % (r['b'], r['r'], meta['licence'], meta['file'][:52]))
        print('  ... and %d more' % max(0, len(hits) - 12))
        print('')
        print('no portrait, first 15 reasons:')
        for r, why in misses[:15]:
            print('  %-4s %-24s %s' % (r['b'], r['r'], why))
        return 0

    kept, creds, failed_dl, too_small = {}, [], [], []
    if '--credits-only' in sys.argv:
        # Rebuild the map and the credit lines from the cached lookup and whatever
        # rider-*.jpg is already on disk. For fixing a credit line without re-fetching
        # 145 images; it re-derives nothing about which photos passed the screen.
        for r, meta in hits:
            b = r['b']
            if b in reject or not os.path.exists('rider-%d.jpg' % b):
                continue
            kept[b] = 'rider-%d.jpg' % b
            creds.append((r['r'], meta['artist'], meta['licence'], meta['page']))
        print('credits-only: %d files on disk' % len(kept))
    for r, meta in ([] if '--credits-only' in sys.argv else hits):
        b = r['b']
        if b in reject:
            continue
        try:
            im, note = square(Image.open(io.BytesIO(download(session, meta['url']))))
            if im is None:
                too_small.append((b, r['r'], note))
                continue
            path = 'rider-%d.jpg' % b
            im.save(path, 'JPEG', quality=QUALITY, subsampling='4:2:0', progressive=True, optimize=True)
            kept[b] = path
            creds.append((r['r'], meta['artist'], meta['licence'], meta['page']))
            time.sleep(0.4)
        except Exception as e:                               # noqa: BLE001
            failed_dl.append((b, r['r'], repr(e)))
            print('  image failed %s %r' % (b, e))

    # drop any rider-*.jpg that a --reject removed, so the repo never carries an orphan
    for f in [] if '--credits-only' in sys.argv else os.listdir('.'):
        m = re.match(r'^rider-(\d+)\.jpg$', f)
        if m and int(m.group(1)) not in kept:
            os.remove(f)
            print('  removed stale %s' % f)

    s = open(SRC, encoding='utf-8').read()
    body = ','.join('%d:%s' % (b, json.dumps(kept[b])) for b in sorted(kept))
    i, j = s.index(BEGIN), s.index(END)
    s = s[:i] + BEGIN + ' var LOCAL_PORTRAIT = {' + body + '}; ' + s[j:]

    def esc(t):
        return (t or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')

    html = ''.join(
        '<div class="kas-cr"><b>%s</b> %s, %s. <a href="%s" target="_blank" rel="noopener">Wikimedia Commons</a></div>'
        % (esc(n), esc(a) or 'Wikimedia Commons contributor', esc(l), esc(p))
        for n, a, l, p in sorted(creds))
    i, j = s.index(CBEGIN), s.index(CEND)
    s = s[:i] + CBEGIN + ' var RIDER_PHOTO_CREDITS=' + json.dumps(html) + '; ' + s[j:]

    # preserve this file's line endings: CRLF, except the bare-LF block at lines 30-48
    lines = s.split('\n')
    out = []
    for k, l in enumerate(lines):
        if k == len(lines) - 1:
            out.append(l.encode('utf-8'))
            break
        out.append(l.encode('utf-8') + (b'\n' if 30 <= k + 1 <= 48 else b'\r\n'))
    open(SRC, 'wb').write(b''.join(out))
    print('')
    if failed_dl:
        print('IMAGE DOWNLOAD FAILED for %d riders, they have NO tier 2 this run:' % len(failed_dl))
        for b, nm, why in failed_dl:
            print('  %-4s %-24s %s' % (b, nm, why))
    if too_small:
        print('DROPPED, not a usable portrait (%d), these fall through to the initials circle:' % len(too_small))
        for b, nm, why in too_small:
            print('  %-4s %-24s %s' % (b, nm, why))
    if _DET is None:
        print('FACE DETECTION DID NOT RUN (%s). Nothing was screened and nothing was'
              ' dropped, so read the contact sheets in full before shipping.' % _DET_STATE)
    print('wrote %d local portraits and %d credits into %s' % (len(kept), len(creds), SRC))
    print('NOW LOOK AT THEM: py -3 make_portrait_sheets.py')
    return 0


if __name__ == '__main__':
    sys.exit(main())
