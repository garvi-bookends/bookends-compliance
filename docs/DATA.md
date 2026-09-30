# The data: where every number came from

## Sources

The 25 files in [`source-reports/`](../source-reports/), received 26 Sep 2026. All audits were done by Vishal Patel.

| Kind | Files | Format |
| --- | --- | --- |
| Food safety, first round (13–20 Aug 2026) | 10 Word reports | "FSSAI Schedule 4 & FDCA Compliance Readiness Report": 39 checkpoints, 94 marks at restaurants and 72–76 at kitchens |
| Food safety, second round (1–7 Sep 2026) | 9 Word reports | "FSSAI Internal Food Safety Audit — Checklist Report": the 60-line checklist minus N/A lines, ~116–148 marks. Beshak Dumas's only visit so far is in this format |
| Maintenance (17–23 Sep 2026) | 6 PDF inspection dockets | 65 check points, OK 1 / Observation 0.5 / NC 0 |

## Every report, and what was imported

"Printed" is the total in the report. "Imported" is what the app computes from the report's own line ratings. They match everywhere except one, explained below.

| Unit | Audit | Date | Source file | Printed | Imported | Note |
| --- | --- | --- | --- | --- | --- | --- |
| AIKO Ambli | Food safety · visit 1 | 2026-08-15 | `AIKO_AMBLI_1st Audit REPORT.docx` | 57/94 (60.6%) | 57/94 (60.6%) |  |
| AIKO Ambli | Food safety · visit 2 | 2026-09-03 | `AIKO_Ambli_FSSAI_2nd Audit_Report.docx` | 102/144 (70.8%) | 102/144 (70.8%) |  |
| AIKO Ambli | Maintenance · visit 1 | 2026-09-17 | `AIKO_Ambli_Inspection_Docket_Bookends (1).pdf` | 46/65 (70.8%) | 46/65 (70.8%) |  |
| AIKO Pal | Food safety · visit 1 | 2026-08-15 | `AIKO_REPORT 1st Audit.docx` | 59/94 (62.8%) | 59/94 (62.8%) |  |
| AIKO Pal | Food safety · visit 2 | 2026-09-01 | `AIKO_Pal_FSSAI_2nd Audit_Report.docx` | 88/142 (62.0%) | 88/142 (62.0%) |  |
| AIKO Pal | Maintenance · visit 1 | 2026-09-21 | `AIKO_Pal_Inspection_Docket_Bookends.pdf` | 47/65 (72.3%) | 47/65 (72.3%) |  |
| Beshak Dumas | Food safety · visit 1 | 2026-09-07 | `Beshak_Surat_FSSAI_1st Audit_Report.docx` | 91/140 (65.0%) | 91/140 (65.0%) | Line 37 disputed |
| Capiche Ambli | Food safety · visit 1 | 2026-08-15 | `Capiche Ambli_REPORT_1st Audit.docx` | 52/94 (55.3%) | 52/94 (55.3%) |  |
| Capiche Ambli | Food safety · visit 2 | 2026-09-03 | `Capiche_Ambli_FSSAI_2nd Audit_Report.docx` | 108/148 (73.0%) | 108/148 (73.0%) |  |
| Capiche Ambli | Maintenance · visit 1 | 2026-09-18 | `CAPICHE_Ambli_Inspection_Docket_Bookends.pdf` | 50.5/65 (77.7%) | 50.5/65 (77.7%) |  |
| Capiche Piplod | Food safety · visit 1 | 2026-08-15 | `PIPLOD_REPORT_1st Audit.docx` | 61/94 (64.9%) | 61/94 (64.9%) |  |
| Capiche Piplod | Food safety · visit 2 | 2026-09-02 | `Capiche_Piplod_FSSAI_2nd Audit_Report.docx` | 104/144 (72.2%) | 104/144 (72.2%) |  |
| Capiche Piplod | Maintenance · visit 1 | 2026-09-23 | `CAPICHE_Piplod_Inspection_Docket_Bookends.pdf` | 54/65 (83.1%) | 54/65 (83.1%) |  |
| Capiche University | Food safety · visit 1 | 2026-08-15 | `Capiche_UNI_REPORT 1st Audit.docx` | 60/94 (63.8%) | 60/94 (63.8%) |  |
| Capiche University | Food safety · visit 2 | 2026-09-04 | `Capiche_University_FSSAI_2nd Audit_Report.docx` | 107/148 (72.3%) | 107/148 (72.3%) |  |
| Capiche University | Maintenance · visit 1 | 2026-09-19 | `CAPICHE_University_Inspection_Docket_Bookends.pdf` | 47/65 (72.3%) | 47/65 (72.3%) |  |
| Capiche Vesu | Food safety · visit 1 | 2026-08-13 | `Capiche_Vesu_1st Audit_Report  FINAL.docx` | 39/94 (41.5%) | 39/94 (41.5%) |  |
| Capiche Vesu | Food safety · visit 2 | 2026-09-02 | `Capiche_Vesu_FSSAI_2nd Audit_Report.docx` | 85/140 (60.7%) | 85/140 (60.7%) |  |
| Capiche Vesu | Maintenance · visit 1 | 2026-09-22 | `CAPICHE_Vesu_Inspection_Docket_Bookends.pdf` | 50.5/65 (77.7%) | 50.5/65 (77.7%) |  |
| Central Bakery Kitchen, Ahmedabad | Food safety · visit 1 | 2026-08-20 | `Ahmedabad Bekary 1st Audit Report.docx` | 45/72 (62.5%) | 39/72 (54.2%) | Printed total is wrong |
| Central Bakery Kitchen, Ahmedabad | Food safety · visit 2 | 2026-09-04 | `Ahmedabad_Bakery_Kitchen_2nd Audit_Report.docx` | 72/116 (62.1%) | 72/116 (62.1%) |  |
| Central Bakery Kitchen, Surat | Food safety · visit 1 | 2026-08-20 | `Surat Bakery 1st audit report.docx` | 40/72 (55.6%) | 40/72 (55.6%) |  |
| Central Hot Kitchen, Ahmedabad | Food safety · visit 1 | 2026-08-20 | `Ahmedabad Prep Kitchen 1st Audit Report.docx` | 45/76 (59.2%) | 45/76 (59.2%) | Date assumed |
| Central Hot Kitchen, Ahmedabad | Food safety · visit 2 | 2026-09-04 | `Ahmedabad_Hot_Kitchen2nd Audit_Report.docx` | 80/124 (64.5%) | 80/124 (64.5%) |  |
| Central Hot Kitchen, Surat | Food safety · visit 1 | 2026-08-20 | `Surat prep kitchen 1st audit report.docx` | 36/76 (47.4%) | 36/76 (47.4%) | Date assumed |

## Where a report disagreed with itself

Rule: a report has three sources, its **line table**, its **printed total** and its **conclusion**. Where they disagree, the version two of them agree on is used, and the audit shows a data note in the app for the Compliance Head to confirm.

| Unit · visit | What the report says | What was imported | Why |
| --- | --- | --- | --- |
| Central Bakery Kitchen, Ahmedabad · 1 | Prints 45/72 (62.5%) | **39/72 (54.2%)** | The lines add up to 39, and the conclusion says "closing those five alone reaches 59/72": 59 − 20 = 39. The 45 looks copied from the Hot Kitchen report |
| Beshak Dumas · 1 | Line 37 (FSSAI number on menu) is "Compliant" in the table | **Major** | The printed total (91/140) and the conclusion ("15 Major lines… paperwork: lines 1, 21, 23, 37…") both count it as Major |
| Central Hot Kitchen, Ahmedabad · 1 | No date anywhere in the report | **20 Aug 2026** | The date of the bakery report from the same site visit |
| Central Hot Kitchen, Surat · 1 | No date anywhere in the report | **20 Aug 2026** | Same reason |

## How the reports were read

1. **Word reports** (`scripts/parse-reports.py`): the XML inside each .docx is walked in order. Header tables give the unit, date, auditor and audit type. Checklist rows give the code, text, ★, rating, marks and remark. Photos are taken from the same table cell as the remark, so each photo stays attached to its line. Score tables and the conclusion are kept too.
2. **PDF dockets** (same script, with PyMuPDF): text spans are read with their positions and assigned to columns by x-position (number, check point, criticality, status, remark), so wrapped lines and remarks stay together. The score, band, date and inspector come from page 1.
3. **Normalising** (`scripts/prepare-import.py`):
   - First-round ratings are written "number / word". 0 = fail, 1 = partial, full marks = pass.
   - The kitchen reports write passing ★ lines as "2 / Compliant" but count them as 4 in their own totals, so "Compliant" always means a pass.
   - The two AIKO first-round reports list line K20 twice; the repeat is dropped.
   - The first-round "evidence" notes (e.g. "licence copy on file expired ~5 months before the audit") are appended to the remark of the line they refer to.
4. **Checklists.** Each checklist is rebuilt as the union of every line seen in any report. Lines 31, 37 and 50 of the 60-line checklist were N/A in every report, so their wording is unknown and they aren't in the app yet.
   A line is **paperwork** or **on-site** by its area, using the reports' own split (for example "10 are paperwork and 7 are physical").
5. **SQL** (`scripts/build-sql.mjs`): writes the migrations, re-scores every audit with `public/rules.js`, and prints the result next to the printed total.
6. **Fixes.** Only each unit's **latest** visit per audit type becomes open fixes (310 of them). Older visits stay as history. Deadlines count from **26 Sep 2026**, the import date.

## Checks

- Every one of the 25 audits re-scores to its printed total, except the Ahmedabad bakery case above (`npm test`).
- The route-to-80% maths reproduces what the reports themselves say. Capiche Vesu is "27 short" of 80%, and closing its Priority 1 lines "takes the score to 117/140 (83.6%)". AIKO Ambli is "14 short" and reaches "130/144 (90.3%)" (`npm test`).
- The pipeline is reproducible. Running `npm run import:parse && npm run import:prepare && npm run import:sql` from the files in `source-reports/` regenerates `data/*.json` and migrations 0002–0003 **byte for byte** (checked 30 Sep 2026).
- All 275 photos are referenced by at least one line (305 references in all); none are missing.

## Importing the next batch of reports

Most new audits should be done **in the app** (Audits → New audit). They are scored and turned into fixes on submit, and nothing here is needed.
For reports that still arrive as Word or PDF files:

1. Put the files in `source-reports/` and add them to `FILES` (Word: unit key and visit number) or `DOCKETS` (PDF: unit key) at the top of `scripts/parse-reports.py`. For a new unit, also add it to `SITES` in `scripts/prepare-import.py`.
2. `pip install -r scripts/requirements.txt` (once), then `npm run import:parse && npm run import:prepare`. Review the diff in `data/`.
3. **Don't regenerate migrations that have already run.** Migrations 0001–0003 are in production and must never change.
   Write the new audits as a **new** migration, e.g. `0004_import_2026_10.sql`. The simplest way is to copy `scripts/build-sql.mjs`, have the copy emit only the new audits, and give them ids above the current maximum (`SELECT MAX(id) FROM audits`).
   Before a new visit's fixes are inserted, close the unit's previous open fixes for that audit type. The app does the same when an audit is submitted in it.
4. `npm test`, then `npm run db:migrate:remote` and `npm run photos:remote`.
5. If the report format changes, extend the parser. Check the new totals against the printed ones before loading anything.
