import { BrowserRouter } from "react-router-dom"

import { AppRoutes } from "@/app/routes"
import { AppStateProvider } from "@/app/state"
import { AppShell } from "@/components/layout/AppShell"

export function App() {
  return (
    <BrowserRouter>
      <AppStateProvider>
        <AppShell>
          <AppRoutes />
        </AppShell>
      </AppStateProvider>
    </BrowserRouter>
  )
}

export default App
