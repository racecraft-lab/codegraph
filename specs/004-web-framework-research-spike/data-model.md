# Data Model: Web Framework Research Spike

SPEC-004 produces decision and evidence artifacts, not production runtime data models. These entities define the information the implementation must capture.

## FrameworkCandidate

Represents one roadmap framework option.

**Fields**

- `name`: One of Vite+React SPA, SvelteKit static/adapter-node, Next.js standalone, Astro islands, TanStack Start, SolidStart.
- `servingMode`: Static, Node/standalone, adapter-node, islands/static, or equivalent documented mode.
- `officialEvidence`: List of `EvidenceSource` records from official documentation.
- `liveMetadata`: `PackageMetadata` and repository health records.
- `hardGateResults`: List of `HardGateResult` records.
- `weightedScores`: List of `WeightedScore` records, present only if all hard gates pass.
- `outcome`: Recommended, runner-up, rejected by score, or rejected by hard gate.

**Validation Rules**

- Exactly six candidates must be present.
- Every candidate must have official evidence and live metadata before any score is final.
- Candidates with any failed hard gate must not have a final weighted ranking position.

## EvidenceSource

Represents a source used to justify a matrix claim.

**Fields**

- `title`: Human-readable source title.
- `url`: Official documentation, npm, package registry, or repository URL.
- `sourceType`: Official docs, package metadata, repository metadata, prototype result, or UAT result.
- `accessedDate`: Date the source was checked.
- `claimSupported`: Specific claim the source supports.

**Validation Rules**

- Official documentation evidence is required for every framework candidate.
- Live package or repository metadata is required for every framework candidate.
- Evidence must be specific enough to support one gate, score, or recommendation claim.

## PackageMetadata

Represents current package and repository facts.

**Fields**

- `packageName`: Package or repository identifier.
- `version`: Current version at implementation time.
- `license`: License string plus license-file confirmation where available.
- `dependencyPosture`: Runtime dependency summary, including any native or hosted-service concern.
- `footprint`: Package size, unpacked size, production asset size, or measured build footprint as applicable.
- `repositoryHealth`: Archive/deprecation status, latest release, latest meaningful activity, and maintainer warnings.

**Validation Rules**

- Non-permissive, source-available-only, unclear, or hosted-service-required runtime dependencies fail the relevant hard gate.
- Maintenance-health evidence must be current when the decision document is written.

## HardGateResult

Represents one pass/fail gate for one candidate.

**Fields**

- `gate`: Self-host anywhere, offline/package-shipped assets, no hosted-service runtime dependency, permissive license, package footprint, or maintenance health.
- `status`: Pass or fail.
- `evidence`: Source references and measured data.
- `notes`: Short explanation of the decision.

**Validation Rules**

- A failed hard gate excludes the candidate from final weighted ranking.
- Every pass/fail decision must cite evidence.

## WeightedScore

Represents one post-gate score.

**Fields**

- `criterion`: UX and graph-interaction fit, deployment effort, developer experience, cost/self-host operations, footprint, or license and maintenance risk.
- `weight`: Numeric weight from the scoring model.
- `score`: Integer or decimal score from 0 to 5.
- `weightedValue`: `score / 5 * weight`.
- `rationale`: Evidence-backed explanation.

**Validation Rules**

- Scores exist only for candidates that pass all hard gates.
- Total score is out of 100.
- UX has the largest weight but cannot override hard gates.

## StackRecommendation

Represents the final selected stack.

**Fields**

- `framework`: Selected `FrameworkCandidate`.
- `graphRenderer`: Selected graph-rendering library or approach.
- `whySelected`: Summary of gate and score rationale.
- `runnerUpTradeoffs`: Explanation of close alternatives.
- `shippingStrategy`: Embedded package-shipped static assets plus standalone container recipe.
- `downstreamGuidance`: Notes for SPEC-005, SPEC-006, and SPEC-007.

**Validation Rules**

- Exactly one framework must be recommended.
- The selected framework must pass every hard gate.
- The recommendation must cite prototype evidence.

## GraphPrototypeEvidence

Represents the throwaway selected-stack graph-rendering proof.

**Fields**

- `prototypeLocation`: Temporary or ignored local path used during implementation.
- `dataShape`: Documented JSON shape for nodes, edges, and metadata.
- `representativeDataset`: Dataset generated from this repository.
- `oneKNodeDataset`: 1k-node target dataset or closest fallback.
- `screenshots`: List of `ScreenshotAsset` records.
- `performanceNotes`: Render timing, interaction notes, machine/browser context, and limitations.
- `reproductionSteps`: Local steps to reproduce the prototype evidence.

**Validation Rules**

- Prototype source must not be committed.
- Evidence must include representative self-repo data.
- Evidence must include 1k-node target results or a documented fallback.

## ScreenshotAsset

Represents committed browser screenshot evidence.

**Fields**

- `path`: `docs/design/assets/spec-004/<name>.png`.
- `purpose`: Self-repo graph, 1k-node target, or documented fallback.
- `sourceDataset`: Dataset used to capture the screenshot.
- `captureTool`: Browser automation, local Playwright, or equivalent fallback.

**Validation Rules**

- At least two PNG screenshots are required unless browser screenshot capture fails and the decision document records the fallback.
- PNG assets must be small and reviewable.

## SelfRepoUATResult

Represents the final dogfooding check.

**Fields**

- `commandsRun`: Build/test/index/export/prototype commands.
- `repositoryData`: Node and edge counts plus selection method.
- `outcome`: Pass, pass with limitation, or fail.
- `evidence`: Screenshot paths and reproduction notes.
- `limitations`: Any blocker mapped to SPEC-005, SPEC-006, SPEC-007, or follow-up issue.

**Validation Rules**

- UAT must use representative CodeGraph data from this repository.
- Failures or fallbacks must be recorded rather than hidden.

## DeferredConcern

Represents work intentionally left for later specs.

**Fields**

- `concern`: Short description.
- `ownerSpec`: SPEC-005, SPEC-006, SPEC-007, or named follow-up.
- `reasonDeferred`: Why SPEC-004 should not solve it.

**Validation Rules**

- Every known implementation concern in the decision document must map to a downstream spec or follow-up.
