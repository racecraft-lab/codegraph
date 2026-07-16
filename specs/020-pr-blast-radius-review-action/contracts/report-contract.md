# Contract: Deterministic PR Impact Report

## Required sections

1. Hidden action-owned marker.
2. Run metadata: action run id, attempt, repository, pull request, base ref, head SHA, merge base, CodeGraph version, helper version.
3. Summary: detector status, final conclusion, threshold status, cache status, delivery status, narrative status.
4. Changed symbols.
5. Impacted callers.
6. Affected flows.
7. Risks.
8. Warnings.
9. Limits.
10. Fallback/delivery note when comment delivery is unavailable.
11. Optional narrative appendix, when eligible and available.

## Marker rules

- Marker is stable and unique to this action.
- Only comments containing the marker are eligible for update or duplicate cleanup.
- If duplicates exist, the newest marked comment is current; older marked comments are retired when write permission allows.

## Narrative rules

- Narrative appears only after deterministic sections.
- Narrative must be labeled as prose-only.
- Narrative must not introduce machine-consumed facts, threshold decisions, or final conclusion changes.
