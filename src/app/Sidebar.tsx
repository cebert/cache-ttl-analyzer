/**
 * The persistent 236px sidebar: brand, the add-session action, the standing
 * links, then the session list, with the memory-only notice pinned to the
 * bottom. Below `md` it is rendered inside a drawer instead of beside the
 * content; the markup is the same either way.
 *
 * WP-D pinned the three standing links to the bottom. Moved up in WP-10:
 * "Find your logs" is a task link — you need it before you can upload
 * anything — and filing it with two meta links in the footer read as an
 * afterthought. The session list keeps the flexible space below them, so it
 * still gets the room it needs as it grows.
 */

import { NavLink, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'

import { useSessions } from '../state/sessions-context'
import { useGoHome } from './use-go-home'
import { Button } from '../ui/Button'
import { ClockIcon, PlusIcon, ShieldCheckIcon } from '../ui/Icon'
import { Eyebrow } from '../ui/Sheet'
import { SessionRow } from './SessionRow'
import { ROUTES } from './routes'

/**
 * The wordmark, which is also the way home — clicking a product's name to get
 * back to its front page is the one navigation every reader already knows,
 * and it is reachable from the mobile header as well as the sidebar.
 */
export function SidebarBrand({ onNavigate }: { onNavigate?: () => void } = {}) {
  const { t } = useTranslation()
  const goHome = useGoHome()
  return (
    <button
      type="button"
      onClick={() => {
        goHome()
        onNavigate?.()
      }}
      className="flex min-w-0 items-center gap-[9px] rounded-[6px] py-1 transition-opacity hover:opacity-70"
    >
      <ClockIcon size={18} className="shrink-0 text-primary" />
      <span className="truncate text-[15px] font-semibold tracking-[-0.02em]">{t('app.name')}</span>
      <span className="sr-only">{t('nav.home')}</span>
    </button>
  )
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { state, select } = useSessions()
  const goHome = useGoHome()

  function openSession(id: string) {
    select(id)
    void navigate(ROUTES.home)
    onNavigate?.()
  }

  function addSession() {
    goHome()
    onNavigate?.()
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="hidden h-[52px] shrink-0 items-center border-b border-line-soft px-4 md:flex">
        <SidebarBrand onNavigate={onNavigate} />
      </div>

      <div className="p-3">
        <Button variant="primary" className="w-full" onClick={addSession}>
          <PlusIcon size={14} />
          {t('nav.addSession')}
        </Button>
      </div>

      {/* Labelled here rather than by the container, because `Sidebar` renders
          both in the desktop column and inside the mobile drawer — labelling
          it outside gave the drawer copy no landmark at all. */}
      <nav className="flex flex-col gap-0.5 px-3 pb-1" aria-label={t('nav.guides')}>
        <NavItem to={ROUTES.findLogs} onNavigate={onNavigate}>
          {t('nav.findLogs')}
        </NavItem>
        <NavItem to={ROUTES.dataPolicy} onNavigate={onNavigate}>
          {t('nav.dataPolicy')}
        </NavItem>
        <NavItem to={ROUTES.about} onNavigate={onNavigate}>
          {t('nav.about')}
        </NavItem>
      </nav>

      <nav
        aria-label={t('nav.sessionList')}
        className="mt-2 flex min-h-0 flex-1 flex-col border-t border-line-soft px-3"
      >
        <div className="flex items-center justify-between px-[10px] pt-3 pb-2">
          <Eyebrow>{t('nav.sessions')}</Eyebrow>
          <span className="font-mono text-[11.5px] text-slate-400">{state.sessions.length}</span>
        </div>

        {state.sessions.length === 0 ? (
          <p className="rounded-[6px] border border-dashed border-[#E1E8F0] px-[10px] py-4 text-center text-[12px] leading-[1.5] text-slate-500">
            {t('nav.sessionsEmpty')}
          </p>
        ) : (
          <ul
            className="flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto"
            aria-label={t('nav.sessionList')}
          >
            {state.sessions.map((entry) => (
              <SessionRow
                key={entry.id}
                entry={entry}
                active={entry.id === state.selectedId}
                onSelect={() => openSession(entry.id)}
              />
            ))}
          </ul>
        )}
      </nav>

      <div className="mt-auto border-t border-line-soft p-3">
        <p className="flex items-center gap-[7px] px-[10px] text-[12px] leading-[1.5] text-slate-500">
          <ShieldCheckIcon size={13} className="shrink-0 text-green" />
          {t('nav.memoryOnly')}
        </p>
      </div>
    </div>
  )
}

function NavItem({
  to,
  children,
  onNavigate,
}: {
  to: string
  children: React.ReactNode
  onNavigate?: () => void
}) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        `flex h-[30px] items-center rounded-[6px] px-[10px] text-[13.5px] transition-colors ${
          isActive ? 'bg-primary-tint font-medium text-primary' : 'text-ink-2 hover:bg-ground'
        }`
      }
    >
      {children}
    </NavLink>
  )
}
