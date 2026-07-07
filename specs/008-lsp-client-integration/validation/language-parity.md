# Language Parity

## Scope

This table closes SPEC-008 language ownership against the internal baseline.
Rows are either implemented in SPEC-008 validation or future-owned by a concrete
numbered spec. There are no unowned or backlog-only rows.

| Language | Owner | Evidence | Future owner | Status |
|---|---|---|---|---|
| JavaScript | SPEC-008 Slice 1 | TypeScript SDK-backed server validation, disabled-path regression, status coverage, and precision-pass verification evidence in `validation/slice-1.md` | SPEC-024 audit | Owned |
| JSX | SPEC-008 Slice 1 | TypeScript SDK-backed server validation and registry coverage through `typescript-language-server --stdio`; verifies CodeGraph `.jsx` language ID is LSP-owned | SPEC-024 audit | Owned |
| TypeScript | SPEC-008 Slice 1 | TypeScript SDK-backed server validation, disabled-path regression, status coverage, and precision-pass verification evidence in `validation/slice-1.md` | SPEC-024 audit | Owned |
| TSX | SPEC-008 Slice 1 | TypeScript SDK-backed server validation and registry coverage through `typescript-language-server --stdio`; verifies CodeGraph `.tsx` language ID is LSP-owned | SPEC-024 audit | Owned |
| Python | SPEC-008 Slice 3 validation | Real-server prereq row and per-language degradation evidence in `validation/slice-2.md` | SPEC-024 audit | Owned |
| Java | SPEC-008 Slice 3 validation | Real-server prereq row and workspace/status evidence in `validation/slice-2.md` | SPEC-024 audit | Owned |
| C | SPEC-008 Slice 3 validation | Real-server prereq row and compile-command-aware validation evidence in `validation/slice-2.md` | SPEC-024 audit | Owned |
| C++ | SPEC-008 Slice 3 validation | Real-server prereq row and compile-command-aware validation evidence in `validation/slice-2.md` | SPEC-024 audit | Owned |
| C# | SPEC-008 Slice 3 validation | Real-server prereq row and degradation/status evidence in `validation/slice-3.md` | SPEC-024 audit | Owned |
| Go | SPEC-008 Slice 3 validation | Real-server prereq row and module workspace evidence in `validation/slice-2.md` | SPEC-024 audit | Owned |
| Ruby | SPEC-008 Slice 3 validation | Real-server prereq row and definition/reference validation evidence in `validation/slice-3.md` | SPEC-024 audit | Owned |
| Rust | SPEC-008 Slice 3 validation | Real-server prereq row and cargo workspace validation evidence in `validation/slice-2.md` | SPEC-024 audit | Owned |
| PHP | SPEC-008 Slice 3 validation | Real-server prereq row and definition/reference validation evidence in `validation/slice-3.md` | SPEC-024 audit | Owned |
| Kotlin | SPEC-008 Slice 3 validation | Real-server prereq row and workspace validation evidence in `validation/slice-3.md` | SPEC-024 audit | Owned |
| Swift | SPEC-008 Slice 3 validation | Real-server prereq row and package/source workspace evidence in `validation/slice-2.md` | SPEC-024 audit | Owned |
| Dart | SPEC-008 Slice 3 validation | Dart SDK language-server prereq row and package validation evidence in `validation/slice-3.md` | SPEC-024 audit | Owned |
| Vue | SPEC-008 Slice 3 validation | Vue language-server prereq row plus TypeScript SDK evidence in `validation/slice-3.md` | SPEC-024 audit | Owned |
| COBOL | SPEC-008 disposition | Existing parser/resolver parity is preserved; no SPEC-008 local LSP target selected | SPEC-024 | Future-owned |

Gate expectation: `scripts/spec-008-parity-gate.mjs` reports 18 language rows
and 0 unowned rows.
