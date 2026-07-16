import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useSidebar } from "@/components/ui/sidebar"
import { useAppState } from "@/app/state"
import { useLocation, useNavigate } from "react-router-dom"

const REPO_SCOPED_SYMBOL_ROUTES = ["/symbol/", "/graph/", "/impact/"]

export function RepositorySwitcher() {
  const { repositories, selectedRepo, repositoriesStatus, selectRepository } = useAppState()
  const location = useLocation()
  const navigate = useNavigate()
  const { isMobile, setOpenMobile } = useSidebar()

  function changeRepository(repoId: string) {
    selectRepository(repoId)
    if (REPO_SCOPED_SYMBOL_ROUTES.some((prefix) => location.pathname.startsWith(prefix))) {
      navigate("/", { replace: true })
    }
    if (isMobile) setOpenMobile(false)
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground" htmlFor="repository-switcher">
        Repository
      </label>
      <Select value={selectedRepo?.id ?? ""} onValueChange={(value) => value && changeRepository(value)}>
        <SelectTrigger id="repository-switcher" className="w-full">
          <SelectValue placeholder={repositoriesStatus === "loading" ? "Loading repositories" : "Select repository"} />
        </SelectTrigger>
        <SelectContent align="start">
          <SelectGroup>
            {repositories.map((repo) => (
              <SelectItem key={repo.id} value={repo.id}>
                {repo.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}
