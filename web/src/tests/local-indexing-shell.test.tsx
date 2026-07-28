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
const refreshRepositories = vi.fn()
const reconnectLocalRepository = vi.fn()
const startSemanticIndexing = vi.fn()
const requestStoragePersistence = vi.fn()
const deleteLocalRepository = vi.fn()

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
  sourceKind: "dropped-snapshot" as const,
}

let appState: Record<string, unknown>

vi.mock("@/app/state", () => ({
  useAppState: () => appState,
}))

function renderShell(children: ReactNode) {
  return render(
    <MemoryRouter>
      <SidebarProvider>{children}</SidebarProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  openLocalFolder.mockReset()
  cancelLocalOperation.mockReset()
  refreshRepositories.mockReset()
  reconnectLocalRepository.mockReset()
  startSemanticIndexing.mockReset()
  requestStoragePersistence.mockReset()
  deleteLocalRepository.mockReset()
  appState = {
    repositories: [
      serverRepository,
      localFolderRepository,
      localSnapshotRepository,
    ],
    selectedRepo: serverRepository,
    repositoriesStatus: "success",
    repositoryState: "ready",
    repositoryStatus: undefined,
    selectRepository: vi.fn(),
    openLocalFolder,
    cancelLocalOperation,
    refreshRepositories,
    reconnectLocalRepository,
    startSemanticIndexing,
    requestStoragePersistence,
    deleteLocalRepository,
    storageStatus: undefined,
    localOperation: undefined,
  }
})

describe("browser-local workspace shell", () => {
  it("opens a folder only from the deliberate button and returns focus after picker dismissal", async () => {
    openLocalFolder.mockRejectedValueOnce(
      Object.assign(new Error("Folder selection was cancelled."), {
        name: "AbortError",
      })
    )
    renderShell(<RepositorySwitcher />)

    expect(openLocalFolder).not.toHaveBeenCalled()
    const openButton = screen.getByRole("button", { name: "Open local folder" })

    await userEvent.click(openButton)

    expect(openLocalFolder).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(openButton).toHaveFocus())
    expect(screen.getByText("Server")).toBeInTheDocument()
  })

  it("keeps the folder action keyboard reachable and restores its focus after success", async () => {
    openLocalFolder.mockResolvedValueOnce(undefined)
    renderShell(<RepositorySwitcher />)
    const user = userEvent.setup()
    const openButton = screen.getByRole("button", { name: "Open local folder" })

    openButton.focus()
    await user.keyboard("{Enter}")

    expect(openLocalFolder).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(openButton).toHaveFocus())
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
      "Reading files 2 of 4. Reading accepted source files."
    )
    expect(
      document.querySelector('[data-slot="progress-indicator"]')
    ).toHaveClass("motion-reduce:transition-none")
    expect(screen.getByRole("status")).toHaveClass(
      "motion-reduce:transition-none"
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Cancel local indexing" })
    )
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
      </MemoryRouter>
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Storage quota blocked. Browser storage quota blocked publication."
    )
  })

  it("keeps runtime trust labels in local page headers without exposing opaque roots", () => {
    appState = {
      ...appState,
      selectedRepo: localSnapshotRepository,
      repositoryState: "stale",
    }
    renderShell(<RepositoryOverview />)

    expect(
      screen.getByRole("heading", { name: "Repository overview" })
    ).toBeInTheDocument()
    expect(screen.getByText("Local snapshot")).toBeInTheDocument()
    expect(screen.getByText("Imported project")).toBeInTheDocument()
    expect(
      screen.queryByText("local://opaque-snapshot")
    ).not.toBeInTheDocument()
  })

  it("shows approximate storage status and requests persistence only from its button", async () => {
    appState = {
      ...appState,
      selectedRepo: localFolderRepository,
      storageStatus: {
        usageBytes: 1_048_576,
        quotaBytes: 4_194_304,
        persisted: "denied",
      },
      localOperation: {
        state: "quota-blocked",
        message: "Browser storage quota blocked publication.",
        cancellable: false,
      },
    }
    renderShell(<RepositoryOverview />)

    expect(screen.getByText("1 MB used of approximately 4 MB")).toBeVisible()
    expect(screen.getByText("Storage is not persistent.")).toBeVisible()
    expect(
      screen.getByText(
        "Free browser site storage, then retry. The previous complete local index remains available."
      )
    ).toBeVisible()
    expect(
      screen.getByText("CodeGraph never deletes local indexes automatically.")
    ).toBeVisible()
    expect(requestStoragePersistence).not.toHaveBeenCalled()

    await userEvent.click(
      screen.getByRole("button", { name: "Request persistent storage" })
    )
    expect(requestStoragePersistence).toHaveBeenCalledTimes(1)
  })

  it("keeps reconnect and semantic opt-in explicit, keyboard reachable, and secret-safe", async () => {
    reconnectLocalRepository.mockResolvedValueOnce(undefined)
    startSemanticIndexing.mockResolvedValueOnce(undefined)
    appState = {
      ...appState,
      selectedRepo: localFolderRepository,
      repositoryState: "ready",
      localSourceConnection: {
        repositoryId: localFolderRepository.id,
        handleRefId: "handle-local-folder",
        status: "prompt",
        canRefresh: false,
      },
    }
    renderShell(<RepositoryOverview />)
    const user = userEvent.setup()

    const reconnect = screen.getByRole("button", {
      name: "Reconnect local folder",
    })
    reconnect.focus()
    await user.keyboard("{Enter}")
    expect(reconnectLocalRepository).toHaveBeenCalledTimes(1)
    expect(reconnect).toHaveFocus()

    await user.type(
      screen.getByLabelText("Embedding endpoint"),
      "https://embeddings.example/v1/embed"
    )
    await user.type(screen.getByLabelText("Embedding model"), "safe-model")
    await user.type(
      screen.getByLabelText("Page-session bearer key"),
      "memory-only-key"
    )
    await user.click(
      screen.getByRole("checkbox", {
        name: /I consent to semantic indexing/,
      })
    )
    const semanticButton = screen.getByRole("button", {
      name: "Start semantic indexing",
    })
    semanticButton.focus()
    await user.keyboard("{Enter}")

    expect(startSemanticIndexing).toHaveBeenCalledWith({
      endpointUrl: "https://embeddings.example/v1/embed",
      model: "safe-model",
      credential: "memory-only-key",
    })
    expect(semanticButton).toHaveFocus()
    expect(
      screen.getByText(/bearer key remains only in this page session/i)
    ).toBeVisible()
  })

  it("requires the repository name and an explicit active-operation cancellation choice", async () => {
    appState = {
      ...appState,
      selectedRepo: localFolderRepository,
      localOperation: {
        state: "refreshing",
        message: "Refreshing Picked project.",
        phase: "parse",
        completed: 1,
        total: 2,
        cancellable: true,
      },
    }
    renderShell(<RepositoryOverview />)

    await userEvent.click(
      screen.getByRole("button", { name: "Delete browser index" })
    )
    expect(screen.getByRole("dialog")).toHaveTextContent("Local folder")
    expect(screen.getByRole("dialog")).toHaveTextContent("Picked project")
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Graph database, accepted source cache, repository metadata, saved folder handle, and semantic state"
    )
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Source folder files will not be changed"
    )

    const deleteButton = screen.getByRole("button", {
      name: "Delete browser data",
    })
    expect(deleteButton).toBeDisabled()
    await userEvent.type(
      screen.getByLabelText("Type Picked project to confirm"),
      "Picked project"
    )
    expect(deleteButton).toBeDisabled()
    await userEvent.click(
      screen.getByRole("checkbox", {
        name: "Cancel the active local operation and delete",
      })
    )
    expect(deleteButton).toBeEnabled()
    await userEvent.click(deleteButton)

    expect(deleteLocalRepository).toHaveBeenCalledWith({
      confirmationName: "Picked project",
      cancelActive: true,
    })
  })

  it("keeps local keyword actions enabled and explains unavailable server-only actions", () => {
    appState = {
      ...appState,
      selectedRepo: localFolderRepository,
      repositoryState: "ready",
    }
    renderShell(<RepositoryOverview />)

    expect(
      screen.getByRole("button", { name: "Search symbols" })
    ).toHaveAttribute("href", "/search")
    expect(
      screen.getByRole("button", { name: "Refresh local index" })
    ).toBeDisabled()
    expect(
      screen.getByText(
        "Local refresh requires a connected folder. Server re-analysis is unavailable for local repositories."
      )
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Ask with context" })
    ).toBeDisabled()
    expect(
      screen.getByText(
        "Chat is available only for server repositories. Local keyword browsing remains available."
      )
    ).toBeVisible()
  })

  it("preserves server navigation actions without local disabled-state copy", () => {
    renderShell(<RepositoryOverview />)

    expect(screen.getByRole("button", { name: "Re-analyze" })).toHaveAttribute(
      "href",
      "/reindex"
    )
    expect(
      screen.getByRole("button", { name: "Ask with context" })
    ).toHaveAttribute("href", "/chat")
    expect(
      screen.queryByText(/Server re-analysis is unavailable/)
    ).not.toBeInTheDocument()
  })

  it("blocks local reads while another tab owns the repository and offers retry or switch", async () => {
    appState = {
      ...appState,
      selectedRepo: localFolderRepository,
      repositoryState: "unavailable",
      localOperation: {
        state: "busy",
        message: "Picked project is open in another tab.",
        cancellable: false,
      },
    }
    const view = renderShell(<RepositorySwitcher />)

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Repository busy. Picked project is open in another tab."
    )
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(refreshRepositories).toHaveBeenCalledTimes(1)
    await userEvent.click(
      screen.getByRole("button", { name: "Switch repository" })
    )
    expect(appState.selectRepository).toHaveBeenCalledWith("server")

    view.rerender(
      <MemoryRouter>
        <SidebarProvider>
          <RepositoryOverview />
        </SidebarProvider>
      </MemoryRouter>
    )
    expect(screen.getByRole("button", { name: "Start search" })).toBeDisabled()
    expect(
      screen.getByText(
        "Local reads are disabled until this browser tab acquires the repository."
      )
    ).toBeVisible()
  })
})
