/**
 * Route paths in one place. These are real paths rather than hash fragments —
 * `wrangler.jsonc` serves the app with `not_found_handling:
 * single-page-application`, so a deep link to /data-policy resolves.
 */

export const ROUTES = {
  home: '/',
  findLogs: '/find-your-logs',
  dataPolicy: '/data-policy',
  about: '/about',
} as const
