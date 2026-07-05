# SPEC-023 Quickstart Run

Status: partial; blocked at the remaining A/B/control gates.

## Local Verification

Previously recorded local verification:

- `npm run build`: passed.
- `npm run typecheck`: passed.
- Targeted OCaml suite: passed, 5 files, 11 tests.
- `npm test`: 136 files passed, 1 file failed; 2233 tests passed, 4 skipped,
  1 daemon idle-timeout failure. Targeted rerun of the daemon idle-timeout case
  passed.

See `existing-language-controls.md` for command details and the Node 26 caveat.

## Real-Repository Smoke and Probes

- Yojson smoke and deterministic probes: complete.
- OCaml-LSP smoke and deterministic probes: complete.
- Dune smoke and deterministic probes: complete.

## Headless A/B

- Yojson: complete, 2 runs per arm. CodeGraph was exposed but not selected by
  Claude for the selected prompt.
- OCaml-LSP: complete with adjusted safer second run. One exact harness run used
  CodeGraph in the with arm; the adjusted run disabled Bash/Task and showed
  CodeGraph exposed but not selected.
- Dune: follow-up gate recorded; not run.
- Existing-language control A/B: applicable, but blocked until a safe
  repo-confined runner or explicit approval for another unsandboxed eval exists.

## Reviewability and Marker Checks

```bash
/Users/fredrickgabelmann/.codex/plugins/cache/racecraft-plugins-public/speckit-pro/2.17.0/skills/speckit-autopilot/scripts/count-markers.sh all specs/023-ocaml-language-support
```

Result:

```json
{"gaps":0,"clarifications":0,"critical":0,"high":0,"medium":0,"low":0}
```

Autopilot coverage guard:

```json
{"status":"pass","plan_step_count":38}
```

## Pass/Fail

The quickstart path is not fully passing yet because Dune A/B remains a
follow-up gate and existing-language A/B is blocked by safe-runner constraints.
Local implementation, deterministic probes, Yojson/OCaml-LSP A/B, and marker
checks are recorded.
