#!/usr/bin/env python3
"""
Build vuelta.html from vuelta.src.html.
Substitutes {{DEFAULT_POOL}} and {{BUILD_STAMP}} placeholders.
Appends redeploy comment to force CDN cache invalidation.
"""

import datetime

src = open('vuelta.src.html', encoding='utf-8').read()
assert '{{DEFAULT_POOL}}' in src, 'Missing {{DEFAULT_POOL}} placeholder'
assert '{{BUILD_STAMP}}' in src, 'Missing {{BUILD_STAMP}} placeholder'

stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%SZ')
build_comment = f'<!-- build:{stamp} -->'
redeploy_comment = f'\n<!-- redeploy {stamp} -->'

out = src.replace('{{DEFAULT_POOL}}', 'vuelta-2026').replace('{{BUILD_STAMP}}', build_comment)
out += redeploy_comment

with open('vuelta.html', 'w', encoding='utf-8') as f:
    f.write(out)

print(f'Built vuelta.html with stamp: {stamp}')
