# SPEC-023 PPX Policy

PPX expansion is unsupported/future work for SPEC-023.

## Decision

- Attributes and extension nodes may parse successfully and remain present in
  source spans.
- CodeGraph does not run PPX rewriters.
- CodeGraph does not synthesize PPX-generated symbols.
- CodeGraph does not emit speculative generated relationships.
- Dune preprocessing metadata can be documented in validation evidence but does
  not create package nodes, generated symbols, or external package edges.

## Follow-Up Gate

Any PPX expansion support requires a future spec or roadmap update that defines
how generated source is obtained, cached, attributed, privacy-preserved, and
validated against node/edge explosion risk.
