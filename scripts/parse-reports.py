# Step 1 of the report import: read every audit report in source-reports/ and write
#   data/raw/parsed-reports.json  - one record per report: header, every checklist line, section totals, conclusion
#   data/photos/<sha1>.<ext>       - every photo found in a report table cell, named by content hash
# Next step: scripts/prepare-import.py.  Needs Python 3.9+ and PyMuPDF (pip install -r scripts/requirements.txt).
#   python3 scripts/parse-reports.py
import zipfile, re, json, os, sys, glob, hashlib
from xml.etree import ElementTree as ET
import fitz

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DL = os.path.join(ROOT, 'source-reports')
OUT = os.path.join(ROOT, 'data', 'raw', 'parsed-reports.json')
MEDIA = os.path.join(ROOT, 'data', 'photos')
os.makedirs(os.path.dirname(OUT), exist_ok=True)
os.makedirs(MEDIA, exist_ok=True)
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
PR = '{http://schemas.openxmlformats.org/package/2006/relationships}'

# Report file -> (unit key, visit number). Add new reports here.
FILES = {
    'Capiche_Vesu_1st Audit_Report  FINAL.docx': ('capiche-vesu', 1),
    'Capiche_Vesu_FSSAI_2nd Audit_Report.docx': ('capiche-vesu', 2),
    'Capiche_UNI_REPORT 1st Audit.docx': ('capiche-university', 1),
    'Capiche_University_FSSAI_2nd Audit_Report.docx': ('capiche-university', 2),
    'PIPLOD_REPORT_1st Audit.docx': ('capiche-piplod', 1),
    'Capiche_Piplod_FSSAI_2nd Audit_Report.docx': ('capiche-piplod', 2),
    'Capiche Ambli_REPORT_1st Audit.docx': ('capiche-ambli', 1),
    'Capiche_Ambli_FSSAI_2nd Audit_Report.docx': ('capiche-ambli', 2),
    'AIKO_REPORT 1st Audit.docx': ('aiko-pal', 1),
    'AIKO_Pal_FSSAI_2nd Audit_Report.docx': ('aiko-pal', 2),
    'AIKO_AMBLI_1st Audit REPORT.docx': ('aiko-ambli', 1),
    'AIKO_Ambli_FSSAI_2nd Audit_Report.docx': ('aiko-ambli', 2),
    'Beshak_Surat_FSSAI_1st Audit_Report.docx': ('beshak-dumas', 1),
    'Ahmedabad Prep Kitchen 1st Audit Report.docx': ('ahd-hot-kitchen', 1),
    'Ahmedabad_Hot_Kitchen2nd Audit_Report.docx': ('ahd-hot-kitchen', 2),
    'Ahmedabad Bekary 1st Audit Report.docx': ('ahd-bakery', 1),
    'Ahmedabad_Bakery_Kitchen_2nd Audit_Report.docx': ('ahd-bakery', 2),
    'Surat Bakery 1st audit report.docx': ('surat-bakery', 1),
    'Surat prep kitchen 1st audit report.docx': ('surat-hot-kitchen', 1),
}
DOCKETS = {
    'CAPICHE_Vesu_Inspection_Docket_Bookends.pdf': 'capiche-vesu',
    'CAPICHE_University_Inspection_Docket_Bookends.pdf': 'capiche-university',
    'CAPICHE_Piplod_Inspection_Docket_Bookends.pdf': 'capiche-piplod',
    'CAPICHE_Ambli_Inspection_Docket_Bookends.pdf': 'capiche-ambli',
    'AIKO_Pal_Inspection_Docket_Bookends.pdf': 'aiko-pal',
    'AIKO_Ambli_Inspection_Docket_Bookends (1).pdf': 'aiko-ambli',
}
MONTHS = {m: i + 1 for i, m in enumerate(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'])}

def paras(el):
    out = []
    for p in el.iter(W + 'p'):
        t = ''.join(n.text or '' for n in p.iter(W + 't'))
        t = re.sub(r'\s+', ' ', t).strip()
        if t: out.append(t)
    return out

def cell(tc, rels, z, saved):
    ps = paras(tc)
    imgs = []
    for b in tc.iter(A + 'blip'):
        target = rels.get(b.get(R + 'embed'))
        if not target: continue
        data = z.read('word/' + target)
        ext = os.path.splitext(target)[1].lower().lstrip('.')
        h = hashlib.sha1(data).hexdigest()[:16]
        name = f'{h}.{ext}'
        if name not in saved:
            open(os.path.join(MEDIA, name), 'wb').write(data)
            saved.add(name)
        imgs.append(name)
    return ps, imgs

def iso_from_text(s):
    m = re.search(r'(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})', s or '')
    if m and m.group(2).lower() in MONTHS:
        return f'{m.group(3)}-{MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}'
    m = re.search(r'(\d{2})/(\d{2})/(\d{4})', s or '')
    if m: return f'{m.group(3)}-{m.group(2)}-{m.group(1)}'
    return None

RATING_WORDS = {'compliant': 'pass', 'partial': 'partial', 'minor': 'partial', 'major': 'fail', 'non-compliant': 'fail', 'noncompliant': 'fail', 'na': 'na', 'n/a': 'na'}

def parse_docx(fname):
    z = zipfile.ZipFile(os.path.join(DL, fname))
    rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('word/_rels/document.xml.rels')).iter(PR + 'Relationship')}
    root = ET.fromstring(z.read('word/document.xml'))
    body = root.find(W + 'body')
    saved = set(os.listdir(MEDIA))
    rep = {'file': fname, 'lines': [], 'sections': [], 'evidence': {}, 'conclusion': [], 'header': {}, 'title': None}
    fmt = None
    in_conclusion = False
    for child in body:
        if child.tag == W + 'p':
            t = ' '.join(paras(child))
            if not t: continue
            if 'Checklist Report' in t: fmt = 'v2'
            if 'Compliance Readiness Report' in t: fmt = 'v1'
            if re.search(r'lines assessed', t): rep['title'] = t
            if t.startswith('Conclusion'): in_conclusion = True; continue
            if in_conclusion: rep['conclusion'].append(t.lstrip('• ').strip())
            elif t.startswith('Grade:'): rep['grade_text'] = t
            continue
        if child.tag != W + 'tbl': continue
        section = None
        for tr in child.findall(W + 'tr'):
            cells = [cell(tc, rels, z, saved) for tc in tr.findall(W + 'tc')]
            texts = [' ¶ '.join(p) for p, _ in cells]
            flat = [re.sub(r' ¶ ', ' ', x).strip() for x in texts]
            if not any(flat): continue
            # header key/value tables
            if len(cells) in (2, 4) and flat[0] in ('Outlet / Brand', 'Location', 'Business Category (presumed)', 'Business Category', 'Report Type',
                                                    'Inspection/Audit By', 'Inspection / Audit By', 'Report Prepared By', 'Auditor'):
                for i in range(0, len(flat) - 1, 2): rep['header'][flat[i]] = flat[i + 1]
                continue
            if len(flat) == 1 and re.match(r'^[A-C]\.\s', flat[0]):
                section = flat[0]; continue
            # score table
            if len(flat) == 4 and re.match(r'^\d+(\.\d+)?%$', flat[3]):
                rep['sections'].append({'name': flat[0], 'available': float(flat[1]), 'obtained': float(flat[2]), 'pct': float(flat[3][:-1])})
                continue
            # v1 evidence table
            if len(flat) == 3 and re.match(r'^[SK]\d+\s*★?$', flat[0]):
                rep['evidence'][re.sub(r'[\s★]', '', flat[0])] = {'priority': flat[1], 'text': flat[2]}
                continue
            # v2 line rows: 'N ¶ ref M'
            m = re.match(r'^(\d+) ¶ ref (\d+)$', texts[0])
            if m and len(cells) >= 6:
                area = cells[1][0]
                req = cells[2][0]
                verify = next((p.split('How to verify:', 1)[1].strip() for p in req if p.startswith('How to verify:')), None)
                req_text = ' '.join(p for p in req if not p.startswith('How to verify:'))
                star_cell = flat[3]
                marks = re.search(r'(\d+)', star_cell)
                rating = flat[4].strip().lower()
                rep['lines'].append({
                    'code': f'L{int(m.group(2))}', 'ref': int(m.group(2)), 'line': int(m.group(1)), 'section': section,
                    'area': area[0] if area else '', 'applies': area[1] if len(area) > 1 else '',
                    'text': req_text, 'verify': verify, 'critical': '★' in star_cell,
                    'marks': float(marks.group(1)) if marks else None, 'rating_raw': flat[4],
                    'result': RATING_WORDS.get(rating), 'remark': ' '.join(cells[5][0]) or None, 'photos': cells[5][1],
                })
                continue
            # v1 checkpoint rows
            if re.match(r'^[SK]\d+\s*★?$', flat[0]) and len(flat) >= 4:
                ref = re.sub(r'[\s★]', '', flat[0])
                r1, r2 = flat[2], flat[3]
                num = re.match(r'^\d+$', r1)
                res = None
                if num:
                    n = int(r1)
                    res = 'fail' if n == 0 else 'partial' if n == 1 and r2.lower() == 'partial' else 'pass'
                else:
                    res = RATING_WORDS.get(r1.lower())
                photos = [p for _, imgs in cells for p in imgs]
                rep['lines'].append({
                    'code': ref, 'ref': ref, 'section': 'A. Service Area' if ref.startswith('S') else 'B. Kitchen Area',
                    'text': flat[1], 'critical': '★' in flat[0], 'marks': float(r1) if num else None,
                    'rating_raw': f'{r1} / {r2}', 'priority_raw': r2, 'result': res,
                    'remark': (flat[4] if len(flat) > 4 and flat[4] not in ('', '—') else None), 'photos': photos,
                })
    rep['format'] = fmt
    h = rep['header']
    rep['date'] = iso_from_text(h.get('Audit Date')) or iso_from_text(h.get('Report Type'))
    rep['auditor'] = h.get('Auditor') or h.get('Inspection/Audit By') or h.get('Inspection / Audit By')
    rep['prepared_by'] = h.get('Report Prepared By')
    rep['audit_type'] = h.get('Audit Type') or ('Internal walk-through' if fmt == 'v1' else None)
    rep['time'] = h.get('Time Start – End')
    props = ET.fromstring(z.read('docProps/core.xml')) if 'docProps/core.xml' in z.namelist() else None
    if props is not None:
        for n in props:
            if n.tag.endswith('created'): rep['doc_created'] = n.text
            if n.tag.endswith('modified'): rep['doc_modified'] = n.text
    return rep

def parse_docket(fname):
    d = fitz.open(os.path.join(DL, fname))
    rep = {'file': fname, 'items': [], 'categories': []}
    first = d[0].get_text()
    m = re.search(r'(\d+(?:\.\d+)?)%\s*\n\s*([\d.]+) of (\d+) points\s*\n\s*([A-Z ]+)\n', first)
    rep['score'], rep['earned'], rep['possible'], rep['band'] = float(m.group(1)), float(m.group(2)), float(m.group(3)), m.group(4).strip().title()
    rep['date'] = iso_from_text(re.search(r'walk-through\s*·\s*(.+)', first).group(1))
    rep['inspector'] = re.search(r'INSPECTED & PREPARED BY\s*\n(.+)', first).group(1).strip()
    rep['category'] = re.search(r'CATEGORY\s*\n(.+)', first).group(1).strip()
    summary = d[1].get_text()
    rep['summary'] = re.sub(r'\s+', ' ', summary.split('Inspector’s summary', 1)[1].split('Critical — act within', 1)[0]).strip() if 'Inspector’s summary' in summary else None
    started, stopped = False, False
    cat = None
    for pno, pg in enumerate(d):
        spans = []
        for b in pg.get_text('dict')['blocks']:
            for l in b.get('lines', []):
                for s in l['spans']:
                    t = s['text'].strip()
                    if t: spans.append({'y': (s['bbox'][1] + s['bbox'][3]) / 2, 'x': s['bbox'][0], 't': t, 'bold': 'Bold' in s['font'], 'size': s['size']})
        spans.sort(key=lambda s: (round(s['y']), s['x']))
        rows = []
        for s in spans:
            if s['t'].startswith('Full checklist'): started = True; continue
            if s['t'].startswith('Status corrections'): stopped = True
            if not started or stopped: continue
            if s['y'] < 30 or s['y'] > 800 or s['t'].startswith('Bookends Hospitality') or s['t'].startswith('Page '): continue
            if s['size'] > 9 and '·' in s['t'] and s['x'] < 60:
                cat = s['t'].split('·', 1)[1].strip(); rep['categories'].append(cat); rows.append({'cat': cat, 'y': s['y']}); continue
            if s['t'] in ('NO.', 'CHECK POINT', 'CRITICALITY', 'STATUS', 'REMARK / EVIDENCE') or re.match(r'^\d+ items?\s*·$', s['t']) or re.match(r'^\d+%$', s['t']) and s['x'] > 450: continue
            if s['t'].startswith('OK ') or s['t'] in ('OK', 'OBS', 'NC') and s['x'] < 200: 
                if s['x'] < 200: continue
            rows.append(s)
        # group by item number (x≈50 bold digits)
        nums = [r for r in rows if 'x' in r and r['x'] < 70 and re.match(r'^\d+$', r['t']) and r['bold']]
        cur_cat = None
        for i, n in enumerate(nums):
            lo = (nums[i - 1]['y'] + n['y']) / 2 if i else n['y'] - 14
            hi = (nums[i + 1]['y'] + n['y']) / 2 if i + 1 < len(nums) else n['y'] + 14
            # category = last category header above this number
            cats = [r for r in rows if 'cat' in r and r['y'] < n['y']]
            cur_cat = cats[-1]['cat'] if cats else (rep['items'][-1]['category'] if rep['items'] else None)
            cats_between = [r['y'] for r in rows if 'cat' in r and n['y'] < r['y']]
            if cats_between: hi = min(hi, min(cats_between) - 1)
            prev_cats = [r['y'] for r in rows if 'cat' in r and r['y'] < n['y']]
            if prev_cats: lo = max(lo, max(prev_cats) + 1)
            band = [r for r in rows if 'x' in r and lo <= r['y'] < hi and r is not n]
            text = ' '.join(r['t'] for r in band if 70 <= r['x'] < 262)
            crit = ' '.join(r['t'] for r in band if 262 <= r['x'] < 325)
            status = ' '.join(r['t'] for r in band if 325 <= r['x'] < 365)
            remark = ' '.join(r['t'] for r in band if r['x'] >= 365)
            rep['items'].append({'no': int(n['t']), 'category': cur_cat, 'text': text, 'criticality': crit, 'status': status, 'remark': remark or None})
    return rep

reports = []
for fname, (site, visit) in FILES.items():
    r = parse_docx(fname); r['site'] = site; r['visit'] = visit; reports.append(r)
dockets = []
for fname, site in DOCKETS.items():
    r = parse_docket(fname); r['site'] = site; dockets.append(r)
json.dump({'reports': reports, 'dockets': dockets}, open(OUT, 'w'), indent=1, ensure_ascii=False)
print('reports', len(reports), 'dockets', len(dockets), 'photos', len(os.listdir(MEDIA)))
