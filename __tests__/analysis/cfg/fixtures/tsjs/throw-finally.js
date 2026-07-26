// cfg-case: throw-finally
export function throwFinally(value) {
  let closed = false;

  try {
    if (value < 0) {
      throw new Error('negative value');
    }

    return value;
  } finally {
    closed = true;
    void closed;
  }
}
