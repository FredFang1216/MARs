import { useResearchActionsStore } from '../../stores/researchActionsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { getPaperPdfUrl } from '../../api/client'

export default function PdfPreviewModal() {
  const { pdfModalOpen, closePdfModal } = useResearchActionsStore()
  const sessionId = useSessionStore(s => s.currentSessionId)

  if (!pdfModalOpen || !sessionId) return null

  const pdfUrl = getPaperPdfUrl(sessionId)

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={closePdfModal}
    >
      <div
        className="bg-surface-1 border border-gray-700 rounded-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800 flex-shrink-0">
          <h2 className="text-sm font-semibold text-white">Paper Preview</h2>
          <div className="flex items-center gap-3">
            <a
              href={pdfUrl}
              download
              className="text-xs text-accent-cyan hover:underline"
            >
              Download PDF
            </a>
            <button
              onClick={closePdfModal}
              className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-surface-3 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* PDF Embed */}
        <div className="flex-1 min-h-0">
          <iframe
            src={pdfUrl}
            className="w-full h-full min-h-[75vh]"
            title="Paper PDF"
          />
        </div>
      </div>
    </div>
  )
}
