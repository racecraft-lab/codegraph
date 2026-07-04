# Resolution — edit-time rules

Full detail: root CLAUDE.md → "Dynamic-dispatch coverage" + "Validation methodology"; constitution Principle V.

- Synthesized edges carry `provenance: 'heuristic'` with `metadata.synthesizedBy` + `registeredAt` (the wiring site). No speculative edges — silent beats wrong.
- Close every bridged flow end-to-end before shipping: partial coverage is WORSE than none (a half-bridged flow raises agent reads — measured on excalidraw).
- Any synthesizer/resolver change re-runs the validation methodology from root CLAUDE.md: deterministic probes + agent A/B on small/medium/large repos.
- Framework resolvers: one file per ecosystem under `frameworks/`, emitting `route` nodes and `references` edges.
