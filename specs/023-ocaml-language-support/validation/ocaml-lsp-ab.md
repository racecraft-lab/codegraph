# OCaml-LSP A/B Evidence

Status: complete with adjusted safer second run.

Required before SPEC-023 is complete: at least two runs per arm, with model,
effort, duration range, Read/Grep counts, CodeGraph calls, and interpretation.

## Environment

- Claude CLI: `/Users/fredrickgabelmann/.local/bin/claude`, version `2.1.201`.
- Model/effort: run-all defaults, `sonnet` / `high`.
- CodeGraph binary: `dist/bin/codegraph.js` from this SPEC-023 worktree.
- Prompt: `How does textDocument/hover reach the code that computes hover output?`

## Exact Harness Run

| Run | Arm | CodeGraph exposed | CodeGraph calls | Read | Bash/Grep shell calls | Duration | Result |
|-----|-----|-------------------|-----------------|------|-----------------------|----------|--------|
| r1 | with | 1 | 2 | 1 | 1 | 33s | success |
| r1 | without | 0 | 0 | 3 | 2 | 33s | success |

## Discarded Run

The original second with arm completed and used CodeGraph four times:

| Run | Arm | CodeGraph exposed | CodeGraph calls | Read | Bash/Grep shell calls | Duration | Result |
|-----|-----|-------------------|-----------------|------|-----------------------|----------|--------|
| r2 | with | 1 | 4 | 2 | 1 | 48s | success |

The paired `without` arm is not counted as a valid sample. It left the target
repo and began broad system searches such as `find /root ...` and `find /Users
...` under `--permission-mode bypassPermissions`. The run was stopped to avoid
continuing an unsafe and contaminated eval.

## Adjusted Safer Run

The replacement second run used a custom file-based MCP config with `Bash`,
`Task`/`Agent`, and edit/write tools disabled. Built-in `Grep` and `Read`
remained available, so this is not the exact original `run-all.sh` policy sample,
but it is repo-confined and safe to count as adjusted headless evidence.

| Run | Arm | CodeGraph exposed | CodeGraph calls | Read | Grep | Duration | Result |
|-----|-----|-------------------|-----------------|------|------|----------|--------|
| r2-safe | with | 1 | 0 | 4 | 5 | 34s | success |
| r2-safe | without | 0 | 0 | 7 | 8 | 74s | success |

## Interpretation

OCaml-LSP shows real CodeGraph adoption in the first exact with arm, but not
enough sufficiency to avoid Read/Grep. The safer adjusted second with arm exposed
CodeGraph but Claude did not select it, while still using fewer Grep/Read calls
than the without arm. Treat this as complete A/B evidence with a weak/partial
adoption interpretation, not as a zero-Read/zero-Grep pass.
