import * as React from "react"

import { errorState } from "@/lib/api/client"
import { classifyRepositoryStatus, getRepositoryStatus, listRepositories } from "@/lib/api/repositories"
import type { AsyncStatus, CodeNode, Repository, RepositoryState, RepositoryStatus } from "@/lib/api/types"

interface AppStateValue {
  repositories: Repository[]
  repositoriesStatus: AsyncStatus
  selectedRepo?: Repository
  repositoryStatus?: RepositoryStatus
  repositoryState: RepositoryState
  statusMessage: string
  selectedNode?: CodeNode
  selectRepository: (repoId: string) => void
  selectNode: (node: CodeNode) => void
  clearNode: () => void
  refreshRepositories: () => Promise<void>
  refreshStatus: () => Promise<void>
}

const AppStateContext = React.createContext<AppStateValue | null>(null)

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [repositories, setRepositories] = React.useState<Repository[]>([])
  const [repositoriesStatus, setRepositoriesStatus] = React.useState<AsyncStatus>("idle")
  const [selectedRepoId, setSelectedRepoId] = React.useState<string | undefined>()
  const [repositoryStatus, setRepositoryStatus] = React.useState<RepositoryStatus | undefined>()
  const [repositoryState, setRepositoryState] = React.useState<RepositoryState>("missing")
  const [statusMessage, setStatusMessage] = React.useState("Loading repository state.")
  const [selectedNode, setSelectedNode] = React.useState<CodeNode | undefined>()
  const statusRequestRef = React.useRef(0)

  const selectedRepo = React.useMemo(
    () => repositories.find((repo) => repo.id === selectedRepoId) ?? repositories.find((repo) => repo.default) ?? repositories[0],
    [repositories, selectedRepoId],
  )

  const refreshRepositories = React.useCallback(async () => {
    setRepositoriesStatus("loading")
    try {
      const nextRepos = await listRepositories()
      setRepositories(nextRepos)
      setSelectedRepoId((current) => current ?? nextRepos.find((repo) => repo.default)?.id ?? nextRepos[0]?.id)
      setRepositoriesStatus("success")
    } catch (error) {
      const nextError = errorState(error)
      setRepositoriesStatus("error")
      setRepositoryState(nextError.code === "unauthorized" ? "unauthorized" : "unavailable")
      setStatusMessage(nextError.message)
    }
  }, [])

  const refreshStatus = React.useCallback(async () => {
    const repoId = selectedRepo?.id
    const requestId = statusRequestRef.current + 1
    statusRequestRef.current = requestId
    try {
      const status = await getRepositoryStatus(repoId)
      if (statusRequestRef.current !== requestId) return
      if (repoId && status.repo.id !== repoId) return
      setRepositoryStatus(status)
      setRepositoryState(classifyRepositoryStatus(status))
      setStatusMessage(`${status.index.nodeCount.toLocaleString()} symbols across ${status.index.fileCount.toLocaleString()} files.`)
    } catch (error) {
      if (statusRequestRef.current !== requestId) return
      const nextError = errorState(error)
      setRepositoryStatus(undefined)
      setRepositoryState(classifyRepositoryStatus(undefined, nextError.code))
      setStatusMessage(nextError.message)
    }
  }, [selectedRepo?.id])

  const selectRepository = React.useCallback((repoId: string) => {
    statusRequestRef.current += 1
    setSelectedRepoId(repoId)
    setRepositoryStatus(undefined)
    setRepositoryState("missing")
    setStatusMessage("Loading repository state.")
    setSelectedNode(undefined)
  }, [])

  const selectNode = React.useCallback((node: CodeNode) => {
    setSelectedNode(node)
  }, [])

  const clearNode = React.useCallback(() => {
    setSelectedNode(undefined)
  }, [])

  React.useEffect(() => {
    void refreshRepositories()
  }, [refreshRepositories])

  React.useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const value = React.useMemo<AppStateValue>(
    () => ({
      repositories,
      repositoriesStatus,
      selectedRepo,
      repositoryStatus,
      repositoryState,
      statusMessage,
      selectedNode,
      selectRepository,
      selectNode,
      clearNode,
      refreshRepositories,
      refreshStatus,
    }),
    [
      repositories,
      repositoriesStatus,
      selectedRepo,
      repositoryStatus,
      repositoryState,
      statusMessage,
      selectedNode,
      selectRepository,
      selectNode,
      clearNode,
      refreshRepositories,
      refreshStatus,
    ],
  )

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState(): AppStateValue {
  const context = React.useContext(AppStateContext)
  if (!context) {
    throw new Error("useAppState must be used within AppStateProvider")
  }
  return context
}
