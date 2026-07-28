import { describe, expect, it, vi } from "vitest"

import {
  EMBEDDING_PROFILE_STORAGE_KEY,
  EmbeddingPolicyError,
  EmbeddingProfileStore,
  MemoryOnlyEmbeddingCredentials,
  mapEmbeddingFailure,
  safeEmbeddingDiagnostic,
  validateEmbeddingEndpoint,
  type EmbeddingFailure,
  type EmbeddingProfileInput,
} from "../local-indexing/embeddings"
import type { WorkerErrorPayload } from "../local-indexing/worker"

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key)
    }),
    value(key: string) {
      return values.get(key)
    },
  }
}

function profileInput(
  overrides: Partial<EmbeddingProfileInput> = {},
): EmbeddingProfileInput {
  return {
    repositoryId: "local-repository",
    enabled: true,
    consentGrantedAt: "2026-07-28T11:40:00.000Z",
    endpointUrl: "https://embeddings.example/v1/embed",
    model: "text-embedding-safe",
    dimensions: 768,
    graphGeneration: 4,
    vectorGeneration: 4,
    coverage: {
      embedded: 25,
      skipped: 2,
      lastFailureCode: "network_blocked",
    },
    inputHashes: ["sha256:a", "sha256:b"],
    resume: {
      status: "paused",
      completedItems: 25,
      nextBatch: 3,
    },
    ...overrides,
  }
}

describe("secret-free embedding state", () => {
  it("persists an explicit allowlist and removes URL secrets and raw input/provider material", () => {
    const storage = memoryStorage()
    const store = new EmbeddingProfileStore(storage)
    const unsafeInput = {
      ...profileInput(),
      apiKey: "persisted-api-key",
      authorization: "Bearer persisted-bearer",
      rawSource: "private source text",
      providerResponse: { error: "raw provider body" },
      rawCause: new Error("raw network cause"),
      untrustedUrl:
        "https://alice:password@elsewhere.example/path?api_key=query-secret#fragment-secret",
    } as EmbeddingProfileInput

    const profile = store.save(unsafeInput)
    const durable = storage.value(EMBEDDING_PROFILE_STORAGE_KEY) ?? ""

    expect(profile).toEqual({
      repositoryId: "local-repository",
      enabled: true,
      consentGrantedAt: "2026-07-28T11:40:00.000Z",
      endpointOrigin: "https://embeddings.example/v1/embed",
      model: "text-embedding-safe",
      dimensions: 768,
      graphGeneration: 4,
      vectorGeneration: 4,
      coverage: {
        embedded: 25,
        skipped: 2,
        lastFailureCode: "network_blocked",
      },
      inputHashes: ["sha256:a", "sha256:b"],
      resume: {
        status: "paused",
        completedItems: 25,
        nextBatch: 3,
      },
    })
    expect(JSON.parse(durable)).toEqual([profile])
    for (const forbidden of [
      "alice",
      "password",
      "api_key",
      "query-secret",
      "fragment-secret",
      "persisted-api-key",
      "persisted-bearer",
      "private source text",
      "raw provider body",
      "raw network cause",
    ]) {
      expect(durable).not.toContain(forbidden)
    }
  })

  it("keeps bearer credentials in one live memory object and requires re-entry after reload", () => {
    const storage = memoryStorage()
    const store = new EmbeddingProfileStore(storage)
    store.save(profileInput())
    const credentials = new MemoryOnlyEmbeddingCredentials()

    credentials.set("local-repository", "session-bearer-secret")

    expect(credentials.get("local-repository")).toBe("session-bearer-secret")
    expect(storage.value(EMBEDDING_PROFILE_STORAGE_KEY)).not.toContain(
      "session-bearer-secret",
    )
    expect(new MemoryOnlyEmbeddingCredentials().get("local-repository")).toBe(
      undefined,
    )
    credentials.clear("local-repository")
    expect(credentials.get("local-repository")).toBeUndefined()
  })

  it("projects loaded records through the same allowlist and deletes only the selected profile", () => {
    const storage = memoryStorage()
    storage.setItem(
      EMBEDDING_PROFILE_STORAGE_KEY,
      JSON.stringify([
        {
          ...profileInput(),
          endpointOrigin:
            "https://user:secret@embeddings.example/v1/embed?token=secret#secret",
          endpointUrl: undefined,
          authorization: "Bearer stored-secret",
          rawSource: "stored source",
        },
        {
          ...profileInput({ repositoryId: "other-repository" }),
          endpointOrigin: "https://other.example/embed",
          endpointUrl: undefined,
        },
        { repositoryId: 42, endpointOrigin: "not a URL" },
      ]),
    )
    const store = new EmbeddingProfileStore(storage)

    expect(store.get("local-repository")).toMatchObject({
      repositoryId: "local-repository",
      endpointOrigin: "https://embeddings.example/v1/embed",
    })
    expect(store.list()).toHaveLength(2)

    store.delete("local-repository")

    expect(store.get("local-repository")).toBeUndefined()
    expect(store.get("other-repository")).toBeDefined()
    const durable = storage.value(EMBEDDING_PROFILE_STORAGE_KEY) ?? ""
    expect(durable).not.toContain("stored-secret")
    expect(durable).not.toContain("stored source")
  })

  it("builds stable diagnostics without retaining URL secrets or raw provider causes", () => {
    const diagnostic = safeEmbeddingDiagnostic(
      "network_blocked",
      "https://user:password@example.test/v1/embed?token=secret#provider",
      new Error("provider said bearer-secret"),
    )

    expect(diagnostic).toEqual({
      code: "network_blocked",
      endpointOrigin: "https://example.test/v1/embed",
    })
    expect(JSON.stringify(diagnostic)).not.toContain("bearer-secret")
  })
})

describe("fail-closed embedding transport policy", () => {
  it.each([
    ["invalid URL", "not a URL"],
    ["insecure scheme", "http://embeddings.example/v1/embed"],
    ["mixed content", "http://localhost:8787/v1/embed"],
    [
      "URL credentials",
      "https://user:password@embeddings.example/v1/embed",
    ],
    ["query credential", "https://embeddings.example/v1/embed?token=secret"],
    ["fragment data", "https://embeddings.example/v1/embed#secret"],
  ])("rejects %s without an unsafe bypass", (_label, endpointUrl) => {
    let failure: unknown
    try {
      validateEmbeddingEndpoint(endpointUrl)
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(EmbeddingPolicyError)
    expect((failure as EmbeddingPolicyError).toEnvelope()).toEqual({
      code: "network_blocked",
      message:
        "The embedding endpoint does not meet the secure transport policy.",
      retryable: false,
      phase: "embedding",
      guidance:
        "Choose a direct HTTPS endpoint without URL credentials, query parameters, or fragments.",
    })
    const publicFailure = JSON.stringify(
      (failure as EmbeddingPolicyError).toEnvelope(),
    )
    expect(publicFailure).not.toContain(endpointUrl)
    expect(publicFailure).not.toMatch(/no-cors|proxy|override/i)
  })

  it("accepts only a direct canonical HTTPS endpoint", () => {
    expect(
      validateEmbeddingEndpoint("https://embeddings.example/v1/embed"),
    ).toBe("https://embeddings.example/v1/embed")
  })

  it.each<{
    failure: EmbeddingFailure
    expected: WorkerErrorPayload & { guidance: string }
  }>([
    {
      failure: {
        kind: "network",
        cause: new Error("TLS failure for bearer sentinel"),
        endpointUrl:
          "https://user:secret@embeddings.example/v1/embed?token=secret#secret",
      },
      expected: {
        code: "network_blocked",
        message: "The browser blocked the embedding endpoint request.",
        retryable: true,
        phase: "embedding",
        guidance:
          "Check endpoint availability, TLS, CORS, and site policy, then retry securely.",
        endpointOrigin: "https://embeddings.example/v1/embed",
      },
    },
    {
      failure: {
        kind: "http",
        status: 401,
        providerBody: "authorization sentinel",
      },
      expected: {
        code: "credential_required",
        message: "The embedding endpoint rejected the session credential.",
        retryable: false,
        phase: "embedding",
        guidance: "Re-enter a valid credential for this page session.",
      },
    },
    {
      failure: {
        kind: "http",
        status: 429,
        providerBody: "rate-limit provider sentinel",
      },
      expected: {
        code: "provider_unavailable",
        message: "The embedding endpoint is temporarily unavailable.",
        retryable: true,
        phase: "embedding",
        guidance: "Retry later; keyword search remains available.",
      },
    },
    {
      failure: {
        kind: "http",
        status: 422,
        providerBody: "validation provider sentinel",
      },
      expected: {
        code: "provider_rejected",
        message: "The embedding endpoint rejected the request.",
        retryable: false,
        phase: "embedding",
        guidance: "Review the endpoint model configuration.",
      },
    },
    {
      failure: {
        kind: "model",
        providerBody: "unexpected provider model sentinel",
      },
      expected: {
        code: "model_mismatch",
        message: "The embedding response model does not match the profile.",
        retryable: false,
        phase: "embedding",
        guidance: "Select the configured model and rebuild semantic vectors.",
      },
    },
    {
      failure: {
        kind: "dimensions",
        providerBody: "unexpected vector values sentinel",
      },
      expected: {
        code: "dimension_mismatch",
        message: "The embedding dimensions do not match the profile.",
        retryable: false,
        phase: "embedding",
        guidance:
          "Correct the expected dimensions and rebuild semantic vectors.",
      },
    },
    {
      failure: {
        kind: "partial-response",
        providerBody: "partial raw response sentinel",
      },
      expected: {
        code: "partial_response",
        message: "The embedding endpoint returned an incomplete batch.",
        retryable: true,
        phase: "embedding",
        guidance:
          "Retry the incomplete batch; keyword search remains available.",
      },
    },
    {
      failure: { kind: "cancelled", cause: "cancel raw cause sentinel" },
      expected: {
        code: "operation_cancelled",
        message: "The semantic indexing operation was cancelled.",
        retryable: false,
        phase: "embedding",
        guidance: "Resume semantic indexing when ready.",
      },
    },
    {
      failure: {
        kind: "unavailable",
        cause: "unavailable raw cause sentinel",
      },
      expected: {
        code: "provider_unavailable",
        message: "The embedding endpoint is unavailable.",
        retryable: true,
        phase: "embedding",
        guidance: "Retry later; keyword search remains available.",
      },
    },
  ])(
    "maps $failure.kind failures to redacted worker envelopes",
    ({ failure, expected }) => {
      const envelope: WorkerErrorPayload = mapEmbeddingFailure(failure)

      expect(envelope).toEqual(expected)
      const publicFailure = JSON.stringify(envelope)
      for (const forbidden of [
        "sentinel",
        "providerBody",
        "cause",
        "authorization",
        "bearer",
      ]) {
        expect(publicFailure).not.toContain(forbidden)
      }
    },
  )
})
