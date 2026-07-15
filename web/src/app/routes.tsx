import { Navigate, Route, Routes } from "react-router-dom"

import { ChatRoute } from "@/routes/ChatRoute"
import { GraphRoute } from "@/routes/GraphRoute"
import { ImpactRoute } from "@/routes/ImpactRoute"
import { ReindexRoute } from "@/routes/ReindexRoute"
import { RepositoryOverview } from "@/routes/RepositoryOverview"
import { SearchRoute } from "@/routes/SearchRoute"
import { SymbolDetailRoute } from "@/routes/SymbolDetailRoute"

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RepositoryOverview />} />
      <Route path="/search" element={<SearchRoute />} />
      <Route path="/symbol/:id" element={<SymbolDetailRoute />} />
      <Route path="/graph/:id" element={<GraphRoute />} />
      <Route path="/impact/:id" element={<ImpactRoute />} />
      <Route path="/reindex" element={<ReindexRoute />} />
      <Route path="/chat" element={<ChatRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
