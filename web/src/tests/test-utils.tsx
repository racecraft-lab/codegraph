import { render, type RenderOptions } from "@testing-library/react"
import type { ReactElement } from "react"

import App from "@/app/App"

export function renderApp(options?: RenderOptions) {
  return render(<App />, options)
}

export function renderWithProviders(element: ReactElement, options?: RenderOptions) {
  return render(element, options)
}
