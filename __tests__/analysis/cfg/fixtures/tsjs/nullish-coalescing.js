// cfg-case: nullish-coalescing
export function nullishCoalesce(config) {
  const retryCount = config.retryCount ?? 3;
  const timeoutMs = config.timeoutMs ?? 1000;

  return retryCount * timeoutMs;
}
