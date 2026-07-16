import type { ErrorEnvelope } from "./types"

export class ApiClientError extends Error {
  readonly status: number
  readonly envelope: ErrorEnvelope

  constructor(status: number, envelope: ErrorEnvelope) {
    super(envelope.error.message)
    this.name = "ApiClientError"
    this.status = status
    this.envelope = envelope
  }
}

function fallbackEnvelope(status: number): ErrorEnvelope {
  let code = "internal"
  let message = "The local CodeGraph server returned an unexpected response."

  if (status === 0) {
    message = "The local CodeGraph server is unreachable."
  } else if (status === 401) {
    code = "unauthorized"
    message = "The local CodeGraph server requires authentication."
  } else if (status === 503) {
    code = "unavailable"
    message = "The local CodeGraph server is temporarily unavailable."
  }

  return {
    error: {
      code,
      message,
    },
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T
  } catch {
    throw new ApiClientError(response.status, fallbackEnvelope(response.status))
  }
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Accept: "application/json",
        ...init?.headers,
      },
    })
  } catch {
    throw new ApiClientError(0, fallbackEnvelope(0))
  }

  if (!response.ok) {
    const envelope = await parseJson<ErrorEnvelope>(response).catch(() =>
      fallbackEnvelope(response.status)
    )
    throw new ApiClientError(response.status, envelope)
  }

  return parseJson<T>(response)
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiClientError(0, fallbackEnvelope(0))
  }

  if (!response.ok) {
    const envelope = await parseJson<ErrorEnvelope>(response).catch(() =>
      fallbackEnvelope(response.status)
    )
    throw new ApiClientError(response.status, envelope)
  }

  return parseJson<T>(response)
}

export function errorState(error: unknown): {
  code: string
  message: string
  status: number
} {
  if (error instanceof ApiClientError) {
    return {
      code: error.envelope.error.code,
      message: error.envelope.error.message,
      status: error.status,
    }
  }
  return { code: "internal", message: "Unexpected web UI error.", status: 0 }
}
