import type { SessionMeta } from '../../api/client'

interface SessionItemProps {
  session: SessionMeta
  active: boolean
  collapsed: boolean
  onClick: () => void
}

export default function SessionItem({ session, active, collapsed, onClick }: SessionItemProps) {
  const timeAgo = getTimeAgo(session.last_active)

  if (collapsed) {
    return (
      <button
        onClick={onClick}
        title={session.topic}
        className={`w-full flex items-center justify-center p-2 rounded-lg transition-colors ${
          active
            ? 'bg-accent-cyan/15 text-accent-cyan'
            : 'text-gray-500 hover:bg-surface-2 hover:text-gray-300'
        }`}
      >
        <span className="w-6 h-6 rounded-full bg-surface-3 flex items-center justify-center text-xs font-medium">
          {session.topic.charAt(0).toUpperCase()}
        </span>
      </button>
    )
  }

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors group ${
        active
          ? 'bg-accent-cyan/10 border border-accent-cyan/20'
          : 'hover:bg-surface-2 border border-transparent'
      }`}
    >
      <div className="text-sm text-white truncate leading-tight">
        {session.topic}
      </div>
      <div className="flex items-center gap-2 mt-1 text-xs text-gray-600">
        <span>{timeAgo}</span>
      </div>
    </button>
  )
}

function getTimeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}
