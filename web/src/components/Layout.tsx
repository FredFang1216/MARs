import { Outlet } from 'react-router-dom'
import { useEffect } from 'react'
import { useWsStore } from '../stores/wsStore'
import { useUiStore } from '../stores/uiStore'
import Sidebar from './Sidebar'
import ResearchPanel from './ResearchPanel'
import ClaimGraphView from './graph/ClaimGraphView'
import InterventionModal from './intervention/InterventionModal'
import ReviewResultModal from './research/ReviewResultModal'
import PdfPreviewModal from './research/PdfPreviewModal'

export default function Layout() {
  const init = useWsStore(s => s.init)
  const graphFullscreen = useUiStore(s => s.graphFullscreen)
  const graphViewActive = useUiStore(s => s.graphViewActive)

  useEffect(() => {
    const cleanup = init()
    return cleanup
  }, [init])

  return (
    <div className="flex h-screen overflow-hidden bg-surface-0">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* If graph is active but NOT fullscreen, show it in a split with the chat */}
        {graphViewActive && !graphFullscreen ? (
          <div className="flex flex-col h-full">
            <div className="flex-1 min-h-0 overflow-hidden">
              <ClaimGraphView />
            </div>
          </div>
        ) : (
          <Outlet />
        )}
      </main>
      <ResearchPanel />

      {/* Fullscreen graph overlay */}
      {graphViewActive && graphFullscreen && <ClaimGraphView />}

      {/* Global modals */}
      <InterventionModal />
      <ReviewResultModal />
      <PdfPreviewModal />
    </div>
  )
}
