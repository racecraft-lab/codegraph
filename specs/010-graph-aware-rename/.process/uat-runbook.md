# UAT Runbook: Graph-Aware Rename (SPEC-010)

This runbook proves that `codegraph rename` (and the matching `codegraph_rename`
AI-assistant tool) does what it promises: it shows you a rename plan before it
touches anything, it refuses safely instead of guessing whenever something is
ambiguous or risky, and — when you do let it write — it either finishes
completely and correctly or leaves your files exactly as they were.

No prior CodeGraph experience is assumed. Every step is a command to run and a
result to look at. Where a guarantee is hard to trigger by hand on purpose
(a few of the deep safety-net checks), that is called out honestly and you're
pointed at the project's own automated test for that specific guarantee instead
of a fragile manual recipe.

> **Note on this document's origin.** The tool that normally generates a
> starting skeleton for this runbook was unavailable in this run, so this
> runbook was authored directly from the feature's specification
> (`specs/010-graph-aware-rename/spec.md`), its scenario list
> (`specs/010-graph-aware-rename/quickstart.md`), and the project's own
> workflow and PR-packet records — including three defects (D3, D4, D5) found
> and fixed during development, which changed some of the expected results
> below from what the original scenario list described. Every command shown
> was actually run against a real build of this branch while writing this
> runbook; the exact output is quoted. A few checks were run against real
> fixtures but the exact one-line recipe shown for them is a close, reasoned
> adaptation rather than a byte-for-byte capture — those are marked.

---

## Environment Setup

You need a working copy of the branch, and a small throwaway project to
practice renames on. Nothing in this runbook writes to the CodeGraph checkout
itself except the two places that say so explicitly (both dry-run only).

**1. Get the code and build it.**

```bash
git clone <your fork or the project remote> codegraph-review
cd codegraph-review
git checkout 010-graph-aware-rename
npm install
npm run build
```

(If you already have this worktree checked out — as this runbook's own
verification did — just run `npm install && npm run build` inside it.)

`npm run build` compiles the CLI into `dist/bin/codegraph.js`. There is no
separate "install" step beyond that; every command below invokes that file
directly with `node`.

**2. Point a variable at the built CLI, once per terminal session.**

```bash
CG_BIN="$(pwd)/dist/bin/codegraph.js"
```

Every command below is written as `node "$CG_BIN" <command>`, run from
whatever folder you want CodeGraph to act on. If you close and reopen your
terminal, re-run this line before continuing (or just `cd` back into the
checkout and re-run it).

**3. Create a small test project and index it.**

```bash
mkdir -p /tmp/codegraph-uat && cd /tmp/codegraph-uat
cat > math.ts <<'EOF'
export function oldFn(x: number): number {
  return x + 1;
}

export function loneFn(): number {
  return 42;
}
EOF
cat > caller.ts <<'EOF'
import { oldFn } from './math';

export function run(): number {
  return oldFn(5);
}
EOF

node "$CG_BIN" init .
node "$CG_BIN" status
```

**Expect**: `init` reports files scanned/parsed/indexed and ends with a node
and edge count (this exact fixture indexes as "2 files … 6 nodes, 7 edges").
`status` shows "Index is up to date" and lists `typescript 2` under
"Files by Language". If you see anything else, stop here — the rest of the
runbook assumes this baseline works.

There is no separate build/test command required for this feature beyond the
project's normal ones (`npm run build`, `npm test`) — `codegraph rename` ships
inside the same CLI binary as every other subcommand, so nothing extra needs
compiling or installing to exercise it.

**Exit codes you'll see throughout this runbook** (so you can recognize them
without re-deriving them each time):

| Exit code | Meaning |
|---|---|
| `0` | A plan was printed (dry-run), or an apply finished and passed its own safety check. |
| `1` | An internal or usage error — not part of this feature's normal behavior. |
| `2` | A recoverable refusal — nothing was written, and the message tells you what to do differently. |
| `3` | An apply wrote files, then safely undid every change and put everything back. |
| `4` | The one true malfunction case: undoing the change itself failed partway (see Step 13). |

---

## User Story 1 — Preview a rename before anything changes

This story is the foundation: `codegraph rename <target> <new-name>` always
shows you a plan first. Nothing is written unless you explicitly ask for it
later (User Story 3).

### Step 1 (S1-A) — Preview a simple rename

1. From `/tmp/codegraph-uat`, run:
   ```bash
   node "$CG_BIN" rename oldFn newFn
   ```
2. **Expect** a plain-text table like this (verified output from this exact
   fixture):
   ```
   rename oldFn (function) → newFn
   caller.ts
     1:9  exact  oldFn → newFn
       - import { oldFn } from './math';
       + import { newFn } from './math';
     4:9  exact  oldFn → newFn
       -   return oldFn(5);
       +   return newFn(5);
   math.ts
     1:16  exact  oldFn → newFn
       - export function oldFn(x: number): number {
       + export function newFn(x: number): number {

   confidence: all-exact · 0 leftover mention(s)
   ```
   Every edit shows which file, which line/column, a confidence tier, and a
   before/after preview — you can see exactly what would change without
   opening either file.
3. Open `math.ts` and `caller.ts` in a text editor (or `cat` them). **Expect**:
   both files are byte-for-byte unchanged — `oldFn` is still the name
   everywhere. The command's own exit code is `0` (check with `echo $?`
   immediately after running it, not through a pipe).
4. Re-run the same command with `-j`/`--json`:
   ```bash
   node "$CG_BIN" rename oldFn newFn --json
   ```
   **Expect** a single-line JSON object whose `applied` field is `false` and
   whose `edits` array lists the same three edits as the table, each carrying
   `file`, `range`, `oldText`, `newText`, `lineText`, `confidence`, and
   `source`. This is the same information as the table, in a form a script
   (or an AI assistant) can parse.

### Step 2 (S1-B) — Two ways a plan gets built: a language server, or the graph alone

CodeGraph builds a rename plan two ways: by asking a real language server (if
one is installed and configured for that language), or by walking its own
knowledge graph of who-calls-what (if no server is available, or the server
isn't ready). Both are safe; each edit's `source` field in the JSON output
tells you honestly which one produced it — `"lsp"` or `"graph"`.

1. Look at the `source` field on each edit in Step 1's `--json` output.
   **Expect**: `"graph"` on every edit — the throwaway project you just made
   has no `codegraph.json`, so CodeGraph never even tries a language server
   for it. This is correct, not a shortfall: without a configured server, the
   graph path is the whole story, and it still produced a complete, correct
   plan.
2. To see the language-server path exist at all, point a dry-run at this
   *CodeGraph checkout itself* (its own `codegraph.json` turns on a
   TypeScript language server; this step only reads, it never applies):
   ```bash
   cd <path to your codegraph-review checkout>
   node "$CG_BIN" rename getExploreBudget getExploreBudgetX --json
   ```
   **Expect**: a valid plan either way. When this runbook was verified, this
   exact command returned `"source":"graph"` on every edit and an extra
   top-level field, `"lspDegradation":"incomplete-coverage"` — meaning a
   language server *was* tried, didn't answer completely in time (it hadn't
   finished loading this 500+ file project yet), and CodeGraph safely fell
   back to the graph path rather than risk an incomplete plan. **That
   fallback, visible in the `lspDegradation` field, is the fix for defect D3
   working as intended** (see "Already Executed During Development" below) —
   seeing `"graph"` here is a pass, not a failure. If your own run instead
   shows `"source":"lsp"` on some edits, that is also a pass — it just means
   the language server answered in time.
3. `cd` back to `/tmp/codegraph-uat` before continuing.

### Step 3 (S1-C) — A symbol nobody calls still gets a valid plan

1. `math.ts` already declares `loneFn`, which nothing else in the project
   calls. Run:
   ```bash
   node "$CG_BIN" rename loneFn brandNewName --json
   ```
2. **Expect**: a normal plan, `applied:false`, exit code `0` — with exactly
   **one** edit (the declaration itself in `math.ts`). A symbol with no
   callers is not an error; the plan is still valid, it's just short.

---

## User Story 2 — Target precisely, and get refused instead of guessed at

### Step 4 (S1-D) — An ambiguous name refuses, and the refusal tells you how to fix it

1. Add two files that each declare a method with the same name:
   ```bash
   cat > server.ts <<'EOF'
   export class Server {
     handle(x: number): string {
       return `server:${x}`;
     }
   }
   EOF
   cat > worker.ts <<'EOF'
   export class Worker {
     handle(x: number): string {
       return `worker:${x}`;
     }
   }
   EOF
   node "$CG_BIN" sync .
   ```
2. Try to rename the bare name:
   ```bash
   node "$CG_BIN" rename handle process
   ```
3. **Expect** (verified output):
   ```
   refused: ambiguous-target
   "handle" matches 2 symbols. Retry with one of the listed selectors (or narrow with --file / --kind).
   candidates:
     Server.handle  method  server.ts:2
     Worker.handle  method  worker.ts:2
   ```
   Exit code `2`. Nothing was written — `handle` is still the name in both
   files. Notice the refusal already tells you the exact qualifier to use
   next; you never had to open either file to figure out which `handle` is
   which.
4. Retry using the qualifier the refusal gave you:
   ```bash
   node "$CG_BIN" rename Server.handle process --json
   ```
   **Expect**: a clean plan for exactly the `Server` class's method (one
   edit, `all-exact`), `applied:false`, exit `0`. The retry needed zero file
   reads — only the information already printed in step 3.

### Step 5 (S1-E) — Some kinds of symbol are refused everywhere, or on this path

CodeGraph draws two honest lines around what it will rename:

- **Local variables and parameters, on the graph-only path, are refused** —
  the graph doesn't track where a local variable is used inside a function
  body, only symbols with tracked cross-file references. (A working language
  server *can* rename these — that path isn't limited this way.)
- **`file`, `route`, `import`, and `export` kinds are refused on every path,
  always** — these aren't symbols you rename in place; they're structural.

1. **Local/parameter refusal — verified, concrete example.** This checkout
   ships a small OCaml sample under its own test fixtures that already has a
   plain function parameter. From inside your `codegraph-review` checkout
   (indexed once via `node "$CG_BIN" init .` if you haven't already — this is
   a dry-run-only check, nothing is written):
   ```bash
   node "$CG_BIN" rename f fRenamed --kind parameter \
     --file __tests__/fixtures/ocaml/broad-syntax/implementation.ml --json
   ```
   **Expect** (verified output):
   ```json
   {"newName":"fRenamed","applied":false,"refusal":{"reason":"unsupported-kind-graph-local","message":"Cannot rename the parameter \"f\" on the graph path — no local usage tracking for locals/parameters, which needs a language server. Enable an LSP server for this language and retry."}}
   ```
   Exit code `2`. The message itself names the fix (enable a language server
   for that symbol's language).
2. **Excluded-kind refusal (`file`/`route`/`import`/`export`) — expected
   wording, taken directly from the tool's source.** If a resolved target
   turns out to be one of these four kinds, on any path, you will see:
   ```
   Cannot rename a "<kind>" symbol — file, route, import, and export kinds are excluded from rename on every path.
   ```
   with `reason:"excluded-kind"` in the JSON form and exit code `2`. This
   runbook's own attempt to hand-build a minimal trigger for this specific
   message ran into an unrelated quirk of how the target selector splits
   qualified names (a name containing a literal `.`, like an import's module
   path, gets split the same way `Class.method` is) rather than reliably
   reaching this refusal — so rather than hand you a recipe that might not
   reproduce on your machine, treat the wording above as the acceptance bar
   and confirm it with the project's own passing test instead:
   ```bash
   npx vitest run __tests__/refactor-plan.test.ts -t "kind-coverage refusals"
   ```
   **Expect**: the test passes (this exercises FR-009/FR-010/FR-011 together,
   including this exact message).

### Step 6 — Bad arguments are refused by name, not guessed (extra check, not in the original scenario list)

The specification also requires the tool to refuse a handful of malformed
requests cleanly instead of producing a strange or empty plan. This wasn't
one of the lettered quickstart scenarios, but it's simple to check and it
closes out User Story 2's "recover from ... unsupported kinds" promise:

1. Rename a symbol to its own current name:
   ```bash
   node "$CG_BIN" rename oldFn oldFn --json
   ```
   **Expect** (verified output):
   ```json
   {"newName":"oldFn","applied":false,"refusal":{"reason":"invalid-argument","message":"New name \"oldFn\" is the same as the current name — nothing to rename."}}
   ```
2. Pass a `--kind` that isn't real:
   ```bash
   node "$CG_BIN" rename oldFn newFn --kind bogus --json
   ```
   **Expect** (verified output, abbreviated): a refusal with
   `"reason":"invalid-argument"`, a message naming `--kind "bogus"` as the
   problem, and a `validKinds` array listing every kind CodeGraph recognizes
   — so the correct spelling is right there in the response.

### Step 7 (S1-F) — Look-alikes are excluded from the plan, never edited

This check confirms the tool tells apart a *real* reference to your target
from things that merely look like one: a same-named variable that shadows
the real one, an import alias, and a name that's merely similar as text. The
specific fixture below is a reasoned construction from the specification's
own rules (FR-004/FR-005), not a byte-for-byte capture like the steps above
— build it and read the result against the description that follows.

1. Add:
   ```bash
   cat > shadow.ts <<'EOF'
   export function widget(): string {
     return "outer";
   }

   export function useShadow(): string {
     function widget(): string {
       return "inner";
     }
     return widget();
   }

   export function useRealOne(): string {
     return widget();
   }
   EOF
   cat > alias.ts <<'EOF'
   import { widget as w } from './shadow';

   export function useAlias(): string {
     return w();
   }
   EOF
   cat > lookalike.ts <<'EOF'
   export function widgetFactory(): string {
     return "factory";
   }

   export function noise(): string {
     return "the widget pattern shows up here as text only";
   }
   EOF
   node "$CG_BIN" sync .
   node "$CG_BIN" rename widget gadget --json
   ```
2. **Expect**: the plan's edits cover only the real declaration
   (`shadow.ts`'s outer `widget`) and the one genuine call to it
   (`useRealOne`). It should **not** include: the inner shadowed `widget`
   inside `useShadow` (a different, local symbol with the same name), the
   aliased import usage `w()` in `alias.ts` (the reference goes through the
   alias, not the original name), `widgetFactory` (a different, merely
   similar-looking name), or anything inside the string literal in `noise`
   (text is never a reference). Each surviving edit still shows a confidence
   tier, and `leftoverMentions` may be non-zero if the tool counts any of the
   above as an informational "these look related but weren't touched"
   footnote — that count is normal and does not block anything.

---

## User Story 3 — Apply a rename safely

Everything above only ever printed a plan. This story turns the write path
on with `--apply` and proves the safety ladder around it: a below-confidence
edit blocks the write unless you say otherwise, a stale index refuses instead
of corrupting your files, and any failure partway through restores your files
exactly as they were.

### Step 8 (S2-A) — Apply a clean, all-exact plan

1. From `/tmp/codegraph-uat` (with `math.ts`/`caller.ts` still saying
   `oldFn`), run:
   ```bash
   node "$CG_BIN" rename oldFn newFn --apply
   ```
2. **Expect** (verified output):
   ```
   applied → newFn
   2 file(s) rewritten · index re-synced · post-check green
     caller.ts
     math.ts
   ```
   Exit code `0`.
3. Open `math.ts` and `caller.ts`. **Expect**: `oldFn` is gone and `newFn` is
   in its place everywhere — the declaration, the import, and the call site.
   Nothing else in either file changed (no stray reformatting, no touched
   comments).
   ```bash
   grep -rn "oldFn" *.ts || echo "confirmed: no oldFn text remains"
   ```
4. This is the everything-or-nothing guarantee (User Story 3's core promise)
   working in the simple case: it wrote, it re-checked itself
   ("post-check green" means it looked for any leftover reference to `oldFn`
   after re-syncing the index, and found none), and it told you plainly what
   it did.

### Step 9 (S2-B) — A plan containing a lower-confidence edit is gated

Some ways of resolving a reference are less certain than others — CodeGraph
calls these `heuristic` instead of `exact`, and by default refuses to write
them. You can override that, one rename at a time.

1. Add a re-export, which resolves through a less certain path than a direct
   import:
   ```bash
   cat > reexport.ts <<'EOF'
   export { newFn as reExportedNewFn } from './math';
   EOF
   node "$CG_BIN" sync .
   node "$CG_BIN" rename newFn evenNewerFn --apply
   ```
2. **Expect** (this is the actual wording this runbook's own verification
   run produced, from an equivalent re-export):
   ```
   refused: heuristic-gated
   Refusing to apply: 1 edit is below `exact` confidence. Re-run with --include-heuristic to apply them, or narrow the rename.
   gated edits:
     reexport.ts:1  heuristic
   ```
   Exit code `2`. Confirm `math.ts`/`caller.ts`/`reexport.ts` are all
   unchanged — the refusal happened before any file was touched.
3. Retry with the override:
   ```bash
   node "$CG_BIN" rename newFn evenNewerFn --apply --include-heuristic
   ```
   **Expect**: it proceeds — the files are rewritten (including
   `reexport.ts`'s re-export line), exit `0`.

   If your own fixture's plan comes back `all-exact` instead of flagging
   anything (this can happen — heuristic edges depend on exactly how a
   reference resolves), that itself is a valid outcome: `--include-heuristic`
   on a plan with nothing to gate simply has nothing to do, and apply
   proceeds either way. You can confirm the gate mechanism itself directly:
   ```bash
   npx vitest run __tests__/refactor-apply.test.ts -t "heuristic"
   ```

### Step 10 (S2-C) — A file that changed since the last index refuses, instead of silently applying a broken rename

**This is the most important check in this runbook.** An earlier build of
this feature had a real bug here (tracked internally as defect D4, found
during this feature's own final gate testing and fixed in the same session
before anything shipped): if a file drifted out of sync with the index (for
example, you or your editor changed it, and CodeGraph's background watcher
hadn't caught up yet), the rename tool would silently drop the edit for that
one file — and then report success anyway, leaving your project in a broken,
half-renamed state with no warning. That is fixed. Today, any file that has
drifted refuses the **entire** plan, by name, before anything is written —
and it does this even on a plain dry-run, not just on `--apply`.

1. Starting from the state after Step 8 (files say `newFn`), directly
   overwrite `caller.ts` on disk — **not** through CodeGraph, simulating an
   editor save the background watcher hasn't processed yet:
   ```bash
   cat > caller.ts <<'EOF'
   // a harmless comment added directly on disk, bypassing codegraph sync
   import { newFn } from './math';

   export function run(): number {
     return newFn(5);
   }
   EOF
   ```
2. Immediately — without running `sync` — try a plain dry-run (no `--apply`):
   ```bash
   node "$CG_BIN" rename newFn newerFn
   ```
3. **Expect** (verified output):
   ```
   refused: stale-span
   Refusing the rename: the live bytes of caller.ts no longer match the index (the index is stale). Run `codegraph sync` and retry.
   files:
     caller.ts
   ```
   Exit code `2`. **You do not even get a plan** — this is the key
   behavior change from the original design: the check now runs while the
   plan itself is being built, not only right before a write. A drifted plan
   never renders as `all-exact` and never quietly proceeds.
4. Confirm zero writes: `caller.ts` still has your "harmless comment" line,
   untouched by the refused command.
5. Try `--apply` directly (skipping the dry-run) against the same drifted
   file:
   ```bash
   node "$CG_BIN" rename newFn newerFn --apply
   ```
   **Expect**: the identical `stale-span` refusal, exit `2`, zero writes.
6. Follow the refusal's own advice:
   ```bash
   node "$CG_BIN" sync .
   node "$CG_BIN" rename newFn newerFn --json
   ```
   **Expect**: a normal, complete plan resumes — covering `caller.ts` again
   — `all-exact`, exit `0`. The rename is safe to apply from here.

### Step 11 (S2-D) — If something is still wrong after writing, everything is put back

This is a second, independent safety net behind Step 10: even after a
successful write and re-sync, CodeGraph checks the touched files one more
time for any reference still carrying the old name. If it finds one, it
restores every touched file byte-for-byte from a snapshot taken before the
write, re-syncs again, and reports exactly what it found dangling.

Deliberately forcing this specific condition by hand from outside the tool
requires injecting a change into the exact instant between "files written"
and "check runs" — the project's own evidence describes this as impractical
to trigger through the command line and validates it at the automated-test
level instead. This runbook does the same rather than hand you a recipe that
won't reliably reproduce:

```bash
npx vitest run __tests__/refactor-apply.test.ts -t "post-check"
```

**Expect**: passing tests confirming that a forced dangling reference results
in every touched file being restored exactly, the index re-synced, and a
`danglingReferences` list naming what was found — exit code `3` on the CLI
(the "wrote, then safely undid it" code from the table in Environment Setup).

### Step 12 (S2-E) — Writes can't land outside your project, or in files you've excluded from indexing

Two related guarantees: a rename can never touch a file outside your
project folder (even through a symlink), and it can never touch a file
that's inside your project but that you've deliberately excluded from
indexing (via `.gitignore` or `codegraph.json`). Either condition refuses
the **whole** plan, names the file, and never partially writes.

Reliably constructing a fixture that forces a real language server to
propose an edit into one of these two categories requires controlling that
server's exact response, which (like Step 11) the project's own record notes
as validated at the engine level rather than by hand through the CLI. The
expected wording, if you ever see it, names the offending file directly and
carries exit code `2` with zero writes, at both dry-run and apply time. To
confirm the guarantee holds today:

```bash
npx vitest run __tests__/refactor-plan.test.ts -t "jail"
npx vitest run __tests__/refactor-apply.test.ts -t "jail"
```

**Expect**: passing tests (11+ dedicated cases, including symlinked and
case-insensitive paths).

### Step 13 (S2-F) — If undoing a change also fails, that's the one honest malfunction

If Step 11's restore-from-snapshot step itself cannot write (for example, a
file became read-only between the write and the restore), CodeGraph does not
pretend to have succeeded. This is the single case in this entire feature
where the response is a genuine error rather than friendly guidance: it
reports, file by file, what it did manage to restore and what it didn't, and
it saves a copy of anything it couldn't restore to a recovery folder under
`.codegraph/rename-recovery-<process-id>-<random>/` so nothing is lost. It
will tell you it's safe to retry *the restore step alone*; it will not
suggest re-running the rename itself.

Like Steps 11 and 12, forcing this exact timing by hand isn't practical
through the CLI (it requires a file to go read-only in the narrow window
after a snapshot is taken); this is proven at the test level:

```bash
npx vitest run __tests__/refactor-apply.test.ts -t "rollback-failed"
```

**Expect**: passing tests confirming the `rollback-failed` outcome, exit code
`4`, and a recovery folder containing whatever wasn't restored.

---

## User Story 4 — The same capability, through your AI coding assistant

### Step 14 (S2-G) — Calling `codegraph_rename` from an AI assistant instead of the terminal

If you use an AI coding assistant that's connected to this project's
CodeGraph server (Claude Code, Cursor, or similar, with CodeGraph installed),
the identical capability is available to it as a tool named
`codegraph_rename` — same plan, same safety ladder, same refusals, just
delivered as a normal tool result instead of a terminal exit code.

1. Ask your assistant to list the CodeGraph tools it has available (most
   assistants show this in a tool/settings panel, or will tell you if asked
   directly). **Expect**: `codegraph_rename` is present, and it is the
   *second* tool listed after `codegraph_explore` — confirmed directly in
   this build's source (`DEFAULT_MCP_TOOLS = new Set(['explore', 'rename'])`).
   It is never hidden behind extra configuration.
2. In your `/tmp/codegraph-uat` folder, ask the assistant: *"Using the
   codegraph_rename tool, do a dry-run rename of `loneFn` to `soloFn` — do
   not apply it."* **Expect**: the assistant reports back a plan (the same
   shape as Step 1's `--json` output) and nothing on disk changes. If you
   want to check precisely, ask it to show you the raw tool result and
   compare it against `node "$CG_BIN" rename loneFn soloFn --json` run
   yourself — they should match field for field.
3. Ask the assistant to trigger one of the refusals you already saw on the
   command line (for example, the ambiguous `handle` rename from Step 4, or
   the stale-file case from Step 10, rebuilt the same way). **Expect**: the
   assistant receives a normal, non-error tool result carrying the same
   refusal reason and message you saw on the CLI — not a tool failure. This
   matters: an AI assistant that gets a hard error from a tool tends to stop
   using it; a refusal that explains itself lets the assistant retry
   correctly on its own.
4. Ask the assistant to apply a safe, all-exact rename (for example,
   `computeTotal` → `sumTotal`, if you still have the `locals.ts` file from
   grounding, or any other clean rename). **Expect**: it follows the exact
   same ladder as Step 8 — write, re-sync, post-check — and reports the same
   kind of result.
5. Optional, engineering-level confirmation (open the file and read it
   yourself — no tool needed): `src/mcp/server-instructions.ts` contains a
   section titled `## codegraph_rename — the write tool (dry-run by
   default)`, confirmed present in this build. This is the paragraph every
   connected AI assistant is told about the tool; it exists without pushing
   out the guidance that tells assistants to prefer `codegraph_explore` for
   everyday lookups.

---

## FR Coverage Matrix

Every functional requirement in `spec.md`, mapped to the runbook step(s)
above that exercise it. Where a step relies on the automated test suite
instead of a hand-run repro (Steps 5b, 11, 12, 13), that is the same
citation used above, not a new claim.

| FR | What it guarantees | Exercised by |
|---|---|---|
| FR-001 | Dry-run is the default; nothing is written unless you ask | Step 1 |
| FR-002 | Every edit shows file, range, before/after text, and a confidence tier | Step 1 |
| FR-003 | Uses a language server when one covers the language; the graph otherwise | Step 2 |
| FR-003a | A missing/broken language server, or an incomplete answer from one, never fails the command — it degrades to the graph path and says so | Step 2; "Already Executed" (D3) |
| FR-004 | Each edit is tagged `exact` or `heuristic` by a fixed rule, never a guess | Step 7; Step 9 |
| FR-005 | Shadowing/aliases/string-similar names are excluded from edits in an up-to-date file; a genuinely drifted file refuses the whole plan instead | Step 7; Step 10 |
| FR-006 | Targeting by bare name, `Class.method`, `--file`, `--kind` | Step 4; Step 5 |
| FR-007 | Ambiguous names refuse and list every candidate with the qualifier that selects it | Step 4 |
| FR-008 | No interactive picker on any surface — the refusal is the only UI | Step 4 |
| FR-009 | The language-server path can rename locals/parameters | Step 5 (contrast case) |
| FR-010 | The graph-only path refuses locals/parameters by name, with a reason | Step 5 |
| FR-011 | `file` / `route` / `import` / `export` kinds are refused on every path | Step 5 |
| FR-012 | Comments, docstrings, and string literals are never edited | Step 7 |
| FR-013 | Leftover textual mentions are only ever counted, never edited | Step 7; "Already Executed" (D3) |
| FR-014 | `--apply` recomputes the plan fresh each time — there is no separate saved plan file | Step 8 |
| FR-015 | An edit below `exact` confidence blocks apply unless explicitly allowed | Step 9 |
| FR-016 | Right before writing, every edit is re-checked against the live file bytes | Step 10 |
| FR-017 | Writes can't land outside the project folder or in files excluded from indexing | Step 12 |
| FR-018 | Touched files are snapshotted, re-synced, and checked for leftover old-name references before a rename is called done | Step 8; Step 11 |
| FR-019 | If anything is left dangling, every touched file is restored exactly | Step 11 |
| FR-019a | If the restore itself fails, that's reported clearly with a recovery folder — never silently | Step 13 |
| FR-020 | Everything-or-nothing: a rename never leaves files half-changed | Step 8; Step 10; Step 11 |
| FR-021 | The AI-assistant tool mirrors the command-line tool exactly | Step 14 |
| FR-021a | Bad arguments (empty/invalid name, renaming something to its own name, an unrecognized `--kind`) are refused by name, never guessed at | Step 6 |
| FR-022 | The rename tool is always available to a connected AI assistant, second after explore | Step 14 |
| FR-023 | Every recoverable situation comes back as guidance, never as a raw tool error | Step 14; also true throughout Steps 4, 5, 9, 10, 12 |
| FR-024 | Adding this tool did not slow down or degrade normal AI-assistant use | "Already Executed" (S2-H) |
| FR-025 | The AI assistant's own instructions describe this tool without burying the "explore first" guidance | Step 14 |
| FR-026 | Consistent exit codes across every outcome (0/2/3/4, see the table in Environment Setup) | Throughout Steps 1, 4, 8, 9, 10, 11, 13 |
| FR-027 | A plain table by default; `--json`/the AI-assistant tool give the same data machine-readably, matching each other | Step 1; Step 14 |
| FR-028 | The AI-assistant tool honestly declares itself a write tool, not a read-only one | Step 14 |

---

## Already Executed During Development

These checks are not asked of you again in this runbook, either because
re-running them adds risk without adding new information, or because they
require infrastructure (a multi-run AI-assistant benchmark) this runbook
can't reasonably ask a reviewer to reproduce. They are recorded here for
transparency, pulled from the project's own workflow record and PR packets.

**Self-repo dogfood (this feature was used to rename a real symbol in this
very codebase).** During development, a dry-run and apply were run against
this CodeGraph checkout itself (381 TypeScript files at the time). That run
found a real defect, **D3**: the language-server plan covered only the
symbol's own declaration file, not the two other files that genuinely
referenced it (the language server hadn't finished loading the project when
it was asked) — `--apply` reported success and a clean post-check, but
`tsc` then failed to compile and 9 tests broke at runtime. That was fixed
the same session: a language-server plan is now cross-checked against the
graph's own reference list, and any gap degrades the *whole* rename to the
graph path instead of shipping an incomplete one (this is the
`lspDegradation: "incomplete-coverage"` field you can see live in Step 2).
After the fix, the same rename was re-run end to end: the plan correctly
degraded to the graph path, covered all three reference files, applied
cleanly, and — critically — **`tsc` compiled clean afterward** and the
affected test file passed 60/60. The change was then reverted, and the
project's node/edge counts were confirmed identical before and after
(7,885 nodes / 31,686 edges either side of the mutate-then-revert cycle) —
no residue was left behind.

**Linux, in Docker.** The full apply-path test suite was run in a
`node:22-bookworm` container (`docker run --rm --init`) twice: once as root
(179/182 passed — the 3 failures are a known, deterministic artifact of
one test simulating a permission failure via `chmod`, which `root` is
immune to by design, not a real bug) and once as a non-root user
(**182/182 passed**, including all 3 of those permission-simulation tests
passing correctly under a real unprivileged account).

**The AI-assistant retrieval check (S2-H).** Adding `codegraph_rename` grows
the set of tools offered to a connected AI assistant by default. A
controlled before/after comparison (2 runs per arm, against the `express`
repository, using the project's standard "floor model" benchmark
methodology) found **no regression**: the new tool was correctly exposed
(visible in the assistant's tool list) but never mistakenly reached for on
an unrelated task, and timing/tool-call counts stayed within normal
run-to-run variance between the two arms.

**A post-implementation code review batch (D5).** An independent full-branch
review after the feature's own gate testing found and fixed four issues
before anything shipped, the most significant being: a genuine mid-write
disk error (disk full, a permissions problem, a file lock) previously could
leave some files renamed and others not, with no recovery information — this
now routes through the exact same restore-and-report path as Step 11/13
above, so it always ends in one of the same two honest outcomes (safely
undone, or the Step 13 malfunction report). The final, full automated test
suite after all of this — including the D3, D4, and D5 fixes — passed
**3,117 of 3,117 tests** across 175 test files, with a clean build and a
clean TypeScript check.

---

## Known Gaps and Deferred Validation

**Windows is not validated — treat it as untested, not passing.** This is
the exact status recorded in the project's own workflow file: *"Windows
deferral note: apply/rollback end-to-end unvalidated on Windows — tracked
follow-up, VM suspended (spec Assumptions / design-concept Q10)."* The
fuller context from the same PR record: the write path is built entirely on
cross-platform Node file APIs, and CodeGraph's own validation VM for Windows
was suspended for the duration of this feature's development, so nothing in
User Story 3 has ever actually been run on a Windows machine. A related fix
made during the post-implementation review (correcting how a language
server's file paths are compared on Windows-style path separators) was also
never executed on real Windows — it was reasoned and reviewed, not proven.
**If you are validating this on Windows, this entire runbook — especially
User Story 3 — should be treated as the first real pass, not a
confirmation.** Un-gating the test suite's Windows-only assertions
(currently skipped via `it.runIf`) is the tracked follow-up once a Windows
environment is available again.

**Two accepted, deliberate v1 limits** (not defects — documented scope cuts):

- **A hard process kill in the middle of writing files.** Snapshots for the
  rollback safety net (Step 11) are only held until the post-check finishes;
  if the whole process is killed mid-write, recovery is "best effort," not
  guaranteed. This is a known, accepted limitation, not a bug to chase.
- **Two separate CodeGraph processes applying a rename to the same project
  at the same time.** Within one running process, concurrent renames are
  safely serialized; a command-line apply racing a separate background
  process's apply on the same project is not — this is a documented v1
  limitation with no additional locking built for it yet.

---

## Cleanup After This UAT Pass

Every write this runbook asks you to make happens inside the throwaway
`/tmp/codegraph-uat` folder from Environment Setup. Nothing in the CodeGraph
checkout itself is modified by this runbook — the two places it touches the
real checkout (Step 2's language-server check and Step 5's parameter-kind
check) are both dry-run only, and were confirmed to leave it unchanged.

To remove everything this runbook created:

```bash
rm -rf /tmp/codegraph-uat
```

If you cloned a fresh copy of the checkout in Environment Setup just for
this review, you can remove that too once you're done.

---

## Sign-off

| Field | Value |
|---|---|
| Reviewer | |
| Date | |
| Steps 1–9, 14 (hands-on) | Pass / Fail / Notes: |
| Steps 11–13 (automated-test citation) | Pass / Fail / Notes: |
| Step 10 — stale-index refusal (critical) | Pass / Fail / Notes: |
| Windows (Known Gaps) | Not validated — informational only |
| Overall verdict | Approve / Request changes |
