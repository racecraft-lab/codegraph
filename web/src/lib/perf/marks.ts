export interface PerformanceThreshold {
  name: string
  limitMs: number
}

export function mark(name: string): void {
  performance.mark(name)
}

export function measure(name: string, start: string, end: string): number | null {
  try {
    performance.measure(name, start, end)
    const entry = performance.getEntriesByName(name).at(-1)
    return entry?.duration ?? null
  } catch {
    return null
  }
}

export function exceedsThreshold(durationMs: number | null, threshold: PerformanceThreshold): boolean {
  return durationMs !== null && durationMs > threshold.limitMs
}
