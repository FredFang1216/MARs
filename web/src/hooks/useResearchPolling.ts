import { useEffect } from 'react'
import { useSessionStore } from '../stores/sessionStore'

/**
 * Poll the research state and literature artifacts every `intervalMs` for the given session.
 * Research state only polls when active; literature artifacts always poll when a session exists.
 */
export function useResearchPolling(sessionId: string | undefined, intervalMs = 10000) {
  const hasResearchState = useSessionStore(s => s.researchState != null)
  const refreshResearchState = useSessionStore(s => s.refreshResearchState)
  const refreshLiteratureArtifacts = useSessionStore(s => s.refreshLiteratureArtifacts)

  useEffect(() => {
    if (!sessionId) return

    const interval = setInterval(() => {
      if (hasResearchState) refreshResearchState().catch(() => {})
      refreshLiteratureArtifacts().catch(() => {})
    }, intervalMs)

    return () => clearInterval(interval)
  }, [sessionId, hasResearchState, intervalMs, refreshResearchState, refreshLiteratureArtifacts])
}
