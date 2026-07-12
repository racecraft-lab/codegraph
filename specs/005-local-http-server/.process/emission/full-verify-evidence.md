# SPEC-005 final verification evidence (pre-emission)

- BUILD: `npm run build` — exit 0; `dist/server/openapi.yaml` shipped (G7, re-run after review remediation for dist byte-identity)
- TYPECHECK: `npx tsc --noEmit` — exit 0 (latest: post-remediation, 2026-07-11 19:58 local)
- LINT: no lint script defined in package.json (typecheck is the static gate)
- UNIT+INTEGRATION: full env-stripped `npm test` — **176 files, 3167 passed / 7 skipped, exit 0** (2026-07-11 19:59 local, after review remediation; G7 baseline run was 3152 passed / 7 skipped, exit 0)
- Server suites after remediation: 255 passed across 5 suites
- Self-repo dogfood UAT: 7/7 PASS (T047)
- Retrieval-guardian (T042): OVERALL PASS 7/7 checks, zero blocking
