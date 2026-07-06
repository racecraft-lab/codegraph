# Dune A/B Gate

Status: follow-up gate recorded; still blocking SPEC-023 completion.

Dune A/B can defer only behind an explicit maintainer-approved follow-up gate
before SPEC-023 is complete.

## Gate

Dune deterministic smoke and probe evidence is complete in `dune-smoke.md` and
`dune-probes.md`. The large-repository headless A/B gate remains required before
SPEC-023 can be called complete, unless the maintainer explicitly replaces it
with a narrower acceptance gate.

## Blocking Evidence

```bash
which claude
```

Result:

```text
claude not found
```

The local A/B harness runs `claude` through `scripts/agent-eval/run-all.sh`, so
this environment cannot execute the Dune A/B gate yet.
