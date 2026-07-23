# Contract: WebSocket Transport

## Upgrade Endpoint

`GET /lsp?repo=<registered-id>` on the existing packaged HTTP server.

Admission order before `101 Switching Protocols`:

1. Validate a WebSocket handshake and exact raw pathname `/lsp`.
2. Apply the existing loopback Host allowlist/DNS-rebinding defense.
3. If Origin is present, require exactly one parsed HTTP(S) origin whose scheme,
   normalized hostname, and effective port equal the served origin.
4. Parse exactly one syntactically valid registered repository ID.
5. Resolve repository and attach its daemon client.
6. Call `ws.handleUpgrade` and create the repository-bound session.

Reject `Origin: null`, multiple/comma-joined/malformed/credential-bearing or
mismatched origins. A genuinely absent Origin is allowed only for otherwise
valid local scripted clients. A Host/Origin rejection cannot reveal repository
or daemon existence. Unknown repository and unavailable daemon preserve existing
404/503 behavior after perimeter gates pass.

## `ws` Configuration

```text
noServer: true
maxPayload: 1_048_576
perMessageDeflate: false
clientTracking: false
closeTimeout: 5_000
```

The server owns a bounded set of sessions for ordered shutdown rather than
relying on library client tracking.

## Message Contract

One complete JSON-RPC object occupies one UTF-8 WebSocket text message after
standards-compliant RFC fragmentation reassembly. The application never splits
one object across messages or combines multiple objects in one message. Batch
arrays are invalid requests.

| Input | Result |
|---|---|
| Malformed JSON text | `-32700`, `id: null`, keep socket open. |
| Invalid JSON-RPC object | `-32600`, safe valid ID or null, keep open. |
| Binary message | close 1003. |
| Invalid UTF-8 | close 1007. |
| Message above 1 MiB | close 1009. |
| Repeated policy/resource abuse | close 1008. |
| Fatal internal/daemon service loss | close 1011 after settling pending work. |
| Server shutdown | close 1001. |
| Clean LSP shutdown/exit | close 1000. |
| Backpressure drain failure | close 1013. |

Codes 1005, 1006, and 1015 are never transmitted. Close reasons are stable,
generic, redacted, and at most 123 UTF-8 bytes.

## Request Limits

- Only accepted ID-bearing requests consume one of 16 in-flight slots.
- Slot reservation happens before daemon dispatch and releases exactly once.
- Request 17 is not queued or dispatched; it receives `-32803` with
  `data.reason="overloaded"`.
- A 5,000 ms wall-clock deadline starts at accepted dispatch. Timeout settles
  once with `-32803`/`timeout`; late daemon completion is discarded.
- Notifications do not consume request slots and cannot mutate state.
- Concurrent responses may complete out of order because IDs correlate them.

## Backpressure

Before dispatch and send, inspect `bufferedAmount`. At 2 MiB or more, stop
dispatching new work. Allow at most 5 seconds to drain below the threshold; if
it does not, settle pending requests and close 1013. Send callbacks, error
events, and close events all converge on the same teardown.

## Liveness and Cleanup

- `ws` handles ping/pong; session liveness may use bounded server pings without
  logging payload or client details.
- Peer close, protocol error, timeout, daemon loss, HTTP server shutdown, and
  backpressure invoke one idempotent teardown.
- Teardown clears timers/listeners/pending slots once and releases only that
  session's daemon-client lease.
- A pooled daemon transport referenced by another session remains open.
- Server shutdown stops upgrades first, settles/closes sessions, then continues
  existing ordered HTTP/daemon shutdown.

## Redaction

Every HTTP rejection, JSON-RPC error message/data, close reason, send failure,
daemon-loss diagnostic, and local log uses the shared redaction formatter. It
never includes source, request params/body, query strings, Authorization/Cookie,
raw Origin, raw client method, absolute path/root, request ID, exception text,
cause, or stack. Valid request IDs are echoed only in protocol responses.
