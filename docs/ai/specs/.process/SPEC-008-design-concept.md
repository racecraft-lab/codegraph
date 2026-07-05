---
topic: "SPEC-008 LSP Client Integration"
slug: "spec-008-lsp-client-integration"
date: "2026-07-05"
mode: "setup"
spec_id: "SPEC-008"
source_input:
  type: "file"
  ref: "docs/ai/specs/intelligence-platform-technical-roadmap.md#SPEC-008"
question_count: 9
stop_reason: "natural"
---

# Design Concept: SPEC-008 LSP Client Integration

> **Source:** `docs/ai/specs/intelligence-platform-technical-roadmap.md#SPEC-008`
> **Date:** 2026-07-05
> **Questions asked:** 9
> **Stop reason:** natural

## Goals

- Add opt-in LSP precision for graph definitions/references while preserving default CodeGraph behavior when LSP is not enabled.
- Cover all roadmap-listed language servers in SPEC-008: TypeScript/JavaScript, Python, Go, Rust, C/C++, Swift, and Java.
- Require real language-server validation for completion, with a prereq check that fails clearly when required binaries are missing.
- Represent LSP precision additively by marking only LSP-upgraded/verified edges with `provenance: "lsp"`.
- Correct conflicting graph targets when LSP returns a unique target, while recording correction metadata for auditability.
- Plan SPEC-008 as one spec with three vertical PR slices to stay reviewable.
- Dogfood the capability against this repository via explicit opt-in (`codegraph index --lsp` or config).

## Non-goals

- Auto-installing language servers is out of scope; missing binaries fail the validation prereq instead (Q4).
- Exposing CodeGraph as an LSP server is out of scope; that remains SPEC-009 (roadmap).
- Graph-aware rename is out of scope; that remains SPEC-010 (roadmap).
- Auto-enabling LSP whenever a server is on `PATH` is out of scope; default behavior remains unchanged (Q9).
- Normal runtime must not fail the whole index because one language server is missing or crashes (Q5).

## Design Tree (Q&A log)

### Q1. For SPEC-008, how should LSP verification represent edge provenance in the existing graph schema?

**Branch:** Schema and provenance

**Recommended answer:** Additive `lsp`
> The roadmap asks for per-edge provenance and the current schema already has `edges.provenance`; the lowest-risk path is to use a new `lsp` value only for LSP-upgraded edges while preserving existing `null` and `heuristic` behavior. This follows Constitution Principle III: surgical changes.

**Alternatives offered:**
- Normalize all edges: migrate existing static edges to explicit provenance values, cleaner but broader.
- Metadata only: avoid provenance-type changes, but make LSP verification harder to query.

**User's answer:** Additive `lsp`

---

### Q2. What should the first SPEC-008 implementation prove for language-server coverage?

**Branch:** Coverage breadth

**Recommended answer:** Core + registry
> The roadmap lists seven server families and the reviewability estimate already suggested splitting; proving the generic client on TS/JS and Python first would reduce implementation risk. This was recommended as the smallest reviewable path, but the user selected broader coverage.

**Alternatives offered:**
- All languages now: require end-to-end verification evidence for every listed language server in this spec.
- One language only: implement TypeScript first and defer registry breadth.

**User's answer:** All languages now

---

### Q3. How should SPEC-008 validate all language-server integrations without making CI depend on every real server being installed?

**Branch:** Validation evidence

**Recommended answer:** Fake required, real optional
> Scripted/fake LSP fixtures would make CI deterministic while still allowing real-server smoke evidence. The user selected stricter real-server validation.

**Alternatives offered:**
- Real servers required: require CI or local validation to install and exercise every listed language server.
- Detection only for missing: test registry detection for unavailable servers and protocol tests for installed servers.

**User's answer:** Real servers required

---

### Q4. Given real servers are required but auto-install is out of scope, how should SPEC-008 handle missing language-server binaries?

**Branch:** Validation prerequisites

**Recommended answer:** Fail prereq check
> This preserves the real-server validation bar without crossing the roadmap's auto-install non-goal. A clear prereq failure is also more useful than a late, ambiguous integration failure.

**Alternatives offered:**
- Warn and continue: allow completion with missing-server warnings, weakening the validation bar.
- Add installer scripts: create helper installers, crossing the roadmap non-goal.

**User's answer:** Fail prereq check

---

### Q5. At normal runtime, what should `codegraph index --lsp` do when a configured language server is missing or crashes?

**Branch:** Runtime degradation

**Recommended answer:** Degrade per language
> The roadmap explicitly calls for graceful per-language degradation, and Constitution Principle VII requires default/local behavior to stay private and stable. Structural indexing should succeed while status reports which LSP coverage was unavailable.

**Alternatives offered:**
- Fail whole index: make LSP strict but fragile.
- Disable all LSP: skip the entire LSP pass when one server fails.

**User's answer:** Degrade per language

---

### Q6. Where should users override language-server commands and timeouts for SPEC-008?

**Branch:** Configuration surface

**Recommended answer:** `codegraph.json` + env
> The roadmap requires PATH probing plus user config override. Project config is repeatable for repos and CI, while environment overrides handle machine-local paths without committing them.

**Alternatives offered:**
- Env vars only: local and embedding-like, but awkward for many command arrays.
- CLI flags only: simple for one-off runs, weaker for repeatable project use.

**User's answer:** `codegraph.json` + env

---

### Q7. When LSP returns a different definition/reference target than the existing graph edge, what should SPEC-008 do?

**Branch:** Edge correction policy

**Recommended answer:** Replace when unique
> If LSP is uniquely authoritative for a reference, keeping the wrong edge alongside the right edge would degrade callers and impact results. Replacement should be bounded to unique LSP results and record metadata so corrections remain auditable.

**Alternatives offered:**
- Add alongside: keeps auditability but risks noisier graph answers.
- Annotate only: avoids target changes but may not improve incorrect results.

**User's answer:** Replace when unique

---

### Q8. How should SPEC-008 handle reviewability given the all-languages-now scope and the estimator's 3-slice warning?

**Branch:** Slice sizing

**Recommended answer:** Three slices
> The advisory estimator returned `estimated_loc: 815`, `suggested_slices: 3`, `status: warn`. Three vertical PR slices keep the one-spec goal while reducing review risk.

**Alternatives offered:**
- One large PR: accepts reviewability and merge-risk pressure.
- Split child specs: cleaner language grouping but delays the all-languages-now goal.

**User's answer:** Three slices

---

### Q9. How should SPEC-008 activate LSP precision for users and for this repo's dogfooding gate?

**Branch:** Activation and dogfooding

**Recommended answer:** Opt-in + self-repo gate
> The roadmap says `codegraph index --lsp` or config should opt into LSP, and the constitution's dogfooding protocol requires self-repo UAT for each spec. Default behavior should remain unchanged until the user explicitly enables LSP.

**Alternatives offered:**
- Auto-enable when found: higher precision but violates dormant/default-off discipline.
- CLI-only first: simpler but weaker for repeatable CI.

**User's answer:** Opt-in + self-repo gate

## Open Questions

- **What:** Exact install commands and version pins for each required real language server.
  **Why deferred:** The user chose the validation policy, but exact package manager commands should be confirmed during Plan against current official server docs and local CI constraints.
  **Suggested next step:** Resolve in `/speckit-plan` research before tasks are generated.
- **What:** The exact three PR slice boundaries.
  **Why deferred:** The user accepted a three-slice route, but Plan should set the final split after spec/user stories and file operations are concrete.
  **Suggested next step:** Use the tentative split in the workflow Plan prompt, then let Tasks and the atomicity route finalize it.

## Recommended Next Step

Run setup. In setup mode this document feeds `docs/ai/specs/.process/SPEC-008-workflow.md`, which is generated by `$speckit-scaffold-spec SPEC-008`.
