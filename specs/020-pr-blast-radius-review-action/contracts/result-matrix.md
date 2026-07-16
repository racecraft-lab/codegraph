# Contract: Result Matrix

| Detector status | Detector exit | Threshold config | Delivery state | Narrative state | Final conclusion |
|-----------------|---------------|------------------|----------------|-----------------|------------------|
| `clean` | 0 | any | durable report available | any | `pass` |
| `impact` | 1 | unset or not breached | durable report available | any | `pass` |
| `threshold_breach` | 2 | breached | durable report available | any | `fail-threshold` |
| `unavailable` | 3 | any | unavailable report available | any | `fail-analysis-unavailable` |
| `clean` or `impact` | 0 or 1 | not breached | no durable report surface available | any | `fail-report-unavailable` |

## Interpretation rules

1. Detector JSON is canonical for deterministic facts.
2. Detector exit code 1 means ordinary impact, not action failure.
3. Threshold policy is the only impact-based blocking rule.
4. Analysis unavailable after fallback always fails.
5. Narrative state never changes the final conclusion.
6. Comment delivery unavailable does not fail if summary and artifact delivery succeed.
7. If all durable report delivery fails, the action fails because reviewers cannot access the computed report.
