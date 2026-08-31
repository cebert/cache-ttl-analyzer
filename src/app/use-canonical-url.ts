/**
 * Keeps `<link rel="canonical">` and `og:url` pointing at the route actually
 * being viewed.
 *
 * The SPA fallback serves the same `index.html` for all four routes, so the
 * document's static canonical claimed every one of them was the homepage —
 * which contradicts `public/sitemap.xml`, where all four are listed, and asks
 * a crawler to drop three of them. React Router changes the URL without
 * reloading the document, so nothing updated these on navigation.
 */

import { useEffect } from 'react'
import { useLocation } from 'react-router'

/** Production origin. Preview hosts serve `X-Robots-Tag: noindex` (WP-09). */
export const SITE_ORIGIN = 'https://cacheanalyzer.com'

function setUrl(selector: string, attribute: string, url: string): void {
  const el = document.head.querySelector(selector)
  if (el) el.setAttribute(attribute, url)
}

export function useCanonicalUrl(): void {
  const { pathname } = useLocation()

  useEffect(() => {
    // Normalize away a trailing slash so `/about/` and `/about` do not compete,
    // but keep the bare root as "/".
    const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/'
    const url = `${SITE_ORIGIN}${path === '/' ? '/' : path}`
    setUrl('link[rel="canonical"]', 'href', url)
    setUrl('meta[property="og:url"]', 'content', url)
  }, [pathname])
}
