# Data Model: SPEC-023 - OCaml Language Support

## Entity: OCaml Grammar Artifact

**Fields**

- `artifactName`: `tree-sitter-ocaml.wasm` or `tree-sitter-ocaml_interface.wasm`.
- `sourcePackage`: `tree-sitter-ocaml@0.24.2`.
- `grammarRole`: implementation or interface.
- `license`: MIT.
- `distPath`: copied artifact path under `dist/extraction/wasm/`.
- `healthCheckSample`: representative `.ml` or `.mli` parser input.

**Validation Rules**

- Both required artifacts must exist before OCaml support is accepted.
- Both artifacts must load through the existing tree-sitter WASM runtime.
- `npm run build` must copy both artifacts into `dist/extraction/wasm/`.

## Entity: OCaml Source Unit

**Fields**

- `path`: repository-relative file path.
- `extension`: `.ml` or `.mli`.
- `language`: OCaml.
- `unitRole`: implementation or interface.
- `directoryKey`: normalized parent directory.
- `basenameKey`: filename without extension.
- `workspaceScope`: Dune workspace/package boundary when deterministically known.

**Relationships**

- Contains zero or more `OCaml Symbol` entities.
- May have one `OCaml Interface Pairing`.
- May be constrained by `Workspace Metadata`.

**Validation Rules**

- `.ml` and `.mli` files both report as OCaml.
- Source units without a pair still emit useful symbols.
- Interface units without a source file still emit searchable public declarations.

## Entity: OCaml Symbol

**Fields**

- `name`: local symbol name.
- `qualifiedName`: module-qualified name when deterministically available.
- `nodeKind`: one of CodeGraph's existing node kinds.
- `syntaxCategory`: module, signature, functor, type, record, variant, constructor, value, function, let-binding, class, object, method, field, parameter, module type, or interface item.
- `sourceSpan`: stable start/end location for the accepted declaration, body-bearing binding, public specification item, parameter pattern/name, or stable identifier leaf.
- `spanBoundary`: declaration, declaration-with-body, specification-item, parameter-pattern, identifier-leaf, or nearest-owner fallback.
- `owner`: nearest useful containing symbol or file.
- `unitRole`: implementation, interface, or both.
- `unsupportedSyntaxNote`: optional note for parse-preserved unsupported precision such as PPX attributes or extension nodes.

**Relationships**

- Belongs to one `OCaml Source Unit`.
- Has containment edges to nested symbols.
- May participate in deterministic `OCaml Relationship` records.

**Validation Rules**

- Required constructs must emit stable searchable symbols with useful spans.
- Pattern-heavy definitions and anonymous nested definitions attach to the nearest useful owning symbol.
- Pattern-only bindings must not create synthetic names from whole-pattern text; stable identifier leaves may emit symbols only when their span and owner are clear.
- Anonymous object, module, and functor expressions attach to the nearest useful owner unless they are bound to a stable source name.
- Attributes and extension nodes do not imply PPX-expanded symbols.

## Entity: OCaml Interface Pairing

**Fields**

- `implementationPath`: `.ml` path.
- `interfacePath`: `.mli` path.
- `pairingKey`: normalized directory plus basename.
- `status`: paired, unpaired, or ambiguous.

**Relationships**

- Connects one implementation source unit to one interface source unit only when unique.
- Constrains public symbol exposure and local relationship resolution.

**Validation Rules**

- Pairing is same-directory and same-basename only.
- Ambiguous pairings fail closed and emit no speculative relationship.

## Entity: Workspace Metadata

**Fields**

- `metadataPath`: checked-in `dune-project`, `dune`, root `*.opam`, or `opam/*.opam` path.
- `metadataKind`: project, stanza, or opam package metadata.
- `workspaceRoot`: deterministic local root when known.
- `localPackageNames`: package names from checked-in metadata.
- `visibleLocalModules`: local module candidates constrained by metadata.

**Relationships**

- Constrains `Module Candidate` selection.
- Constrains local package-aware relationships without creating package nodes.

**Validation Rules**

- `_opam`, lock directories, templates, installed switches, and network package state are ignored.
- Metadata constrains local relationships only.
- No `package` nodes and no external package edges are emitted.

## Entity: Module Candidate

**Fields**

- `requestedPath`: module path requested by source syntax, including qualified references, functor application targets or arguments, `open`, and `include`.
- `referenceForm`: qualified path, functor application, open, include, interface pair, or metadata-constrained local relationship.
- `candidateSymbol`: local OCaml symbol candidate.
- `evidence`: source path, functor application syntax, interface pairing, open/include scope, and workspace metadata evidence.
- `candidateCount`: number of surviving candidates after constraints.

**Relationships**

- Produces an `OCaml Relationship` only when `candidateCount` is exactly one.

**Validation Rules**

- Ambiguity fails closed.
- The resolver must not choose by nearest directory, index order, or fuzzy score after ambiguity remains.
- Functor applications produce relationships only when the referenced functor and argument/result modules resolve uniquely; generated result internals are not synthesized.

## Entity: OCaml Relationship

**Fields**

- `sourceSymbol`: source node.
- `targetSymbol`: target node.
- `edgeKind`: existing CodeGraph edge kind, primarily `contains`, `imports`, or `references` for SPEC-023 behavior.
- `evidenceSource`: syntax, functor application, interface pairing, open/include scope, or checked-in metadata.
- `confidence`: deterministic unique-only.

**Validation Rules**

- Relationships are local and deterministic.
- Unsupported PPX/package relationships emit no edge.
- Functor result elaboration and type-equality inference emit no edge.
- No package node or external package edge is produced.

## Entity: PPX Policy

**Fields**

- `status`: unsupported/future work for SPEC-023.
- `syntaxVisibility`: attributes and extension nodes are parse-preserved.
- `expansionBehavior`: no generated symbols or speculative generated relationships.
- `followUp`: future spec or roadmap update required before PPX expansion.

**Validation Rules**

- Implementation tasks must resolve the PPX gate before any PPX-related code.
- SPEC-023 must not claim PPX-expanded precision.

## Entity: Validation Corpus

**Fields**

- `repositoryUrl`: pinned repository URL.
- `commitSha`: exact commit under test.
- `sizeClass`: small, medium, or large.
- `indexCommand`: command used for smoke.
- `filesByLanguage`: language count output.
- `nodeCount`: indexed node count.
- `edgeCount`: indexed edge count.
- `parseWarningsOrErrors`: compact parse health summary.
- `secondRunStability`: same-count or explained variance result.

**Relationships**

- Has three `Retrieval Probe` records.
- May have headless A/B evidence.

**Validation Rules**

- Required corpora are Yojson, OCaml-LSP, and Dune.
- Smoke must show OCaml language status, no fatal indexing errors, stable graph counts, and no speculative unsupported relationships.

## Entity: Retrieval Probe

**Fields**

- `corpus`: Yojson, OCaml-LSP, or Dune.
- `question`: one of the nine pinned structural questions.
- `probeExploreResult`: deterministic result summary.
- `probeNodeResult`: deterministic result summary.
- `withinExploreBudget`: true or false.
- `knownGap`: explicit blocker or limitation when not passing.

**Validation Rules**

- All nine questions require deterministic `probe-explore` and `probe-node` evidence.
- Useful graph-backed context must be returned within the repository-size explore budget.

## Entity: A/B Evidence

**Fields**

- `corpus`: Yojson, OCaml-LSP, Dune, or existing-language control.
- `mode`: new-build versus baseline-build or with-codegraph versus without-codegraph as appropriate.
- `runsPerArm`: at least two when using the agent A/B methodology.
- `durationRange`: measured time range.
- `readCountRange`: measured Read calls.
- `grepCountRange`: measured Grep calls.
- `codegraphCallRange`: measured CodeGraph calls.
- `result`: pass, fail, or deferred with approved gate.

**Validation Rules**

- Yojson and OCaml-LSP A/B evidence is mandatory before SPEC-023 completion.
- Dune A/B may defer only with an explicit follow-up gate before SPEC-023 is complete.
- Existing-language A/B is conditional on shared MCP, explore-budget, resolver, or retrieval behavior changes.

## State Transitions

```text
Planned
  -> Grammar artifacts vendored and health-checked
  -> OCaml files recognized and reported in status
  -> Symbols extracted from fixtures
  -> Deterministic local relationships resolved
  -> Real-repo smoke recorded
  -> Retrieval probes recorded
  -> A/B evidence recorded or explicitly gated
  -> SPEC-023 complete
```

Transitions stop before completion if PPX expansion, package nodes, external package edges, or unresolved ambiguity enters implementation without an approved split or roadmap update.
