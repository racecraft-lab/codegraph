/**
 * Cypher surface limits shared by the library, the CLI, and the MCP tool.
 *
 * All three surfaces advertise byte-identical envelopes, so a limit kept as an
 * independent literal per file drifts silently the first time one of them is
 * tuned: the CLI starts rejecting at a threshold the MCP tool still accepts,
 * and the diagnostic text stops matching the limit actually enforced. Every
 * Cypher ceiling belongs here so there is exactly one number to change.
 */

/** Maximum accepted Cypher query text, in UTF-16 code units. */
export const CYPHER_MAX_INPUT_CODE_UNITS = 10_000;

/**
 * Wall-clock ceiling for a single Cypher read. Part of the published result
 * contract (`CypherRuntimeTimeoutResult.deadlineMs`), so it is a literal type
 * rather than a plain number.
 */
export const CYPHER_RUNTIME_DEADLINE_MS = 5000 as const;
