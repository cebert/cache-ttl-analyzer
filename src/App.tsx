/**
 * Routes. Paths are real paths, not hash fragments — the Worker serves the app
 * with SPA fallback (`wrangler.jsonc`), so /data-policy is a shareable URL.
 *
 * `SessionsProvider` sits above the router because the in-memory history has
 * to survive navigation to the policy pages and back (decision D3: it survives
 * navigation, not a reload).
 */

import { Navigate, Route, Routes } from 'react-router'

import { Shell } from './app/Shell'
import { AboutPage } from './app/pages/AboutPage'
import { AnalyzePage } from './app/pages/AnalyzePage'
import { DataPolicyPage } from './app/pages/DataPolicyPage'
import { FindLogsPage } from './app/pages/FindLogsPage'
import { ROUTES } from './app/routes'

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path={ROUTES.home} element={<AnalyzePage />} />
        <Route path={ROUTES.findLogs} element={<FindLogsPage />} />
        <Route path={ROUTES.dataPolicy} element={<DataPolicyPage />} />
        <Route path={ROUTES.about} element={<AboutPage />} />
        <Route path="*" element={<Navigate to={ROUTES.home} replace />} />
      </Route>
    </Routes>
  )
}
