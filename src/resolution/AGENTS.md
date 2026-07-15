# Resolution - Local Rules

Full detail: root `AGENTS.md` and `.specify/memory/constitution.md`.

- Synthesized edges carry `provenance: 'heuristic'` plus `metadata.synthesizedBy`
  and `registeredAt`.
- Silent beats wrong. Do not add speculative edges.
- Close bridged flows end-to-end before shipping; partial coverage can increase
  agent reads.
- Re-run deterministic probes and agent A/B for synthesizer or resolver changes.
- Keep framework resolvers grouped by ecosystem under `frameworks/`, emitting
  `route` nodes and `references` edges.
