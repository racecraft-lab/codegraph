# Yojson A/B Evidence

Status: complete.

Required before SPEC-023 is complete: at least two runs per arm, with model,
effort, duration range, Read/Grep counts, CodeGraph calls, and interpretation.

## Environment

- Claude CLI: `/Users/fredrickgabelmann/.local/bin/claude`, version `2.1.201`.
- Model/effort: run-all defaults, `sonnet` / `high`.
- CodeGraph binary: `dist/bin/codegraph.js` from this SPEC-023 worktree.
- Prompt: `How does from_string parse JSON text into a Yojson value?`
- Output directories: `/private/tmp/spec-023-yojson-ab/r1`, `/private/tmp/spec-023-yojson-ab/r2`.

## Runs

| Run | Arm | CodeGraph exposed | CodeGraph calls | Read | Bash/Grep shell calls | Duration | Result |
|-----|-----|-------------------|-----------------|------|-----------------------|----------|--------|
| r1 | with | 1 | 0 | 2 | 2 | 39s | success |
| r1 | without | 0 | 0 | 3 | 6 | 58s | success |
| r2 | with | 1 | 0 | 3 | 3 | 44s | success |
| r2 | without | 0 | 0 | 11 | 2 plus 1 Agent | 12s | success |

## Interpretation

The with arm exposed CodeGraph in both runs, but Claude did not select the
CodeGraph MCP tool for this Yojson prompt. The with arm still used fewer Read
calls than the without arm, but this is not evidence of CodeGraph retrieval
adoption. Treat Yojson A/B as a completed negative/weak-adoption signal for this
prompt, not as a zero-Read/zero-Grep pass.
