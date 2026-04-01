import { useUiStore } from '../stores/uiStore'
import SidebarHeader from './sidebar/SidebarHeader'
import SessionList from './sidebar/SessionList'
import SidebarFooter from './sidebar/SidebarFooter'

export default function Sidebar() {
  const collapsed = useUiStore(s => s.sidebarCollapsed)
  const toggleSidebar = useUiStore(s => s.toggleSidebar)

  return (
    <aside
      className={`flex flex-col bg-surface-1 border-r border-gray-800 transition-all duration-200 relative ${
        collapsed ? 'w-16' : 'w-[280px]'
      }`}
    >
      <SidebarHeader />
      <SessionList />
      <SidebarFooter />

      {/* Collapse toggle */}
      <button
        onClick={toggleSidebar}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-surface-2 border border-gray-700 flex items-center justify-center text-gray-500 hover:text-white hover:border-gray-500 transition-colors z-10"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className={`transition-transform ${collapsed ? '' : 'rotate-180'}`}
        >
          <path d="M4.5 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </aside>
  )
}
