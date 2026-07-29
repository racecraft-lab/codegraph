export type FolderPickerCapability =
  | "available"
  | "missing"
  | "blocked-by-policy"
export type DirectoryDropCapability = "available" | "missing" | "partial"
export type OpfsCapability = "available" | "missing" | "quota-risk"
export type WebLockCapability = "available" | "missing"
export type WasmCapability = "available" | "blocked-by-csp" | "missing"
export type PersistedStorageCapability =
  | "granted"
  | "denied"
  | "unknown"
  | "not-supported"
export type LocalIndexingTier = "full" | "snapshot-only" | "unsupported"

export interface CapabilityStorageEstimate {
  usage?: number
  quota?: number
}

export interface BrowserCapabilityReport {
  secureContext: boolean
  folderPicker: FolderPickerCapability
  directoryDrop: DirectoryDropCapability
  opfs: OpfsCapability
  webLocks: WebLockCapability
  moduleWorker: boolean
  wasm: WasmCapability
  storageEstimate?: CapabilityStorageEstimate
  persistedStorage: PersistedStorageCapability
  tier: LocalIndexingTier
  guidance: string[]
}

export interface WorkerRuntimeCapabilityReport {
  moduleWorker: boolean
  wasm: WasmCapability
  opfs: OpfsCapability
  webLocks: WebLockCapability
}

interface DropEntryPrototype {
  getAsFileSystemHandle?: unknown
  webkitGetAsEntry?: unknown
  getAsFile?: unknown
}

interface StorageProbe {
  getDirectory?: unknown
  estimate?: () => Promise<{ usage?: number; quota?: number }>
  persisted?: () => Promise<boolean>
  persist?: unknown
}

interface LockProbe {
  request?: unknown
}

export interface CapabilityProbeEnvironment {
  secureContext: boolean
  showDirectoryPicker?: unknown
  permissionsPolicyAllowsPicker?: boolean
  dataTransferItemPrototype?: DropEntryPrototype
  storage?: StorageProbe
  locks?: LockProbe
  moduleWorker: boolean
  probeWasm: () => Promise<WasmCapability>
}

const MINIMAL_WASM_MODULE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
])
const QUOTA_RISK_RATIO = 0.9

function isFunction(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === "function"
}

function detectFolderPicker(
  environment: CapabilityProbeEnvironment,
): FolderPickerCapability {
  if (!isFunction(environment.showDirectoryPicker)) return "missing"
  if (
    !environment.secureContext ||
    environment.permissionsPolicyAllowsPicker === false
  ) {
    return "blocked-by-policy"
  }
  return "available"
}

function detectDirectoryDrop(
  prototype: DropEntryPrototype | undefined,
): DirectoryDropCapability {
  if (
    isFunction(prototype?.getAsFileSystemHandle) ||
    isFunction(prototype?.webkitGetAsEntry)
  ) {
    return "available"
  }
  return prototype && isFunction(prototype.getAsFile) ? "partial" : "missing"
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined
}

async function readStorageEstimate(
  storage: StorageProbe | undefined,
): Promise<CapabilityStorageEstimate | undefined> {
  if (!isFunction(storage?.estimate)) return undefined
  try {
    const estimate = await storage.estimate()
    const usage = finiteNonNegative(estimate.usage)
    const quota = finiteNonNegative(estimate.quota)
    return usage === undefined && quota === undefined
      ? undefined
      : {
          ...(usage === undefined ? {} : { usage }),
          ...(quota === undefined ? {} : { quota }),
        }
  } catch {
    return undefined
  }
}

async function readPersistenceStatus(
  storage: StorageProbe | undefined,
): Promise<PersistedStorageCapability> {
  if (!isFunction(storage?.persisted)) {
    return isFunction(storage?.persist) ? "unknown" : "not-supported"
  }
  try {
    return (await storage.persisted()) ? "granted" : "denied"
  } catch {
    return "unknown"
  }
}

function deriveTier(
  report: Omit<BrowserCapabilityReport, "tier" | "guidance">,
): LocalIndexingTier {
  const durableRuntime =
    report.secureContext &&
    report.opfs !== "missing" &&
    report.webLocks === "available" &&
    report.moduleWorker &&
    report.wasm === "available"
  if (!durableRuntime) return "unsupported"
  if (report.folderPicker === "available") return "full"
  if (report.directoryDrop === "available") return "snapshot-only"
  return "unsupported"
}

function deriveGuidance(
  report: Omit<BrowserCapabilityReport, "guidance">,
): string[] {
  if (report.tier === "full") {
    const guidance = [
      "Open a local folder to index it privately in this browser.",
    ]
    if (report.opfs === "quota-risk") {
      guidance.push("Browser storage is close to its reported quota.")
    }
    if (report.persistedStorage === "denied") {
      guidance.push(
        "Persistent storage is not granted, so site-data eviction may remove the local index.",
      )
    }
    return guidance
  }
  if (report.tier === "snapshot-only") {
    return [
      "Folder selection and reconnect are unavailable.",
      "Import a directory snapshot; it will not reconnect or refresh automatically.",
    ]
  }

  const guidance: string[] = []
  if (!report.secureContext) {
    guidance.push(
      "Use CodeGraph from HTTPS or localhost for browser-local indexing.",
    )
  }
  if (!report.moduleWorker) {
    guidance.push(
      "This browser or site policy does not allow a same-origin module worker.",
    )
  }
  if (report.wasm === "blocked-by-csp") {
    guidance.push(
      "The site's Content Security Policy blocks required WebAssembly.",
    )
  } else if (report.wasm === "missing") {
    guidance.push("This browser does not provide required WebAssembly support.")
  }
  if (report.opfs === "missing") {
    guidance.push("Origin-private file storage is unavailable.")
  }
  if (report.webLocks === "missing") {
    guidance.push("Exclusive browser repository locking is unavailable.")
  }
  if (report.directoryDrop === "partial") {
    guidance.push(
      "Directory drop exposes files but not a usable directory snapshot.",
    )
  } else if (
    report.directoryDrop === "missing" &&
    report.folderPicker !== "available"
  ) {
    guidance.push("Directory snapshot import is unavailable.")
  }
  if (
    report.secureContext &&
    report.folderPicker === "blocked-by-policy"
  ) {
    guidance.push("Site policy blocks local folder selection.")
  }
  guidance.push(
    "Browser-local indexing is unavailable; server repositories remain available.",
  )
  return guidance
}

export async function probeBrowserCapabilities(
  environment: CapabilityProbeEnvironment = createLiveCapabilityEnvironment(),
): Promise<BrowserCapabilityReport> {
  const storageEstimate = await readStorageEstimate(environment.storage)
  const hasOpfs = isFunction(environment.storage?.getDirectory)
  const quotaRisk =
    hasOpfs &&
    storageEstimate?.usage !== undefined &&
    storageEstimate.quota !== undefined &&
    storageEstimate.quota > 0 &&
    storageEstimate.usage / storageEstimate.quota >= QUOTA_RISK_RATIO
  let wasm: WasmCapability
  try {
    wasm = await environment.probeWasm()
  } catch {
    wasm = "blocked-by-csp"
  }

  const base = {
    secureContext: environment.secureContext,
    folderPicker: detectFolderPicker(environment),
    directoryDrop: detectDirectoryDrop(
      environment.dataTransferItemPrototype,
    ),
    opfs: hasOpfs
      ? quotaRisk
        ? ("quota-risk" as const)
        : ("available" as const)
      : ("missing" as const),
    webLocks: isFunction(environment.locks?.request)
      ? ("available" as const)
      : ("missing" as const),
    moduleWorker: environment.moduleWorker,
    wasm,
    ...(storageEstimate ? { storageEstimate } : {}),
    persistedStorage: await readPersistenceStatus(environment.storage),
  }
  const withTier = { ...base, tier: deriveTier(base) }
  return { ...withTier, guidance: deriveGuidance(withTier) }
}

export function mergeWorkerCapabilityReport(
  browser: BrowserCapabilityReport,
  worker: WorkerRuntimeCapabilityReport,
): BrowserCapabilityReport {
  const base = {
    secureContext: browser.secureContext,
    folderPicker: browser.folderPicker,
    directoryDrop: browser.directoryDrop,
    opfs: worker.opfs,
    webLocks: worker.webLocks,
    moduleWorker: worker.moduleWorker,
    wasm: worker.wasm,
    ...(browser.storageEstimate
      ? { storageEstimate: browser.storageEstimate }
      : {}),
    persistedStorage: browser.persistedStorage,
  }
  const withTier = { ...base, tier: deriveTier(base) }
  return { ...withTier, guidance: deriveGuidance(withTier) }
}

export async function probeWorkerRuntimeCapabilities(
  environment: CapabilityProbeEnvironment = createLiveCapabilityEnvironment(),
): Promise<WorkerRuntimeCapabilityReport> {
  const report = await probeBrowserCapabilities({
    ...environment,
    // Reaching this function proves that the packaged module worker booted
    // under the active worker-src policy.
    moduleWorker: true,
  })
  return {
    moduleWorker: true,
    wasm: report.wasm,
    opfs: report.opfs,
    webLocks: report.webLocks,
  }
}

export function createLiveCapabilityEnvironment(
  scope: typeof globalThis = globalThis,
): CapabilityProbeEnvironment {
  const browserScope = scope as typeof globalThis & {
    isSecureContext?: boolean
    showDirectoryPicker?: unknown
    DataTransferItem?: { prototype?: DropEntryPrototype }
    Worker?: unknown
    navigator?: {
      storage?: StorageProbe
      locks?: LockProbe
    }
    WebAssembly?: {
      compile?: (bytes: BufferSource) => Promise<unknown>
    }
  }
  const wasm = browserScope.WebAssembly
  return {
    secureContext: browserScope.isSecureContext === true,
    showDirectoryPicker: browserScope.showDirectoryPicker,
    dataTransferItemPrototype: browserScope.DataTransferItem?.prototype,
    storage: browserScope.navigator?.storage,
    locks: browserScope.navigator?.locks,
    moduleWorker: isFunction(browserScope.Worker),
    probeWasm: async () => {
      if (!isFunction(wasm?.compile)) return "missing"
      try {
        await wasm.compile(MINIMAL_WASM_MODULE)
        return "available"
      } catch {
        return "blocked-by-csp"
      }
    },
  }
}
