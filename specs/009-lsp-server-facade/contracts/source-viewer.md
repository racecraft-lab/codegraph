# Contract: Focused Source Viewer

## Ownership and Dormancy

The viewer is an additive pane inside symbol detail. The existing symbol,
relationship, flow, and cluster content remains usable in every source failure.
No socket exists until the user explicitly opens the pane. Closing/unmounting
the pane or changing repository closes it and clears owned work. There is no
background reconnect.

## URL Location Schema

Internal state may retain a canonical file URI and snapshot token. The browser
query contains only:

```text
repo=<registered-id>
source=<percent-encoded-canonical-relative-path>
sl=<start-line>&sc=<start-character>&el=<end-line>&ec=<end-character>
```

All positions are nonnegative zero-based UTF-16 and the range is ordered.
Reject absolute paths, `file:` URIs, traversal, malformed integers, reversed
ranges, and selected-repository mismatch. The server remains authoritative.

History behavior:

- seed initial symbol location with replace
- replace invalid restored state after falling back to indexed symbol location
- push successful explicit definition/reference navigation
- restore POP/back/forward without adding an entry
- never serialize source, absolute paths, hashes, snapshot tokens, or credentials

## Source Composite

- One single-tab-stop read-only composite owns one programmatically active token.
- Pointer and keyboard use the same exact UTF-16 token mapping.
- Visible focus and active-token treatment remain after navigation.
- Named `Show hover details` and `Go to definition` controls operate on the
  active token.
- Enter and a deliberate pointer gesture may activate an exact definition.
- No-result preserves location/focus and announces bounded status.
- Ordinary Tab/scroll/navigation keys are not hijacked beyond documented caret
  controls.

Hover details are non-modal, bounded persisted metadata, associated with the
active token, focus-triggered as well as pointer-triggered, hoverable/persistent,
and dismissed on Escape or token change. Interactive popup content would use a
dialog rather than tooltip semantics. Hover requests use a 150 ms latest-wins
window with cancellation/generation protection.

## References

References are grouped under semantic headings containing repository-relative
path and count. Items preserve server order and are native semantic controls
with accessible names including file, line, and column. Activation pushes the
selected location and focuses the source composite after content is ready.

## Connection and Degradation States

| State | Trigger | Recovery |
|---|---|---|
| dormant | pane closed | explicit Open source |
| connecting | opening/retry socket | wait or close pane |
| loading | current content/intelligence request | wait or close pane |
| ready | successful nonempty source | navigate/inspect |
| empty | successful zero-byte source only | navigate/back |
| stale | `-32801` hash drift | re-index, then manual Retry |
| unavailable | daemon attach or typed source failure | manual Retry when appropriate |
| timed-out | five-second deadline | manual Retry |
| disconnected | unexpected socket loss | manual Retry |

Typed `not_found`, `outside_repository`, `unindexed`, `not_regular`,
`too_large`, and `unreadable` errors receive safe truthful unavailable copy;
they never display as empty.

Manual Retry creates a fresh connection only when needed and replays only the
current validated repo-bound history location. Stale remains stale until the
indexed snapshot changes. Old content is never relabeled as a newly failed
location.

## Race Rules

Increment generation for every location, history restoration, retry,
repository change, and pane lifecycle. Apply a result only if generation,
repository, location, snapshot token, mounted pane, and live connection still
match. Cancel superseded work where supported and otherwise discard it. Suppress
post-unmount state updates.

## Accessibility

- Persistent polite live region announces loading, ready, empty, retry, and
  meaningful state changes without repeating pointer-hover noise.
- Actionable failures may use one one-time alert; announcements do not move
  focus by themselves.
- Retry and source controls keep predictable focus and are not replaced while
  focused.
- Semantic controls, visible focus, narrow-layout scrolling, and reduced-motion
  behavior are required.
- The implementation remains a focused reader: no tabs, editing, diagnostics,
  or workspace chrome.
