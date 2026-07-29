import { describe, expect, it, vi } from "vitest"

import {
  mergeWorkerCapabilityReport,
  probeBrowserCapabilities,
  type CapabilityProbeEnvironment,
} from "../local-indexing/capabilities"
import {
  createWorkerRuntime,
  type WorkerResponse,
} from "../local-indexing/worker"
import { LocalRepositoryClient } from "../local-indexing/client"

function fullEnvironment(
  overrides: Partial<CapabilityProbeEnvironment> = {},
): CapabilityProbeEnvironment {
  return {
    secureContext: true,
    showDirectoryPicker: () => undefined,
    dataTransferItemPrototype: {
      getAsFileSystemHandle: () => undefined,
    },
    storage: {
      getDirectory: () => undefined,
      estimate: async () => ({ usage: 10, quota: 100 }),
      persisted: async () => true,
      persist: async () => true,
    },
    locks: {
      request: () => undefined,
    },
    moduleWorker: true,
    probeWasm: async () => "available",
    ...overrides,
  }
}

describe("browser-local capability probes", () => {
  it("reports the full path from independent live capabilities without browser-name inference", async () => {
    const report = await probeBrowserCapabilities(fullEnvironment())

    expect(report).toEqual({
      secureContext: true,
      folderPicker: "available",
      directoryDrop: "available",
      opfs: "available",
      webLocks: "available",
      moduleWorker: true,
      wasm: "available",
      storageEstimate: { usage: 10, quota: 100 },
      persistedStorage: "granted",
      tier: "full",
      guidance: [
        "Open a local folder to index it privately in this browser.",
      ],
    })
  })

  it("offers snapshot-only guidance without promising picker reconnect or refresh", async () => {
    const report = await probeBrowserCapabilities(
      fullEnvironment({ showDirectoryPicker: undefined }),
    )

    expect(report.folderPicker).toBe("missing")
    expect(report.directoryDrop).toBe("available")
    expect(report.tier).toBe("snapshot-only")
    expect(report.guidance).toEqual([
      "Folder selection and reconnect are unavailable.",
      "Import a directory snapshot; it will not reconnect or refresh automatically.",
    ])
  })

  it("keeps secure-context, drop, storage, lock, worker, and WASM failures distinct", async () => {
    const report = await probeBrowserCapabilities({
      ...fullEnvironment(),
      secureContext: false,
      permissionsPolicyAllowsPicker: false,
      dataTransferItemPrototype: { getAsFile: () => undefined },
      storage: {
        estimate: async () => ({ usage: 90, quota: 100 }),
        persisted: async () => false,
      },
      locks: undefined,
      moduleWorker: false,
      probeWasm: async () => "blocked-by-csp",
    })

    expect(report).toMatchObject({
      secureContext: false,
      folderPicker: "blocked-by-policy",
      directoryDrop: "partial",
      opfs: "missing",
      webLocks: "missing",
      moduleWorker: false,
      wasm: "blocked-by-csp",
      persistedStorage: "denied",
      tier: "unsupported",
    })
    expect(report.guidance).toEqual([
      "Use CodeGraph from HTTPS or localhost for browser-local indexing.",
      "This browser or site policy does not allow a same-origin module worker.",
      "The site's Content Security Policy blocks required WebAssembly.",
      "Origin-private file storage is unavailable.",
      "Exclusive browser repository locking is unavailable.",
      "Directory drop exposes files but not a usable directory snapshot.",
      "Browser-local indexing is unavailable; server repositories remain available.",
    ])
  })

  it("queries persistence status passively and never requests persistence", async () => {
    const persist = vi.fn(async () => true)
    const persisted = vi.fn(async () => false)

    const report = await probeBrowserCapabilities(
      fullEnvironment({
        storage: {
          getDirectory: () => undefined,
          estimate: async () => ({ usage: 95, quota: 100 }),
          persisted,
          persist,
        },
      }),
    )

    expect(persisted).toHaveBeenCalledOnce()
    expect(persist).not.toHaveBeenCalled()
    expect(report.opfs).toBe("quota-risk")
    expect(report.persistedStorage).toBe("denied")
    expect(report.tier).toBe("full")
  })

  it("normalizes probe failures without throwing or collapsing their states", async () => {
    const report = await probeBrowserCapabilities(
      fullEnvironment({
        storage: {
          getDirectory: () => undefined,
          estimate: async () => {
            throw new Error("blocked")
          },
          persisted: async () => {
            throw new Error("blocked")
          },
          persist: async () => true,
        },
        probeWasm: async () => {
          throw new Error("blocked")
        },
      }),
    )

    expect(report.storageEstimate).toBeUndefined()
    expect(report.persistedStorage).toBe("unknown")
    expect(report.wasm).toBe("blocked-by-csp")
    expect(report.tier).toBe("unsupported")
  })

  it("lets an actual worker boot refine storage, lock, and WASM policy results", async () => {
    const main = await probeBrowserCapabilities(fullEnvironment())
    const merged = mergeWorkerCapabilityReport(main, {
      moduleWorker: true,
      wasm: "blocked-by-csp",
      opfs: "available",
      webLocks: "available",
    })

    expect(merged.tier).toBe("unsupported")
    expect(merged.wasm).toBe("blocked-by-csp")
    expect(merged.guidance).toContain(
      "The site's Content Security Policy blocks required WebAssembly.",
    )
  })

  it("serves capability bootstrap results through protocol v1", async () => {
    const emitted: WorkerResponse[] = []
    const runtime = createWorkerRuntime({
      store: {
        publishGeneration: vi.fn(),
        close: vi.fn(),
      },
      loadGrammars: vi.fn(),
      releaseGrammars: vi.fn(),
      getCapabilities: async () => ({
        moduleWorker: true,
        wasm: "available",
        opfs: "available",
        webLocks: "available",
      }),
      emit: (message) => emitted.push(message),
      yieldControl: async () => undefined,
    })

    await runtime.handle({
      protocolVersion: 1,
      requestId: "capability-request",
      kind: "capabilities",
    })

    expect(emitted).toEqual([
      {
        protocolVersion: 1,
        requestId: "capability-request",
        type: "result",
        terminal: "complete",
        result: {
          moduleWorker: true,
          wasm: "available",
          opfs: "available",
          webLocks: "available",
        },
      },
    ])
  })

  it("combines main-thread feature probes with the actual worker bootstrap report", async () => {
    class CapabilityWorker extends EventTarget {
      readonly postMessage = vi.fn()

      respond(message: unknown) {
        this.dispatchEvent(new MessageEvent("message", { data: message }))
      }
    }
    const worker = new CapabilityWorker()
    const client = new LocalRepositoryClient(worker, {
      createId: () => "capability-request",
      capabilityEnvironment: fullEnvironment(),
    })

    const pending = client.getCapabilities()
    await vi.waitFor(() => {
      expect(worker.postMessage).toHaveBeenCalledWith({
        protocolVersion: 1,
        requestId: "capability-request",
        kind: "capabilities",
      })
    })
    worker.respond({
      protocolVersion: 1,
      requestId: "capability-request",
      type: "result",
      terminal: "complete",
      result: {
        moduleWorker: true,
        wasm: "available",
        opfs: "available",
        webLocks: "missing",
      },
    })

    await expect(pending).resolves.toMatchObject({
      folderPicker: "available",
      directoryDrop: "available",
      webLocks: "missing",
      tier: "unsupported",
    })
  })
})
