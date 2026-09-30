# Decisions

Why things are the way they are. Each entry: the decision, the reason, and what would change it.

**1. Score with the reports' own marking and bands, not an invented scheme.**
The first prototype used a made-up 3/2/1 scheme with 90/75 bands. Once the real reports arrived, everything moved to Vishal Patel's system (Compliant 2 / Minor 1 / Major 0, ★ double; Exemplar 90, Satisfactory 80, Needs Improvement 50), so the app and the reports always agree. *Changes if:* the Compliance Head changes the rules (edit `public/rules.js`).

**2. Target = 80% (Satisfactory); stretch = 90% (Exemplar).**
The reports themselves measure each unit against 80% ("80% needs 112 marks; the unit has 85, so it is 27 short"). The dashboard is built around that gap.

**3. Compare visit 1 and visit 2 as percentages, with a caveat.**
The two rounds used different checklists (39 checkpoints vs the 60-line list). Percentages are the only common measure. The chart states that the change is a direction, not a precise measure. Section scores are compared only where sections exist in both.

**4. When a report contradicts itself, use what two of its three sources agree on, and flag it.**
Line table, printed total and conclusion: the majority wins, and the audit carries a visible data note (4 cases, see [DATA.md](DATA.md)). Nothing was silently "corrected".

**5. Only the latest visit's gaps are open fixes.**
First-round gaps were re-audited in the second round. Keeping both open would double-count them. History stays viewable.

**6. Deadlines for imported gaps start from the import date (26 Sep 2026).**
The reports carried no deadlines. Back-dating to the audit date would have made everything overdue on day one. The consequence: Priority 1 (2 days) fell due on 28 Sep.

**7. Three priorities, by criticality and rating.**
A ★ line rated Major, or a Critical docket point that is NC, is Priority 1 (the dockets already say "Critical: act within 48 hours"). The rest follow in [FRAMEWORK.md](FRAMEWORK.md#5-from-gaps-to-fixes). Within a priority, paperwork comes first, because the reports themselves say paperwork "can be closed in a week or two".

**8. Shortfall in whole marks (food) and half points (maintenance).**
That is how the reports count it ("14 short", not "13.2 short").

**9. Sign-in: one team access code plus a name, not Cloudflare Access (yet).**
The app had to go live the same day, and Access needs a Zero Trust setup and a list of people's e-mails. The code is a Worker secret. Sessions are HMAC-signed cookies, sign-in is rate-limited, and the Access upgrade path is built in (`TRUST_ACCESS`). *Changes when:* more than a handful of people use it, or per-person accountability matters (see [OPERATIONS.md](OPERATIONS.md#per-person-logins-cloudflare-access)).

**10. Files in Workers KV, not R2.**
R2 needs a payment method on the account, even for the free tier. KV holds files up to 25 MiB (the app caps them at 8 MB) and allows 1,000 writes a day on the free plan, which is far above audit volume. *Changes if:* photo volume grows a lot or R2 is enabled. Only `upload`/`getFile` in `src/worker.js` would change.

**11. No framework, no build step.**
Plain JS modules served as static files, and a single Worker file. Anyone can read or change it without a toolchain, and there is nothing to keep up to date except Wrangler. The cost: pages are HTML strings. They are escaped by default through the `html` template.

**12. One rules file shared by the server and the browser.**
The published rules (Framework page) and the enforced rules can never drift, and the live score while auditing matches what the server stores.

**13. Bookends palette and Material 3.**
The colours come from the Bookends inspection dockets: royal blue `#00249C`, gold `#EEB22B`, red, and ink `#12162B`. Grades use the dockets' own mapping: blue 80%+, gold 50–79%, red below 50%. Every colour appears with a label, never alone. The components are Material 3, written by hand in CSS.

**14. D1 in the APAC region, business dates in IST.**
The units are in Gujarat. "Today" and every deadline use UTC+5:30 (`TZ_OFFSET_MINUTES`).

**15. Draft audits are saved on the phone.**
The audit in progress is kept in `localStorage`, so closing the tab or losing the signal mid-audit loses nothing. Submitting still needs a connection. Full offline sync was out of scope.

**16. Figma diagrams were dropped** at the owner's request. The lifecycle and rules are drawn in the app (Framework page) and in these docs.
