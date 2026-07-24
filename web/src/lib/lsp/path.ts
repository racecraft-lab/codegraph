export function isWindowsRepositoryRoot(root: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(root) || root.startsWith("\\\\") || root.startsWith("//")
}
