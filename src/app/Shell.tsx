/**
 * The app frame: sidebar beside content on desktop, a header with a drawer
 * below `md`. The top bar names what the main pane is showing, which is the
 * only piece of chrome that changes between screens.
 *
 * Below `md` the menu button and the drawer both sit on the left, the same
 * side as the sidebar they stand in for — a drawer opening from the opposite
 * edge to its own button reads as a different surface.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Outlet } from 'react-router'
import { useTranslation } from 'react-i18next'

import { Sidebar, SidebarBrand } from './Sidebar'
import { ChevronLeftIcon, CloseIcon, MenuIcon } from '../ui/Icon'

export function Shell() {
  const { t } = useTranslation()
  // The drawer closes from the interaction that navigates (every control
  // inside it calls `onNavigate`), not from an effect watching the location:
  // setting state in an effect costs an extra render for no benefit here.
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Escape closes the drawer, which is the one overlay in the shell.
  useEffect(() => {
    if (!drawerOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen])

  return (
    <div className="flex min-h-dvh flex-col bg-ground text-ink md:flex-row md:items-stretch">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-30 focus:rounded-[6px] focus:bg-surface focus:px-3 focus:py-2 focus:shadow-[var(--shadow-dialog)]"
      >
        {t('nav.skipToContent')}
      </a>

      {/*
        Above the drawer (z-30 to its z-20), not beside it. The drawer opens
        from the same edge as this button, so at equal stacking it painted
        over its own close control and the only way out was the scrim.
      */}
      <header className="sticky top-0 z-30 flex h-[52px] shrink-0 items-center gap-1 border-b border-line bg-surface pr-4 pl-2 md:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen((open) => !open)}
          aria-expanded={drawerOpen}
          aria-controls="app-drawer"
          className="flex size-11 shrink-0 items-center justify-center rounded-[6px] text-ink-2 hover:bg-ground"
        >
          {drawerOpen ? <CloseIcon size={20} /> : <MenuIcon size={20} />}
          <span className="sr-only">{drawerOpen ? t('nav.closeMenu') : t('nav.openMenu')}</span>
        </button>
        <SidebarBrand />
      </header>

      {drawerOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-20 bg-ink/20 md:hidden"
            onClick={() => setDrawerOpen(false)}
          >
            <span className="sr-only">{t('nav.closeMenu')}</span>
          </button>
          <div
            id="app-drawer"
            className="fixed inset-y-0 left-0 z-20 flex w-[280px] max-w-[85vw] flex-col border-r border-line bg-surface shadow-[var(--shadow-dialog)] md:hidden"
          >
            <div className="h-[52px] shrink-0" />
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
          </div>
        </>
      )}

      <nav
        aria-label={t('nav.sessionList')}
        className="hidden w-[236px] shrink-0 border-r border-line md:block"
      >
        <Sidebar />
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  )
}

/**
 * The 52px bar above the main pane. It is chrome, not content: the page body
 * owns the document's heading hierarchy, so this is a labelled region rather
 * than a heading — otherwise every content page announces its title twice.
 *
 * `title` is app copy; `meta` may carry log-derived text, so it is rendered as
 * a text node and truncated rather than wrapped.
 */
export function TopBar({
  title,
  meta,
  back,
}: {
  title: ReactNode
  meta?: ReactNode
  back?: BackAction
}) {
  return (
    <div className="hidden h-[52px] shrink-0 items-center justify-between gap-6 border-b border-line bg-surface px-6 md:flex">
      <div className="flex min-w-0 items-center gap-2.5">
        {back && <BackButton {...back} />}
        <p className="truncate text-[15px] font-semibold tracking-[-0.01em]">{title}</p>
      </div>
      {meta && <span className="truncate font-mono text-[12px] text-slate-400">{meta}</span>}
    </div>
  )
}

export interface BackAction {
  label: string
  onClick: () => void
}

/**
 * The way out of a session and back to the upload screen.
 *
 * It has to be a real control rather than a reliance on the browser's Back
 * button: selecting a session pushes no history entry — the pane is a
 * function of which session is selected, not of the URL — so Back would leave
 * the site entirely.
 */
export function BackButton({
  label,
  onClick,
  className = '',
}: BackAction & { className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-ml-1.5 flex shrink-0 items-center gap-1 rounded-[6px] py-1 pr-2.5 pl-1.5 text-[13.5px] text-ink-2 transition-colors hover:bg-ground hover:text-ink ${className}`}
    >
      <ChevronLeftIcon size={15} className="shrink-0" />
      {label}
    </button>
  )
}

export function MainPane({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="min-w-0 flex-1">
      {children}
    </main>
  )
}
