import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAppState } from "@/app/state"

export function RepositorySwitcher() {
  const { repositories, selectedRepo, repositoriesStatus, selectRepository } = useAppState()

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground" htmlFor="repository-switcher">
        Repository
      </label>
      <Select value={selectedRepo?.id ?? ""} onValueChange={(value) => value && selectRepository(value)}>
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
