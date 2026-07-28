export const EMBEDDING_PROFILE_STORAGE_KEY =
  "codegraph.embeddingProfiles.v1"

export type EmbeddingResumeStatus =
  | "idle"
  | "paused"
  | "failed"
  | "cancelled"
  | "complete"

export interface EmbeddingCoverage {
  embedded: number
  skipped: number
  lastFailureCode?: string
}

export interface EmbeddingResumeState {
  status: EmbeddingResumeStatus
  completedItems: number
  nextBatch: number
}

export interface EmbeddingProfile {
  repositoryId: string
  enabled: boolean
  consentGrantedAt?: string
  endpointOrigin: string
  model: string
  dimensions?: number
  graphGeneration?: number
  vectorGeneration?: number
  coverage: EmbeddingCoverage
  inputHashes: string[]
  resume?: EmbeddingResumeState
}

export interface EmbeddingProfileInput {
  repositoryId: string
  enabled: boolean
  consentGrantedAt?: string
  endpointUrl: string
  model: string
  dimensions?: number
  graphGeneration?: number
  vectorGeneration?: number
  coverage: EmbeddingCoverage
  inputHashes: string[]
  resume?: EmbeddingResumeState
}

export interface EmbeddingErrorEnvelope {
  code: string
  message: string
  retryable: boolean
  phase: "embedding"
  guidance: string
  endpointOrigin?: string
}

export type EmbeddingFailure =
  (
    | { kind: "network"; cause?: unknown }
    | { kind: "http"; status: number; providerBody?: unknown }
    | { kind: "model"; providerBody?: unknown }
    | { kind: "dimensions"; providerBody?: unknown }
    | { kind: "partial-response"; providerBody?: unknown }
    | { kind: "cancelled"; cause?: unknown }
    | { kind: "unavailable"; cause?: unknown }
  ) & { endpointUrl?: string }

export interface EmbeddingInputItem {
  nodeId: string
  inputHash: string
  text: string
}

export interface EmbeddingVectorResult {
  nodeId: string
  inputHash: string
  values: number[]
}

export interface EmbeddingBatchResult {
  model: string
  dimensions: number
  vectors: EmbeddingVectorResult[]
}

export interface EmbeddingVectorRow extends EmbeddingVectorResult {
  model: string
  dimensions: number
}

export interface EmbeddingOperationResume {
  graphGeneration: number
  model: string
  dimensions?: number
  completedItems: number
  inputHashes: string[]
}

export interface BrowserEmbeddingSymbol {
  nodeId: string
  kind: string
  name: string
  signature?: string
  docstring?: string
}

export interface EmbeddingSemanticState {
  status: "active" | "paused" | "stale" | "unavailable" | "complete"
  graphGeneration: number
  model: string
  dimensions?: number
  completedItems: number
  inputHashes: string[]
  failureCode?: string
}

type EmbeddingProfileStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>

const RESUME_STATUSES = new Set<EmbeddingResumeStatus>([
  "idle",
  "paused",
  "failed",
  "cancelled",
  "complete",
])

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined
}

function safeIdentifier(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value)
  ) {
    throw new TypeError(`${label} is invalid.`)
  }
  return value
}

function optionalPositiveInteger(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${label} must be a positive integer.`)
  }
  return value as number
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a nonnegative integer.`)
  }
  return value as number
}

function canonicalEndpoint(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("Embedding endpoint is invalid.")
  }
  const endpoint = new URL(value)
  endpoint.username = ""
  endpoint.password = ""
  endpoint.search = ""
  endpoint.hash = ""
  return `${endpoint.origin}${endpoint.pathname}`
}

const ENDPOINT_POLICY_ERROR: EmbeddingErrorEnvelope = {
  code: "network_blocked",
  message: "The embedding endpoint does not meet the secure transport policy.",
  retryable: false,
  phase: "embedding",
  guidance:
    "Choose a direct HTTPS endpoint without URL credentials, query parameters, or fragments.",
}

export class EmbeddingPolicyError extends Error {
  private readonly envelope: EmbeddingErrorEnvelope

  constructor(envelope: EmbeddingErrorEnvelope) {
    super(envelope.message)
    this.name = "EmbeddingPolicyError"
    this.envelope = { ...envelope }
  }

  toEnvelope(): EmbeddingErrorEnvelope {
    return { ...this.envelope }
  }
}

export class EmbeddingOperationError extends Error {
  private readonly envelope: EmbeddingErrorEnvelope

  constructor(envelope: EmbeddingErrorEnvelope) {
    super(envelope.message)
    this.name = "EmbeddingOperationError"
    this.envelope = { ...envelope }
  }

  toEnvelope(): EmbeddingErrorEnvelope {
    return { ...this.envelope }
  }
}

export function validateEmbeddingEndpoint(endpointUrl: string): string {
  try {
    const endpoint = new URL(endpointUrl)
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username !== "" ||
      endpoint.password !== "" ||
      endpoint.search !== "" ||
      endpoint.hash !== ""
    ) {
      throw new EmbeddingPolicyError(ENDPOINT_POLICY_ERROR)
    }
    return canonicalEndpoint(endpoint.href)
  } catch (error) {
    if (error instanceof EmbeddingPolicyError) throw error
    throw new EmbeddingPolicyError(ENDPOINT_POLICY_ERROR)
  }
}

function semanticStale(message: string, guidance: string): never {
  throw new EmbeddingOperationError({
    code: "semantic_stale",
    message,
    retryable: false,
    phase: "embedding",
    guidance,
  })
}

export function validateEmbeddingResume(
  resume: EmbeddingOperationResume | undefined,
  profile: {
    graphGeneration: number
    model: string
    dimensions?: number
  },
  items: readonly EmbeddingInputItem[],
): number {
  if (!resume) return 0
  if (
    resume.graphGeneration !== profile.graphGeneration ||
    resume.model !== profile.model ||
    resume.dimensions !== profile.dimensions ||
    !Number.isSafeInteger(resume.completedItems) ||
    resume.completedItems < 0 ||
    resume.completedItems > items.length ||
    resume.inputHashes.length !== resume.completedItems
  ) {
    return semanticStale(
      "The saved semantic resume state does not match the published graph.",
      "Restart semantic indexing for the current graph generation.",
    )
  }
  for (let index = 0; index < resume.completedItems; index += 1) {
    if (resume.inputHashes[index] !== items[index]?.inputHash) {
      return semanticStale(
        "The saved semantic inputs are stale.",
        "Restart semantic indexing for the current graph generation.",
      )
    }
  }
  return resume.completedItems
}

export function validateEmbeddingBatch(
  items: readonly EmbeddingInputItem[],
  result: EmbeddingBatchResult,
  profile: { model: string; dimensions?: number },
): EmbeddingVectorRow[] {
  if (result.model !== profile.model) {
    throw new EmbeddingOperationError(
      mapEmbeddingFailure({ kind: "model" }),
    )
  }
  const dimensions = profile.dimensions ?? result.dimensions
  if (
    !Number.isSafeInteger(result.dimensions) ||
    result.dimensions <= 0 ||
    result.dimensions !== dimensions
  ) {
    throw new EmbeddingOperationError(
      mapEmbeddingFailure({ kind: "dimensions" }),
    )
  }
  if (result.vectors.length !== items.length) {
    throw new EmbeddingOperationError(
      mapEmbeddingFailure({ kind: "partial-response" }),
    )
  }
  return items.map((item, index) => {
    const vector = result.vectors[index]
    if (
      !vector ||
      vector.nodeId !== item.nodeId ||
      vector.inputHash !== item.inputHash
    ) {
      throw new EmbeddingOperationError(
        mapEmbeddingFailure({ kind: "partial-response" }),
      )
    }
    if (
      vector.values.length !== dimensions ||
      vector.values.some((value) => !Number.isFinite(value))
    ) {
      throw new EmbeddingOperationError(
        mapEmbeddingFailure({ kind: "dimensions" }),
      )
    }
    return {
      ...vector,
      values: [...vector.values],
      model: result.model,
      dimensions,
    }
  })
}

export function composeBrowserEmbeddingInput(
  symbol: BrowserEmbeddingSymbol,
): string {
  const normalize = (value: string) => value.replace(/\r\n?/g, "\n")
  const lines = [
    `kind: ${normalize(symbol.kind)}`,
    `name: ${normalize(symbol.name)}`,
  ]
  if (symbol.signature !== undefined) {
    lines.push(`signature: ${normalize(symbol.signature)}`)
  }
  if (symbol.docstring !== undefined) {
    lines.push(`doc: ${normalize(symbol.docstring)}`)
  }
  return lines.join("\n")
}

export async function hashEmbeddingInput(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input.replace(/\r\n?/g, "\n"))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

export async function requestEmbeddingBatch(request: {
  endpointUrl: string
  model: string
  credential: string
  items: EmbeddingInputItem[]
}): Promise<EmbeddingBatchResult> {
  const endpointUrl = validateEmbeddingEndpoint(request.endpointUrl)
  let response: Response
  try {
    response = await fetch(endpointUrl, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${request.credential}`,
      },
      body: JSON.stringify({
        model: request.model,
        input: request.items.map((item) => item.text),
      }),
    })
  } catch {
    throw new EmbeddingOperationError(
      mapEmbeddingFailure({ kind: "network", endpointUrl }),
    )
  }
  if (!response.ok) {
    await response.text().catch(() => undefined)
    throw new EmbeddingOperationError(
      mapEmbeddingFailure({
        kind: "http",
        status: response.status,
        endpointUrl,
      }),
    )
  }
  let candidate: unknown
  try {
    candidate = JSON.parse(await response.text()) as unknown
  } catch {
    throw new EmbeddingOperationError(
      mapEmbeddingFailure({ kind: "partial-response", endpointUrl }),
    )
  }
  const body = record(candidate)
  const data = Array.isArray(body?.data) ? body.data : []
  const vectors = request.items.map((item, index) => {
    const entry = data.find(
      (value) => record(value)?.index === index,
    )
    const values = record(entry)?.embedding
    return {
      nodeId: item.nodeId,
      inputHash: item.inputHash,
      values: Array.isArray(values)
        ? values.filter((value): value is number => typeof value === "number")
        : [],
    }
  })
  return {
    model: typeof body?.model === "string" ? body.model : "",
    dimensions: vectors[0]?.values.length ?? 0,
    vectors,
  }
}

function optionalTimestamp(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") {
    throw new TypeError("Embedding consent time is invalid.")
  }
  const timestamp = new Date(value)
  if (!Number.isFinite(timestamp.getTime())) {
    throw new TypeError("Embedding consent time is invalid.")
  }
  return timestamp.toISOString()
}

function coverage(value: unknown): EmbeddingCoverage {
  const candidate = record(value)
  if (!candidate) throw new TypeError("Embedding coverage is invalid.")
  const lastFailureCode =
    candidate.lastFailureCode === undefined
      ? undefined
      : safeIdentifier(candidate.lastFailureCode, "Embedding failure code")
  return {
    embedded: nonnegativeInteger(
      candidate.embedded,
      "Embedded coverage count",
    ),
    skipped: nonnegativeInteger(candidate.skipped, "Skipped coverage count"),
    ...(lastFailureCode ? { lastFailureCode } : {}),
  }
}

function inputHashes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Embedding input hashes are invalid.")
  }
  return value.map((hash) => safeIdentifier(hash, "Embedding input hash"))
}

function resumeState(value: unknown): EmbeddingResumeState | undefined {
  if (value === undefined) return undefined
  const candidate = record(value)
  if (
    !candidate ||
    typeof candidate.status !== "string" ||
    !RESUME_STATUSES.has(candidate.status as EmbeddingResumeStatus)
  ) {
    throw new TypeError("Embedding resume state is invalid.")
  }
  return {
    status: candidate.status as EmbeddingResumeStatus,
    completedItems: nonnegativeInteger(
      candidate.completedItems,
      "Completed embedding item count",
    ),
    nextBatch: nonnegativeInteger(
      candidate.nextBatch,
      "Next embedding batch",
    ),
  }
}

function projectProfile(value: unknown): EmbeddingProfile {
  const candidate = record(value)
  if (!candidate) throw new TypeError("Embedding profile is invalid.")
  if (typeof candidate.enabled !== "boolean") {
    throw new TypeError("Embedding consent state is invalid.")
  }
  const endpointOrigin =
    candidate.endpointUrl === undefined
      ? canonicalEndpoint(candidate.endpointOrigin)
      : validateEmbeddingEndpoint(candidate.endpointUrl as string)
  const resume = resumeState(candidate.resume)
  const dimensions = optionalPositiveInteger(
    candidate.dimensions,
    "Embedding dimensions",
  )
  const graphGeneration = optionalPositiveInteger(
    candidate.graphGeneration,
    "Graph generation",
  )
  const vectorGeneration = optionalPositiveInteger(
    candidate.vectorGeneration,
    "Vector generation",
  )
  const consentGrantedAt = optionalTimestamp(candidate.consentGrantedAt)
  return {
    repositoryId: safeIdentifier(candidate.repositoryId, "Repository id"),
    enabled: candidate.enabled,
    ...(consentGrantedAt ? { consentGrantedAt } : {}),
    endpointOrigin,
    model: safeIdentifier(candidate.model, "Embedding model"),
    ...(dimensions ? { dimensions } : {}),
    ...(graphGeneration ? { graphGeneration } : {}),
    ...(vectorGeneration ? { vectorGeneration } : {}),
    coverage: coverage(candidate.coverage),
    inputHashes: inputHashes(candidate.inputHashes),
    ...(resume ? { resume } : {}),
  }
}

export function serializeEmbeddingProfiles(
  profiles: readonly EmbeddingProfile[],
): string {
  return JSON.stringify(profiles.map((profile) => projectProfile(profile)))
}

export class EmbeddingProfileStore {
  private readonly storage?: EmbeddingProfileStorage

  constructor(
    storage: EmbeddingProfileStorage | undefined =
      typeof localStorage === "undefined" ? undefined : localStorage,
  ) {
    this.storage = storage
  }

  list(): EmbeddingProfile[] {
    if (!this.storage) return []
    try {
      const parsed = JSON.parse(
        this.storage.getItem(EMBEDDING_PROFILE_STORAGE_KEY) ?? "[]",
      ) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed.flatMap((candidate) => {
        try {
          return [projectProfile(candidate)]
        } catch {
          return []
        }
      })
    } catch {
      return []
    }
  }

  get(repositoryId: string): EmbeddingProfile | undefined {
    return this.list().find((profile) => profile.repositoryId === repositoryId)
  }

  save(input: EmbeddingProfileInput): EmbeddingProfile {
    const profile = projectProfile(input)
    if (!this.storage) return profile
    const profiles = this.list().filter(
      (candidate) => candidate.repositoryId !== profile.repositoryId,
    )
    this.storage.setItem(
      EMBEDDING_PROFILE_STORAGE_KEY,
      serializeEmbeddingProfiles([...profiles, profile]),
    )
    return profile
  }

  delete(repositoryId: string): void {
    if (!this.storage) return
    const profiles = this.list().filter(
      (profile) => profile.repositoryId !== repositoryId,
    )
    if (profiles.length === 0) {
      this.storage.removeItem(EMBEDDING_PROFILE_STORAGE_KEY)
      return
    }
    this.storage.setItem(
      EMBEDDING_PROFILE_STORAGE_KEY,
      serializeEmbeddingProfiles(profiles),
    )
  }
}

export class MemoryOnlyEmbeddingCredentials {
  private readonly credentials = new Map<string, string>()

  set(repositoryId: string, bearerToken: string): void {
    const id = safeIdentifier(repositoryId, "Repository id")
    if (typeof bearerToken !== "string" || bearerToken.trim().length === 0) {
      throw new TypeError("Embedding credential is required.")
    }
    this.credentials.set(id, bearerToken)
  }

  get(repositoryId: string): string | undefined {
    return this.credentials.get(repositoryId)
  }

  clear(repositoryId: string): void {
    this.credentials.delete(repositoryId)
  }

  clearAll(): void {
    this.credentials.clear()
  }
}

export interface SafeEmbeddingDiagnostic {
  code: string
  endpointOrigin: string
}

function embeddingEnvelope(
  code: string,
  message: string,
  retryable: boolean,
  guidance: string,
  endpointUrl?: string,
): EmbeddingErrorEnvelope {
  let endpointOrigin: string | undefined
  try {
    endpointOrigin =
      endpointUrl === undefined ? undefined : canonicalEndpoint(endpointUrl)
  } catch {
    endpointOrigin = undefined
  }
  return {
    code,
    message,
    retryable,
    phase: "embedding",
    guidance,
    ...(endpointOrigin ? { endpointOrigin } : {}),
  }
}

export function mapEmbeddingFailure(
  failure: EmbeddingFailure,
): EmbeddingErrorEnvelope {
  switch (failure.kind) {
    case "network":
      return embeddingEnvelope(
        "network_blocked",
        "The browser blocked the embedding endpoint request.",
        true,
        "Check endpoint availability, TLS, CORS, and site policy, then retry securely.",
        failure.endpointUrl,
      )
    case "http":
      if (failure.status === 401 || failure.status === 403) {
        return embeddingEnvelope(
          "credential_required",
          "The embedding endpoint rejected the session credential.",
          false,
          "Re-enter a valid credential for this page session.",
          failure.endpointUrl,
        )
      }
      if (
        failure.status === 408 ||
        failure.status === 425 ||
        failure.status === 429 ||
        failure.status >= 500
      ) {
        return embeddingEnvelope(
          "provider_unavailable",
          "The embedding endpoint is temporarily unavailable.",
          true,
          "Retry later; keyword search remains available.",
          failure.endpointUrl,
        )
      }
      return embeddingEnvelope(
        "provider_rejected",
        "The embedding endpoint rejected the request.",
        false,
        "Review the endpoint model configuration.",
        failure.endpointUrl,
      )
    case "model":
      return embeddingEnvelope(
        "model_mismatch",
        "The embedding response model does not match the profile.",
        false,
        "Select the configured model and rebuild semantic vectors.",
        failure.endpointUrl,
      )
    case "dimensions":
      return embeddingEnvelope(
        "dimension_mismatch",
        "The embedding dimensions do not match the profile.",
        false,
        "Correct the expected dimensions and rebuild semantic vectors.",
        failure.endpointUrl,
      )
    case "partial-response":
      return embeddingEnvelope(
        "partial_response",
        "The embedding endpoint returned an incomplete batch.",
        true,
        "Retry the incomplete batch; keyword search remains available.",
        failure.endpointUrl,
      )
    case "cancelled":
      return embeddingEnvelope(
        "operation_cancelled",
        "The semantic indexing operation was cancelled.",
        false,
        "Resume semantic indexing when ready.",
        failure.endpointUrl,
      )
    case "unavailable":
      return embeddingEnvelope(
        "provider_unavailable",
        "The embedding endpoint is unavailable.",
        true,
        "Retry later; keyword search remains available.",
        failure.endpointUrl,
      )
  }
}

export function safeEmbeddingDiagnostic(
  code: string,
  endpointUrl: string,
  rawCause?: unknown,
): SafeEmbeddingDiagnostic {
  void rawCause
  return {
    code: safeIdentifier(code, "Embedding diagnostic code"),
    endpointOrigin: canonicalEndpoint(endpointUrl),
  }
}
