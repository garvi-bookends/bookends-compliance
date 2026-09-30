# Step 2 of the report import: turn data/raw/parsed-reports.json into the two files the app is built from.
#   data/checklists.json        - the three Bookends checklists (FSSAI v1, FSSAI v2, maintenance docket)
#   data/import-2026-09.json    - the 11 units and 25 audits, with every line rating, remark and photo key
# Next step: node scripts/build-sql.mjs (turns these into D1 migrations and re-checks every score).
#   python3 scripts/prepare-import.py
#
# Every rule below that changes what a report says is written down in docs/DATA.md.
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'data', 'raw', 'parsed-reports.json')
PHOTOS = os.path.join(ROOT, 'data', 'photos')
IMPORT_DATE = '2026-09-26'   # the day these reports were loaded; fix deadlines count from here

D = json.load(open(RAW))

# ---------------------------------------------------------------- 1. normalise ratings
# First-visit (v1) reports write a number and a word, e.g. "1 / Minor". 0 = fail, 1 = partial, full marks = pass.
# The kitchen reports write passing ★ lines as "2 / Compliant" but count them as 4 in their totals, so any
# "Compliant" is a pass. The two AIKO first-visit reports repeat line K20; the repeat is dropped.
def normalise(r):
    seen, out = set(), []
    for l in r['lines']:
        if l['code'] in seen:
            continue
        seen.add(l['code'])
        mx = 4 if l['critical'] else 2
        if r['format'] == 'v1':
            raw, word = l['rating_raw'].split(' / ')
            w = word.lower()
            if re.match(r'^\d+$', raw):
                n = int(raw)
                if n == 0: res = 'fail'
                elif w in ('compliant',): res = 'pass'
                elif n >= mx: res = 'pass'
                else: res = 'partial'
            else:
                res = {'non-compliant': 'fail', 'compliant': 'pass', 'partial': 'partial'}[raw.lower()]
            l['result'] = res
        l['max'] = mx
        l['earned'] = {'pass': mx, 'partial': mx / 2, 'fail': 0}[l['result']]
        out.append(l)
    r['lines'] = out

for r in D['reports']:
    normalise(r)

# ---------------------------------------------------------------- 2. checklists
PAPER_AREAS = {'Menu information', 'Complaints', 'Receiving', 'Stock rotation', 'FSSAI licence', 'Display', 'Water', 'Cleaning system',
               'Pest control', 'Medical fitness', 'FoSTaC', 'Training', 'Records', 'Regulator follow-up'}
PAPER_V1 = {'S1', 'S2', 'S15', 'K15', 'K16', 'K19', 'K23', 'K24'}
PAPER_CATS = {'Statutory Documents', 'PM Records / Safety Training'}
sec_name = lambda s: re.sub(r'^([A-C])\.\s+', r'\1. ', s)

v2, v1, dk = {}, {}, {}
for r in D['reports']:
    for l in r['lines']:
        if r['format'] == 'v2' and l['ref'] not in v2:
            v2[l['ref']] = {'code': f"L{l['ref']}", 'ref': l['ref'], 'section': sec_name(l['section']), 'area': l['area'], 'applies': l['applies'],
                            'text': l['text'], 'guidance': l['verify'], 'critical': l['critical'], 'weight': 4 if l['critical'] else 2,
                            'kind': 'paperwork' if l['area'] in PAPER_AREAS else 'physical'}
        if r['format'] == 'v1' and l['code'] not in v1:
            v1[l['code']] = {'code': l['code'], 'ref': l['code'], 'section': 'A. Service Area' if l['code'][0] == 'S' else 'B. Kitchen Area',
                             'area': None, 'applies': 'Both', 'text': l['text'], 'guidance': None, 'critical': l['critical'],
                             'weight': 4 if l['critical'] else 2, 'kind': 'paperwork' if l['code'] in PAPER_V1 else 'physical'}
for k in D['dockets']:
    for i in k['items']:
        dk.setdefault(i['no'], {'code': f"M{i['no']}", 'ref': i['no'], 'section': i['category'], 'area': i['category'], 'applies': 'Both',
                                'text': i['text'], 'guidance': None, 'critical': i['criticality'] == 'Critical', 'criticality': i['criticality'],
                                'weight': 1, 'kind': 'paperwork' if i['category'] in PAPER_CATS else 'physical'})
order_v1 = lambda c: (c[0] != 'S', int(c[1:]))
checklists = [
    {'id': 1, 'domain': 'food', 'scheme': 'fssai1', 'version': 1, 'active': 0, 'frequency_days': 30,
     'name': 'FSSAI Schedule 4 & FDCA readiness (39 checkpoints)', 'description': 'Used for the first round of visits, Aug 2026.',
     'items': [v1[c] for c in sorted(v1, key=order_v1)]},
    {'id': 2, 'domain': 'food', 'scheme': 'fssai2', 'version': 2, 'active': 1, 'frequency_days': 30,
     'name': 'FSSAI internal food safety audit (60-line checklist)', 'description': 'Used from Sep 2026. Lines that do not apply to a unit are removed as N/A. Lines 31, 37 and 50 were N/A in every report so far, so their wording is not on file yet.',
     'items': [v2[k] for k in sorted(v2)]},
    {'id': 3, 'domain': 'maintenance', 'scheme': 'docket', 'version': 1, 'active': 1, 'frequency_days': 30,
     'name': 'Maintenance inspection docket (65 check points)', 'description': 'Internal maintenance walk-through. OK 1 point, Observation 0.5, Non-compliant 0.',
     'items': [dk[k] for k in sorted(dk)]},
]
json.dump(checklists, open(os.path.join(ROOT, 'data', 'checklists.json'), 'w'), indent=1, ensure_ascii=False)

# ---------------------------------------------------------------- 3. units
SITES = [
    ('capiche-vesu', 'Capiche Vesu', 'Capiche', 'Vesu', 'Surat', 'restaurant'),
    ('capiche-piplod', 'Capiche Piplod', 'Capiche', 'Piplod', 'Surat', 'restaurant'),
    ('capiche-university', 'Capiche University', 'Capiche', 'University', 'Ahmedabad', 'restaurant'),
    ('capiche-ambli', 'Capiche Ambli', 'Capiche', 'Ambli', 'Ahmedabad', 'restaurant'),
    ('aiko-pal', 'AIKO Pal', 'AIKO', 'Pal', 'Surat', 'restaurant'),
    ('aiko-ambli', 'AIKO Ambli', 'AIKO', 'Ambli', 'Ahmedabad', 'restaurant'),
    ('beshak-dumas', 'Beshak Dumas', 'Beshak', 'Dumas', 'Surat', 'restaurant'),
    ('ahd-hot-kitchen', 'Central Hot Kitchen', 'Central kitchen', 'Karnavati PG', 'Ahmedabad', 'kitchen'),
    ('ahd-bakery', 'Central Bakery Kitchen', 'Central kitchen', 'Karnavati PG', 'Ahmedabad', 'kitchen'),
    ('surat-hot-kitchen', 'Central Hot Kitchen', 'Central kitchen', None, 'Surat', 'kitchen'),
    ('surat-bakery', 'Central Bakery Kitchen', 'Central kitchen', None, 'Surat', 'kitchen'),
]
sites = [{'key': k, 'name': n, 'brand': b, 'area': a, 'city': c, 'kind': kd} for k, n, b, a, c, kd in SITES]

# ---------------------------------------------------------------- 4. audits
# Where a report disagrees with itself, the version two of its three sources agree on is used
# (line table, printed total, conclusion), and the audit carries a note for the Compliance Head to confirm.
FLAGS = {
    ('ahd-bakery', 1): 'The report prints 45/72 (62.5%), but its own line ratings and its conclusion ("closing those five reaches 59/72") both give 39/72. Imported as 39/72 (54.2%). Please confirm with the auditor.',
    ('beshak-dumas', 1): 'Line 37 (FSSAI licence number on menu) is marked Compliant in the table, but the printed total (91/140) and the conclusion count it as Major. Imported as Major to match the report total. Please confirm.',
    ('ahd-hot-kitchen', 1): 'The report carries no date. Set to 20 Aug 2026, the date of the bakery report from the same site visit.',
    ('surat-hot-kitchen', 1): 'The report carries no date. Set to 20 Aug 2026, the date of the bakery report from the same site visit.',
}

def photo_keys(names):
    return [f'evidence/import/{n}' for n in names if os.path.exists(os.path.join(PHOTOS, n))]

audits = []
for r in D['reports']:
    key = (r['site'], r['visit'])
    tpl = 2 if r['format'] == 'v2' else 1
    date = r['date'] or '2026-08-20'
    responses = []
    for l in r['lines']:
        code = l['code'] if r['format'] == 'v1' else f"L{l['ref']}"
        result = l['result']
        note = l.get('remark')
        if key == ('beshak-dumas', 1) and l.get('line') == 37:
            result, note = 'fail', (note + ' ' if note else '') + '[Table showed Compliant; report total counts it as Major.]'
        if r['format'] == 'v1':
            ev = r['evidence'].get(l['code'])
            if ev and ev['text'] and ev['text'] != note:
                note = f"{note}. {ev['text']}" if note and note not in ('—',) else ev['text']
        responses.append({'code': code, 'result': result, 'note': note, 'photos': photo_keys(l.get('photos') or [])})
    tot = next(s for s in r['sections'] if s['name'].lower().startswith('total'))
    audits.append({
        'site': r['site'], 'domain': 'food', 'template': tpl, 'visit': r['visit'], 'date': date,
        'auditor': (r['auditor'] or 'Vishal Patel').rstrip('.'), 'prepared_by': (r['prepared_by'] or '').rstrip('.') or None,
        'audit_type': (r['audit_type'] or '').rstrip('.') or None, 'time_range': r.get('time'),
        'reported': {'obtained': tot['obtained'], 'available': tot['available'], 'pct': tot['pct']},
        'summary': '\n'.join(r['conclusion']) or None, 'source_ref': r['file'], 'flag': FLAGS.get(key), 'responses': responses,
    })
for k in D['dockets']:
    audits.append({
        'site': k['site'], 'domain': 'maintenance', 'template': 3, 'visit': 1, 'date': k['date'], 'auditor': k['inspector'],
        'prepared_by': k['inspector'], 'audit_type': 'Internal maintenance walk-through', 'time_range': None,
        'reported': {'obtained': k['earned'], 'available': k['possible'], 'pct': k['score']},
        'summary': k['summary'], 'source_ref': k['file'], 'flag': None,
        'responses': [{'code': f"M{i['no']}", 'result': {'OK': 'pass', 'OBS': 'partial', 'NC': 'fail'}[i['status']], 'note': i['remark'], 'photos': []} for i in k['items']],
    })
audits.sort(key=lambda a: (a['date'], a['site'], a['domain']))
json.dump({'import_date': IMPORT_DATE, 'sites': sites, 'audits': audits},
          open(os.path.join(ROOT, 'data', 'import-2026-09.json'), 'w'), indent=1, ensure_ascii=False)
print('checklists:', [(c['scheme'], len(c['items'])) for c in checklists])
print('units', len(sites), '· audits', len(audits), '· line ratings', sum(len(a['responses']) for a in audits))
