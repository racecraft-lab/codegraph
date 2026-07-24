/** Invoke an optional diagnostic sink without allowing observer failures to escape. */
export function reportDiagnostic<T>(sink: ((diagnostic: T) => void) | undefined, diagnostic: T): void {
  try { sink?.(diagnostic); } catch { /* diagnostics are best-effort */ }
}
