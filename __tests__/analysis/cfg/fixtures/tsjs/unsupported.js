// cfg-case: unsupported
export async function* unsupportedStream(values) {
  for (const value of values) {
    yield await Promise.resolve(value);
  }
}
