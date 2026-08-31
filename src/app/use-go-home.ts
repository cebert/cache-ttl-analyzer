/**
 * Return to the landing screen.
 *
 * "Home" is two things, not one: the route, and the absence of a selected
 * session — the main pane shows the upload screen exactly when nothing is
 * selected. Every control that means "take me back" (the wordmark, the back
 * button above a result, "Add session") has to do both, so they share this
 * rather than each remembering to.
 *
 * The session itself stays in the sidebar; deselecting forgets nothing.
 */

import { useCallback } from 'react'
import { useNavigate } from 'react-router'

import { useSessions } from '../state/sessions-context'
import { ROUTES } from './routes'

export function useGoHome(): () => void {
  const navigate = useNavigate()
  const { select } = useSessions()
  return useCallback(() => {
    select(null)
    void navigate(ROUTES.home)
  }, [navigate, select])
}
