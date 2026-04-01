import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useSessionStore } from '../../stores/sessionStore'
import { useUiStore } from '../../stores/uiStore'
import SessionItem from './SessionItem'

export default function SessionList() {
  const { sessions, loading, loadSessions } = useSessionStore()
  const collapsed = useUiStore(s => s.sidebarCollapsed)
  const navigate = useNavigate()
  const { sessionId: activeId } = useParams<{ sessionId: string }>()

  useEffect(() => {
    loadSessions()
    const interval = setInterval(loadSessions, 30000)
    return () => clearInterval(interval)
  }, [loadSessions])

  if (loading && sessions.length === 0) {
    return (
      <div className="p-3 text-xs text-gray-600">
        {collapsed ? '...' : 'Loading...'}
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="p-3 text-xs text-gray-600">
        {collapsed ? '' : 'No sessions yet'}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
      {!collapsed && (
        <div className="px-2 py-1.5 text-[11px] font-medium text-gray-600 uppercase tracking-wider">
          Sessions
        </div>
      )}
      {sessions.map(session => (
        <SessionItem
          key={session.id}
          session={session}
          active={session.id === activeId}
          collapsed={collapsed}
          onClick={() => navigate(`/s/${session.id}`)}
        />
      ))}
    </div>
  )
}
