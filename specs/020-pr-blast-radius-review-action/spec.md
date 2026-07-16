# Feature Specification: PR Blast-Radius Review Action

**Feature Branch**: `020-pr-blast-radius-review-action`

**Created**: 2026-07-15

**Status**: Draft

**Input**: User description: "Create a reusable GitHub Action that reports deterministic pull-request blast radius, enforces opt-in thresholds, degrades safely for forks, and keeps optional LLM narrative prose-only."

## Clarifications

### Session 2026-07-15

- Q: How must the reusable action execute its helper without depending on uncompiled repository source? → A: Use a packaged, reproducibly pinned action runtime.
- Q: What is the minimum v1 action contract for deterministic analysis and policy control? → A: Expose comparison, caller threshold, hub threshold, traversal, row-limit, report, delivery, and conclusion fields.
- Q: What proof is required before a restored graph cache may be used? → A: Validate version, extraction, complete index state, repository identity, comparison identity, and clean freshness before analysis.
- Q: What trust boundary controls comment writing and narrative secrets? → A: Run deterministic analysis on pull-request events; permit comment writes and secret-backed narrative only when token permissions and event trust allow them.
- Q: What is the sticky-comment recovery policy for deleted comments, duplicates, and reruns? → A: Create when missing, update the newest action-owned comment, retire older action-owned duplicates when permitted, and record degraded delivery when not permitted.
- Q: What fallback is required when privileged delivery is unavailable? → A: Publish the exact deterministic markdown to the workflow summary and artifact regardless of comment or narrative eligibility.
- Q: How does the action map detector results to final check conclusions? → A: Clean and ordinary impact pass, threshold breach fails, and unavailable analysis fails.
- Q: What happens when optional narrative is disabled, misconfigured, or unavailable? → A: Preserve deterministic report and conclusion, record narrative status, and omit or degrade prose.
- Q: How is the three-minute warm-cache target measured? → A: Median of at least five successful self-repository warm-cache pull-request runs with narrative disabled.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Current PR impact report (Priority: P1)

As a reviewer, I want every pull request to show one current deterministic blast-radius report so I can see changed symbols, callers, affected flows, risks, warnings, and limits before approving the change. `[US1]`

**Why this priority**: The report is the core value of the action. Without a current deterministic report, threshold policy, fallback delivery, and narrative have nothing authoritative to act on.

**Independent Test**: Open a pull request with a change that has detectable impact and verify that exactly one current action-owned report is produced with the deterministic sections reviewers need.

**Acceptance Scenarios**:

1. **Given** a pull request with detectable impacted callers or flows, **When** the action completes successfully, **Then** reviewers see a deterministic report that lists changed symbols, callers, affected flows, risks, warnings, and limits. `[US1]`
2. **Given** a pull request has a previous action-owned report, **When** the action reruns, **Then** the existing action-owned report is updated in place rather than creating an unrelated new current report. `[US1]`
3. **Given** a pull request has comments not owned by this action, **When** the action publishes its report, **Then** those unrelated comments remain unchanged. `[US1]`

---

### User Story 2 - Safe report availability for forks and restricted permissions (Priority: P1)

As a pull-request author or reviewer, I want the same deterministic report to remain available even when the workflow cannot update a pull-request comment, so permission limitations do not erase useful analysis. `[US2]`

**Why this priority**: The selected design requires every PR, including forks, to receive safe deterministic analysis while privileged delivery and secret-backed behavior degrade safely.

**Independent Test**: Run the action in a restricted or fork-like permission context and verify that a successful deterministic report is still available in durable workflow surfaces without using privileged secrets.

**Acceptance Scenarios**:

1. **Given** a fork pull request or restricted token context, **When** deterministic analysis succeeds but commenting is unavailable, **Then** the report is available in the workflow summary and as an artifact. `[US2]`
2. **Given** comment publishing fails because of missing permission, **When** the deterministic analysis has succeeded, **Then** the check conclusion reflects the analysis result rather than treating delivery failure as analysis failure. `[US2]`
3. **Given** an untrusted pull request context, **When** optional narrative would require secrets or privileged credentials, **Then** narrative is suppressed and deterministic reporting continues without elevation. `[US2]`

---

### User Story 3 - Opt-in policy enforcement (Priority: P2)

As a repository maintainer, I want ordinary blast radius to stay advisory and only configured caller or hub threshold breaches to fail the check, so the action gives useful review signal without blocking every impactful change. `[US3]`

**Why this priority**: The action must preserve the selected "thresholds only" policy and distinguish ordinary impact from enforceable policy breaches.

**Independent Test**: Run the action with thresholds unset, with caller thresholds configured, and with hub thresholds configured; verify the check conclusions match the configured policy in each case.

**Acceptance Scenarios**:

1. **Given** thresholds are unset, **When** a pull request has ordinary impact, **Then** the action reports the impact and the check passes. `[US3]`
2. **Given** caller or hub thresholds are configured, **When** a pull request breaches one of those thresholds, **Then** the action reports the breach and the check fails. `[US3]`
3. **Given** analysis remains unavailable after fallback, **When** no deterministic blast-radius result can be produced, **Then** the action publishes the unavailable report and fails explicitly. `[US3]`

---

### User Story 4 - Correct cache use and optional prose narrative (Priority: P3)

As a maintainer, I want cached graph state to speed up PR runs without changing correctness, and I want optional narrative to explain deterministic findings without changing facts or status. `[US4]`

**Why this priority**: Cache behavior and narrative integration improve usability, but they must remain subordinate to deterministic correctness, privacy, and dormancy constraints.

**Independent Test**: Run the action with a valid warm cache, a stale or missing cache, narrative disabled, and narrative enabled in a trusted context; verify report facts and check status remain deterministic.

**Acceptance Scenarios**:

1. **Given** a restored index is compatible with the pull-request checkout and comparison target, **When** the action runs, **Then** it may use the restored state and still reports current deterministic impact. `[US4]`
2. **Given** a cache miss, stale index, or invalid restored state, **When** the action runs, **Then** it rebuilds before analysis or reports explicit analysis unavailability if fallback cannot recover. `[US4]`
3. **Given** narrative is disabled, unavailable, or suppressed for trust reasons, **When** the action completes, **Then** deterministic facts, thresholds, report delivery, and check status are unaffected. `[US4]`
4. **Given** narrative is enabled in a trusted context, **When** it is appended to the report, **Then** it remains prose-only and cannot add machine-consumed facts or change the check conclusion. `[US4]`

---

### Edge Cases

- Fork pull requests can be analyzed but cannot use privileged comment or narrative credentials.
- Comment publishing may be denied, the prior sticky comment may have been deleted, or duplicate action-owned markers may exist.
- Reruns or synchronize events may overlap; the report must identify the run and comparison it represents so the newest completed report remains distinguishable.
- A cache entry may be missing, stale, corrupt, or incompatible with the pull-request checkout or comparison target.
- Analysis may produce clean results, ordinary impact, caller threshold breach, hub threshold breach, warnings, limits, or an unavailable state.
- Optional narrative may be disabled, misconfigured, unavailable, rate-limited, or unsafe for the current event trust boundary.
- Artifact or summary delivery may fail after deterministic analysis succeeds.
- Reruns and synchronize events may occur close together and must not rewrite unrelated comments or present stale analysis as current.
- The detector may return an ordinary-impact nonzero exit code that the action must capture and interpret rather than letting the shell fail the job before policy mapping.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The action MUST analyze every pull request event in scope, including fork pull requests, without requiring privileged secrets for deterministic analysis. `[US1]` `[US2]`
- **FR-002**: The action MUST produce a deterministic markdown report for each successful analysis that includes changed symbols, callers, affected flows, risks, warnings, and limits. `[US1]`
- **FR-003**: The action MUST preserve the deterministic detector output as the authority for report facts, threshold evaluation, and check conclusion. `[US1]` `[US3]`
- **FR-004**: The action MUST maintain one current action-owned pull-request comment when comment permissions are available, identified by a stable hidden ownership marker. `[US1]`
- **FR-005**: The action MUST edit only comments that contain the action-owned hidden marker and MUST NOT modify unrelated pull-request comments. `[US1]` `[US2]`
- **FR-006**: When comment delivery is unavailable but analysis succeeds, the action MUST publish the same deterministic report to the workflow summary and upload it as an artifact. `[US2]`
- **FR-007**: The action MUST distinguish analysis availability from report-delivery availability in observable outputs and conclusions. `[US2]` `[US3]`
- **FR-008**: The action MUST pass ordinary impact results unless a configured caller or hub threshold is breached. `[US3]`
- **FR-009**: The action MUST fail the check when a configured caller threshold is breached. `[US3]`
- **FR-010**: The action MUST fail the check when a configured hub threshold is breached. `[US3]`
- **FR-011**: The action MUST fail explicitly when indexing or impact analysis remains unavailable after its fallback attempt. `[US3]`
- **FR-012**: The action MUST make unset caller and hub thresholds mean advisory reporting only, including for CodeGraph's initial self-repository dogfood workflow. `[US3]`
- **FR-013**: The action MUST validate restored graph state against the relevant pull-request checkout and comparison target before using it for analysis. `[US4]`
- **FR-014**: The action MUST rebuild graph state before analysis when the cache is missing, stale, corrupt, or otherwise invalid. `[US4]`
- **FR-015**: The action MUST never report a stale restored index as current analysis. `[US4]`
- **FR-016**: Optional narrative MUST be disabled by default. `[US4]`
- **FR-017**: Optional narrative MUST be suppressed when the current event cannot safely access required secrets or trusted credentials. `[US2]` `[US4]`
- **FR-018**: Optional narrative, when enabled, MUST remain prose-only and MUST NOT change deterministic facts, thresholds, structured outputs, or the check conclusion. `[US4]`
- **FR-019**: The action MUST expose an observable result matrix covering clean analysis, ordinary impact, caller threshold breach, hub threshold breach, analysis unavailable, comment unavailable, artifact unavailable, and narrative unavailable. `[US2]` `[US3]` `[US4]`
- **FR-020**: The repository MUST dogfood the action automatically on CodeGraph pull requests in advisory mode before blocking thresholds are enabled. `[US3]` `[US4]`
- **FR-021**: The feature MUST include reviewer-facing documentation that explains setup, inputs, outputs, fallback behavior, threshold policy, cache behavior, fork behavior, and narrative authority. `[US1]` `[US2]` `[US3]` `[US4]`
- **FR-022**: The reusable action MUST execute through a packaged, reproducibly pinned runtime/helper and MUST NOT require consuming repositories to execute uncompiled TypeScript source directly. `[US1]` `[US4]`
- **FR-023**: The action MUST publish the resolved CodeGraph runtime version and helper version used for the analysis in machine-readable output or report metadata. `[US1]` `[US4]`
- **FR-024**: The minimum v1 action inputs MUST cover comparison target, caller threshold, hub threshold enablement, caller traversal depth, maximum caller rows, and narrative enablement. `[US3]` `[US4]`
- **FR-025**: The minimum v1 action outputs MUST cover detector summary status, detector exit code, deterministic report location, delivery status, cache status, threshold breach status, narrative status, and final check conclusion. `[US1]` `[US2]` `[US3]` `[US4]`
- **FR-026**: Caller-threshold input MUST map to the detector's caller threshold policy, and hub-threshold enablement MUST map to the detector's hub threshold policy without creating a second policy engine. `[US3]`
- **FR-027**: Cache identity MUST include the dependency lockfile identity, merge base, base ref, pull-request head, and CodeGraph runtime identity. `[US4]`
- **FR-028**: A restored cache MUST be accepted only when validation proves matching repository identity, matching comparison identity, compatible CodeGraph version, compatible extraction version, complete index state, no worktree mismatch, and no stale or pending indexed changes. `[US4]`
- **FR-029**: If cache validation fails, the action MUST rebuild before analysis and MUST record whether the final analysis used a warm cache, rebuilt cache, or unavailable cache path. `[US4]`
- **FR-030**: Deterministic analysis MUST run from the pull-request event context without requiring `pull_request_target` execution of untrusted pull-request code. `[US2]`
- **FR-031**: The workflow MUST request the least token permissions needed for each delivery path, and comment writing MUST require pull-request write permission in a trusted context. `[US2]`
- **FR-032**: Fork, Dependabot-like, or otherwise untrusted runs MUST treat write permissions and normal repository secrets as unavailable unless the platform explicitly provides them safely. `[US2]`
- **FR-033**: Secret-backed narrative MUST be disabled for untrusted or read-only-token runs even when deterministic analysis and fallback delivery continue. `[US2]` `[US4]`
- **FR-034**: If no action-owned report comment exists and comment write permission is available, the action MUST create one with the stable hidden marker. `[US1]` `[US2]`
- **FR-035**: If exactly one action-owned report comment exists, the action MUST update that comment in place. `[US1]`
- **FR-036**: If multiple action-owned report comments exist, the action MUST update the newest action-owned comment, retire older action-owned duplicates when write permission allows, and record a duplicate-comment warning when cleanup cannot complete. `[US1]` `[US2]`
- **FR-037**: If the prior action-owned comment was deleted, the action MUST create a replacement when write permission allows and otherwise use fallback delivery. `[US1]` `[US2]`
- **FR-038**: Every report delivery surface MUST identify the action run and comparison target it represents so reruns and synchronize events can be distinguished. `[US1]` `[US2]`
- **FR-039**: Delivery degradation MUST NOT change deterministic analysis status, threshold status, or final check conclusion except when all durable report delivery surfaces fail. `[US2]` `[US3]`
- **FR-040**: The action MUST capture and interpret the detector's structured result and exit code so ordinary impact does not fail the job merely because the detector exits nonzero for impact. `[US3]`
- **FR-041**: Detector status `clean` with exit code 0 MUST produce a passing final check conclusion. `[US3]`
- **FR-042**: Detector status `impact` with exit code 1 MUST produce a passing final check conclusion unless a configured threshold policy is breached. `[US3]`
- **FR-043**: Detector status `threshold_breach` with exit code 2 MUST produce a failing final check conclusion. `[US3]`
- **FR-044**: Detector status `unavailable` with exit code 3 MUST produce a failing final check conclusion after cache validation and rebuild fallback are exhausted. `[US3]`
- **FR-045**: If deterministic analysis succeeds but every durable delivery surface fails, the action MUST fail explicitly with a report-delivery-unavailable conclusion. `[US2]` `[US3]`
- **FR-046**: Optional narrative MUST expose a narrative status of disabled, suppressed, unavailable, fallback, pending, or appended without changing detector status, threshold status, or final check conclusion. `[US4]`
- **FR-047**: Narrative misconfiguration, endpoint failure, agent-bundle pending state, or fallback prose MUST NOT fail the action when deterministic analysis and durable report delivery are otherwise successful. `[US4]`
- **FR-048**: Warm-cache performance measurement MUST use at least five successful CodeGraph self-repository pull-request runs with cache validation accepted, thresholds unset, and narrative disabled. `[US4]`
- **FR-049**: Warm-cache duration MUST be measured from action start through durable deterministic report delivery, and each measurement MUST record cache status, run identity, comparison identity, and whether the run was excluded from the warm-cache sample. `[US4]`

### Reviewability Budget *(mandatory)*

- **Primary surface**: harness/adapter
- **Secondary surfaces, if any**: scheduler/runtime, seed/config, docs/process
- **Projected reviewable LOC**: 455 reviewable LOC from the Grill Me estimator; roadmap setup projection was 405 reviewable LOC
- **Projected production files**: approximately 4
- **Projected total files**: approximately 11
- **Budget result**: warning accepted
- **Split decision**: SPEC-020 remains one spec because the maintainer explicitly selected "Keep one spec" in Q9. Planning and task generation must keep scope to the smallest complete reusable action surface and rerun reviewability gates rather than widening the feature or silently splitting it.

### PR Review Packet Requirements *(mandatory)*

- PR description MUST include: what changed, why, non-goals, review order, scope budget, traceability, verification evidence, known gaps, and rollback or feature-flag notes.
- Traceability MUST map each major requirement or success criterion to changed files and verification evidence.
- Deferred work MUST name the follow-up spec or issue.

### Key Entities *(include if feature involves data)*

- **Pull Request**: The review event being analyzed; key attributes include base ref, head ref, trust boundary, and delivery permissions.
- **Analysis Run**: One action execution for a pull request; key attributes include comparison target, analysis availability, detector result, threshold outcome, delivery outcome, and final conclusion.
- **Conclusion Matrix**: The mapping from deterministic detector status, threshold policy, delivery availability, and narrative availability to the final check conclusion.
- **Action Contract**: The reusable action's public input/output surface; key attributes include comparison target, threshold policy inputs, traversal controls, report locations, cache status, narrative status, detector exit code, and final conclusion.
- **Deterministic Report**: The authoritative markdown review artifact; key attributes include changed symbols, callers, affected flows, risks, warnings, limits, hidden ownership marker, and optional narrative appendix.
- **Threshold Policy**: The maintainer-configured caller and hub limits; key attributes include unset advisory defaults, caller limit, hub limit, and breach status.
- **Cache Validation Result**: The decision about restored graph state; key attributes include cache identity, hit or miss, version compatibility, extraction compatibility, repository and comparison identity, index completeness, freshness status, rebuild requirement, and unrecoverable failure reason.
- **Report Delivery**: The publication outcome for comments, workflow summary, and artifact; key attributes include success, fallback, permission denial, and durable report location.
- **Trust Boundary**: The classification of the pull-request run for privileged operations; key attributes include same-repository versus fork-like origin, token permission level, secret availability, comment eligibility, and narrative eligibility.
- **Narrative Appendix**: Optional prose explanation of deterministic findings; key attributes include enabled state, trust eligibility, availability, and confirmation that it has no machine authority.
- **Performance Sample**: One dogfood action run included in or excluded from the warm-cache target; key attributes include run identity, comparison identity, cache status, narrative status, threshold configuration, duration, and exclusion reason.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a pull request with detectable impact, reviewers can find one current deterministic report containing changed symbols, callers, affected flows, risks, warnings, and limits. `[US1]`
- **SC-002**: In a restricted or fork-like context where comment publishing is unavailable, 100% of successful analyses still publish the deterministic report to both the workflow summary and an artifact. `[US2]`
- **SC-003**: With thresholds unset, ordinary impact results pass while still showing the complete deterministic report. `[US3]`
- **SC-004**: With caller or hub thresholds configured, 100% of threshold breaches produce a failing check and identify the breached policy in the report. `[US3]`
- **SC-005**: 100% of unrecovered indexing or analysis-unavailable outcomes fail explicitly and include an unavailable report rather than appearing safe. `[US3]`
- **SC-006**: Stale, missing, corrupt, or incompatible cached graph state is never used as current analysis; each such run either rebuilds before analysis or reports explicit unavailability. `[US4]`
- **SC-007**: The median warm-cache completion time for CodeGraph's self-repository dogfood workflow is no more than three minutes. `[US4]`
- **SC-008**: Narrative-disabled, narrative-unavailable, and untrusted-fork runs produce the same deterministic facts and check conclusion they would produce without narrative support. `[US2]` `[US4]`
- **SC-009**: Repeated runs update the action-owned report without modifying unrelated pull-request comments. `[US1]`
- **SC-010**: A consuming repository can identify the exact CodeGraph runtime/helper version, detector summary status, detector exit code, report location, delivery status, cache status, threshold status, narrative status, and final conclusion from one action run. `[US1]` `[US3]` `[US4]`
- **SC-011**: For cache-hit, cache-miss, stale-cache, corrupt-cache, and incompatible-version scenarios, the action records the cache path taken and never uses invalid restored state as current analysis. `[US4]`
- **SC-012**: Fork-like or read-only-token pull-request runs complete deterministic analysis without write credentials or secret-backed narrative and still preserve successful reports in summary and artifact surfaces. `[US2]`
- **SC-013**: Deleted, missing, single, and duplicate action-owned comment scenarios each produce one current report when write permission allows, or a recorded fallback outcome when it does not. `[US1]` `[US2]`
- **SC-014**: Clean, ordinary-impact, threshold-breach, analysis-unavailable, and report-delivery-unavailable fixtures each produce the expected final check conclusion from the documented result matrix. `[US3]`
- **SC-015**: Disabled, suppressed, misconfigured, endpoint-failure, pending-agent, and appended narrative scenarios preserve the same deterministic facts and final conclusion as the no-narrative baseline. `[US4]`
- **SC-016**: The warm-cache performance report includes at least five eligible self-repository pull-request samples and shows a median duration of no more than three minutes. `[US4]`

## Assumptions

- SPEC-012 is complete and provides the canonical deterministic change-detection facts, markdown/JSON schema, affected flow states, warnings, limits, and exit-code meanings consumed by this action.
- SPEC-018 is complete and provides any optional narrative seam used by this action; SPEC-020 does not create a second narrative provider system.
- "Every pull request" means repository pull-request workflows where checkout and deterministic analysis can run safely; privileged commenting and secret-backed narrative are conditional on trust and permissions.
- Comment-delivery failure is a delivery degradation, not an analysis failure, when deterministic analysis succeeds and durable fallback delivery is available.
- Artifact and summary fallback are required durable surfaces for v1; logs alone are not sufficient fallback delivery.
- CodeGraph's initial dogfood workflow runs automatically in advisory mode with caller and hub thresholds unset.
- The exact runtime packaging, action input syntax, cache-key composition, and freshness predicate are technical planning decisions to resolve in later phases without changing the product behavior specified here.
