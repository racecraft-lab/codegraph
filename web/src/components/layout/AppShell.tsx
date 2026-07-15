import type { ReactNode } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import {
  BotIcon,
  GitBranchIcon,
  HomeIcon,
  RefreshCcwIcon,
  SearchIcon,
} from "lucide-react"

import { RepositoryStatus } from "@/components/layout/RepositoryStatus"
import { RepositorySwitcher } from "@/components/layout/RepositorySwitcher"
import { SelectedContextBar } from "@/components/layout/SelectedContextBar"
import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar"

const navItems = [
  { to: "/", label: "Overview", icon: HomeIcon },
  { to: "/search", label: "Search", icon: SearchIcon },
  { to: "/reindex", label: "Re-analysis", icon: RefreshCcwIcon },
  { to: "/chat", label: "Chat", icon: BotIcon },
]

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1">
            <GitBranchIcon />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">CodeGraph</div>
              <div className="truncate text-xs text-muted-foreground">Local graph browser</div>
            </div>
          </div>
          <RepositorySwitcher />
        </SidebarHeader>
        <SidebarSeparator />
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      isActive={location.pathname === item.to}
                      tooltip={item.label}
                      onClick={() => navigate(item.to)}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <RepositoryStatus />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="flex min-h-12 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Button variant="ghost" size="sm" onClick={() => navigate("/search")}>
            <SearchIcon data-icon="inline-start" />
            Search symbols
          </Button>
        </header>
        <SelectedContextBar />
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
