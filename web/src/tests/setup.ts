import "@testing-library/jest-dom/vitest"

class MockEventSource extends EventTarget {
  readonly url: string

  constructor(url: string) {
    super()
    this.url = url
  }

  close() {}
}

Object.defineProperty(globalThis, "EventSource", {
  value: MockEventSource,
  writable: true,
})

Object.defineProperty(window, "matchMedia", {
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }),
  writable: true,
})
