import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { SidebarProvider } from "@/components/ui/sidebar"
import { RepositorySwitcher } from "@/components/layout/RepositorySwitcher"
import { RepositoryOverview } from "@/routes/RepositoryOverview"

const openLocalFolder = vi.fn()
const cancelLocalOperation = vi.fn()

const serverRepository = {
  id: "server",
  root: "/private/server-root",
  name: "Server repository",
  default: true,
}

const localFolderRepository = {
  id: "local-folder",
  root: "local://opaque-folder",
  name: "Picked project",
  default: false,
  runtime: "local" as const,
  sourceKind: "picked-folder" as const,
}

const localSnapshotRepository = {
  id: "local-snapshot",
  root: "local://opaque-snapshot",
  name: "Imported project",
  default: false,
  runtime: "local" as const,
  sourceKind: "snapshot" as const,
}

let appState: Record<string, unknown>

vi.mock("@/app/state", () => ({
  useAppState: () => appState,
}))

function renderShell(children: ReactNode) {
  return render(
    <MemoryRouter>
      <SidebarProvider>{children}</SidebarProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  openLocalFolder.mockReset()
  cancelLocalOperation.mockReset()
  appState = {
    repositories: [serverRepository, localFolderRepository, localSnapshotRepository],
    selectedRepo: serverRepository,
    repositoriesStatus: "success",
    repositoryState: "ready",
    repositoryStatus: undefined,
    selectRepository: vi.fn(),
    openLocalFolder,
    cancelLocalOperation,
    localOperation: undefined,
  }
})

describe("browser-local workspace shell", () => {
  it("opens a folder only from the deliberate button and returns focus after picker dismissal", async () => {
    openLocalFolder.mockRejectedValueOnce(
      Object.assign(new Error("Folder selection was cancelled."), {
        name: "AbortError",
      }),
    )
    renderShell(<RepositorySwitcher />)

    expect(openLocalFolder).not.toHaveBeenCalled()
    const openButton = screen.getByRole("button", { name: "Open local folder" })

    await userEvent.click(openButton)

    expect(openLocalFolder).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(openButton).toHaveFocus())
    expect(screen.getByText("Server")).toBeInTheDocument()
  })

  it("announces cancellable progress and terminal local-indexing states", async () => {
    appState = {
      ...appState,
      selectedRepo: localFolderRepository,
      localOperation: {
        state: "refreshing",
        message: "Reading accepted source files.",
        phase: "Reading files",
        completed: 2,
        total: 4,
        cancellable: true,
      },
    }
    const view = renderShell(<RepositorySwitcher />)

    expect(screen.getByText("Local folder")).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent(
      "Reading files 2 of 4. Reading accepted source files.",
    )
    await userEvent.click(screen.getByRole("button", { name: "Cancel local indexing" }))
    expect(cancelLocalOperation).toHaveBeenCalledTimes(1)

    appState = {
      ...appState,
      localOperation: {
        state: "quota-blocked",
        message: "Browser storage quota blocked publication.",
        cancellable: false,
      },
    }
    view.rerender(
      <MemoryRouter>
        <SidebarProvider>
          <RepositorySwitcher />
        </SidebarProvider>
      </MemoryRouter>,
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Storage quota blocked. Browser storage quota blocked publication.",
    )
  })

  it("keeps runtime trust labels in local page headers without exposing opaque roots", () => {
    appState = {
      ...appState,
      selectedRepo: localSnapshotRepository,
      repositoryState: "stale",
    }
    renderShell(<RepositoryOverview />)

    expect(screen.getByRole("heading", { name: "Repository overview" })).toBeInTheDocument()
    expect(screen.getByText("Local snapshot")).toBeInTheDocument()
    expect(screen.getByText("Imported project")).toBeInTheDocument()
    expect(screen.queryByText("local://opaque-snapshot")).not.toBeInTheDocument()
  })
})
