/**
 * SPEC-005 error envelope — the closed six-code vocabulary (FR-015/FR-015a).
 *
 * Every failing request across the local API returns the single envelope shape
 * `{ error: { code, message, details? } }`. `error.code` is one of exactly six
 * values, each mapping to a fixed HTTP status. `message`/`details` are limited to
 * whitelisted, schema-defined fields — never raw exception text, absolute paths,
 * stack traces, or cause chains (FR-015a). The `unauthorized` (401) and
 * `internal` (500) bodies are forced generic and identical regardless of the
 * underlying reason: 401 to prevent enumeration, 500 to never leak a fault.
 *
 * @module server/errors
 */

/** The closed six-code error vocabulary (FR-015a). */
export type ErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'not_found'
  | 'conflict'
  | 'unavailable'
  | 'internal';

/** `not_found` discriminator — the only not-found variants (FR-015a). */
export type NotFoundResource = 'node' | 'repo' | 'route';

/**
 * Whitelisted detail fields only. Never carries raw exception text, absolute
 * filesystem paths, stack traces, or cause chains (FR-015a). Anything outside
 * these keys is dropped by the builder before serialization.
 */
export interface ErrorDetails {
  /** For `not_found`: which resource kind was not found. */
  resource?: NotFoundResource;
  /** For `invalid_request`: the offending query/path parameter name. */
  param?: string;
  /** For `invalid_request`: the offending request header name (e.g. Host). */
  header?: string;
}

/** The uniform error envelope returned by every failing request (FR-015). */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetails;
  };
}

/**
 * An HTTP error response descriptor: the status, any error-specific headers
 * (e.g. `Retry-After` for 503), and the envelope body. Assignable to the
 * router's `HandlerResult`, so a handler may return one directly.
 */
export interface ApiError {
  status: number;
  headers: Record<string, string>;
  body: ErrorEnvelope;
}

/** Options for the envelope builder. */
export interface ApiErrorOptions {
  /** Override the generic default message. Ignored for `unauthorized`/`internal`. */
  message?: string;
  /** Whitelisted detail fields. Dropped for `unauthorized`/`internal`. */
  details?: ErrorDetails;
  /** Seconds for the `Retry-After` header (only honoured for `unavailable`). */
  retryAfterSeconds?: number;
}

/** code → HTTP status (FR-015a). */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  not_found: 404,
  conflict: 409,
  unavailable: 503,
  internal: 500,
};

/**
 * Generic, leak-free default message per code. Callers may override for the
 * client-facing codes; `unauthorized` and `internal` always use the default.
 */
const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  invalid_request: 'Invalid request.',
  unauthorized: 'Unauthorized.',
  not_found: 'Not found.',
  conflict: 'Conflict.',
  unavailable: 'Service temporarily unavailable.',
  internal: 'Internal server error.',
};

/** Default `Retry-After` seconds for a transient 503 (FR-015a). */
export const DEFAULT_RETRY_AFTER_SECONDS = 1;

/**
 * Codes whose body is forced generic and detail-free regardless of input:
 * 401 (enumeration prevention) and 500 (never leak a fault).
 */
function isGenericCode(code: ErrorCode): boolean {
  return code === 'unauthorized' || code === 'internal';
}

/**
 * Reduce arbitrary details to the whitelist. Even a caller that smuggles extra
 * keys through `any` cannot leak them — only `resource`/`param`/`header`
 * survive. Returns undefined when nothing whitelisted remains.
 */
function sanitizeDetails(details?: ErrorDetails): ErrorDetails | undefined {
  if (!details) return undefined;
  const out: ErrorDetails = {};
  if (details.resource !== undefined) out.resource = details.resource;
  if (details.param !== undefined) out.param = details.param;
  if (details.header !== undefined) out.header = details.header;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The single envelope builder (FR-015). Applies the code→status map, forces a
 * generic body for `unauthorized`/`internal`, whitelists `details`, and attaches
 * `Retry-After` for `unavailable`.
 */
export function apiError(code: ErrorCode, options?: ApiErrorOptions): ApiError {
  const generic = isGenericCode(code);

  const message = generic ? DEFAULT_MESSAGE[code] : options?.message ?? DEFAULT_MESSAGE[code];
  const details = generic ? undefined : sanitizeDetails(options?.details);

  const headers: Record<string, string> = {};
  if (code === 'unavailable') {
    headers['Retry-After'] = String(options?.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS);
  }

  const error: ErrorEnvelope['error'] = { code, message };
  if (details) error.details = details;

  return { status: ERROR_STATUS[code], headers, body: { error } };
}

/** 404 with a `resource` discriminator (FR-015a). */
export function notFound(resource: NotFoundResource): ApiError {
  return apiError('not_found', { details: { resource } });
}

/** 401 with a generic, identical body (enumeration prevention, FR-015a). */
export function unauthorized(): ApiError {
  return apiError('unauthorized');
}

/** 503 carrying a `Retry-After` (transient daemon attach/spawn failure, FR-015a). */
export function unavailable(retryAfterSeconds?: number): ApiError {
  return apiError('unavailable', { retryAfterSeconds });
}

/** 500 generic body — never leaks the underlying fault (FR-015a). */
export function internalError(): ApiError {
  return apiError('internal');
}
