import { useNavigate, useLocation } from 'react-router-dom'
import { useWsStore } from '../../stores/wsStore'
import { useUiStore } from '../../stores/uiStore'

export default function SidebarFooter() {
  const navigate = useNavigate()
  const location = useLocation()
  const connected = useWsStore(s => s.connected)
  const collapsed = useUiStore(s => s.sidebarCollapsed)

  return (
    <div className="border-t border-gray-800 p-2 space-y-1">
      <button
        onClick={() => navigate('/settings')}
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
          location.pathname === '/settings'
            ? 'bg-surface-3 text-white'
            : 'text-gray-500 hover:text-gray-300 hover:bg-surface-2'
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
          <path
            d="M8 10a2 2 0 100-4 2 2 0 000 4z"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M13.3 6.5l-.7-.4a5.5 5.5 0 00-.5-.9l.2-.8a.5.5 0 00-.2-.5l-1-1a.5.5 0 00-.5-.1l-.8.2a5.5 5.5 0 00-.9-.5l-.4-.7a.5.5 0 00-.4-.3H7a.5.5 0 00-.5.3l-.4.7a5.5 5.5 0 00-.9.5l-.8-.2a.5.5 0 00-.5.1l-1 1a.5.5 0 00-.1.5l.2.8a5.5 5.5 0 00-.5.9l-.7.4a.5.5 0 00-.3.5v1.4c0 .2.1.4.3.5l.7.4c.1.3.3.6.5.9l-.2.8c0 .2 0 .4.2.5l1 1c.1.1.3.2.5.1l.8-.2c.3.2.6.4.9.5l.4.7c.1.2.3.3.5.3h1.4c.2 0 .4-.1.5-.3l.4-.7c.3-.1.6-.3.9-.5l.8.2c.2 0 .4 0 .5-.2l1-1c.2-.1.2-.3.2-.5l-.2-.8c.2-.3.4-.6.5-.9l.7-.4c.2-.1.3-.3.3-.5V7c0-.2-.1-.4-.3-.5z"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
        {!collapsed && <span>Settings</span>}
      </button>

      <div className={`flex items-center gap-2 px-3 py-1.5 ${collapsed ? 'justify-center' : ''}`}>
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            connected ? 'bg-accent-green' : 'bg-accent-red'
          }`}
        />
        {!collapsed && (
          <span className="text-xs text-gray-600">
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        )}
      </div>
    </div>
  )
}
