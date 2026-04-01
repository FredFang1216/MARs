import { useNavigate, useLocation } from 'react-router-dom'
import { useUiStore } from '../../stores/uiStore'

export default function SidebarHeader() {
  const navigate = useNavigate()
  const location = useLocation()
  const collapsed = useUiStore(s => s.sidebarCollapsed)

  return (
    <div className="p-3 border-b border-gray-800">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-accent-cyan/15 flex items-center justify-center flex-shrink-0">
            <span className="text-accent-cyan font-bold text-sm">CP</span>
          </div>
          {!collapsed && (
            <span className="text-sm font-semibold text-white truncate">
              Claude Paper
            </span>
          )}
        </div>
      </div>

      <button
        onClick={() => navigate('/new')}
        className={`mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors ${
          location.pathname === '/new'
            ? 'bg-accent-cyan/20 text-accent-cyan'
            : 'bg-surface-2 text-gray-300 hover:bg-surface-3 hover:text-white'
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0">
          <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        {!collapsed && <span>New Research</span>}
      </button>
    </div>
  )
}
