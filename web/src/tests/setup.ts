import * as domMatchers from "@testing-library/jest-dom/matchers"
import { expect } from "vitest"

// Bind the matchers to this workspace's Vitest instance. The monorepo also
// carries a different Vitest major at the root, so the convenience entry point
// can otherwise extend the wrong `expect` after dependency hoisting.
expect.extend(domMatchers)

class MemoryStorage implements Storage {
  readonly #entries = new Map<string, string>()

  get length() {
    return this.#entries.size
  }

  clear() {
    this.#entries.clear()
  }

  getItem(key: string) {
    return this.#entries.get(String(key)) ?? null
  }

  key(index: number) {
    return [...this.#entries.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.#entries.delete(String(key))
  }

  setItem(key: string, value: string) {
    this.#entries.set(String(key), String(value))
  }
}

Object.defineProperty(globalThis, "Storage", {
  value: MemoryStorage,
  configurable: true,
})
Object.defineProperty(globalThis, "localStorage", {
  value: new MemoryStorage(),
  configurable: true,
})

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
