# Memory Index

- [Embedding EndpointProvider design](project_embedding-endpoint-provider.md) — SPEC-001 HTTP client: retry budget (4 total = 1+3), fetch credential-URL leak quirk, full error replacement, dims inference
- [Embedding pass (runEmbeddingPass)](project_embedding-pass.md) — SPEC-001 T016 embed-pass seam: caller MUST supply readSource (Node has no source), dims-enforce precedence, checkpoint only if ≥1 batch written, never throws
- [Embedding indexAll wiring](project_embedding-indexall-wiring.md) — SPEC-001 T019: maybeRunEmbeddingPass in indexAll's advisory slot; dormant-silent when unconfigured, IndexResult NOT extended, refreshLock/readSource construction
