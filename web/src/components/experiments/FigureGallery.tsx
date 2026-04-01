import { useState } from 'react'
import { getExperimentFigureUrl } from '../../api/client'

interface Props {
  sessionId: string
  experimentId: string
  figures: string[]
}

export default function FigureGallery({ sessionId, experimentId, figures }: Props) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)

  if (figures.length === 0) return null

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {figures.map((fn, i) => (
          <button
            key={fn}
            onClick={() => setLightboxIdx(i)}
            className="border border-gray-800 rounded-md overflow-hidden hover:border-gray-600 transition-colors bg-surface-2 aspect-[4/3] flex items-center justify-center"
          >
            <img
              src={getExperimentFigureUrl(sessionId, experimentId, fn)}
              alt={fn}
              loading="lazy"
              className="max-w-full max-h-full object-contain"
            />
          </button>
        ))}
      </div>

      {/* Lightbox */}
      {lightboxIdx !== null && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxIdx(null)}
        >
          <div className="absolute top-4 right-4 flex gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation()
                const url = getExperimentFigureUrl(sessionId, experimentId, figures[lightboxIdx])
                navigator.clipboard.writeText(window.location.origin + url)
              }}
              className="px-3 py-1.5 text-xs text-gray-400 bg-surface-2 rounded-md hover:text-white transition-colors"
              title="Copy URL for paper"
            >
              Copy URL
            </button>
            <button
              onClick={() => setLightboxIdx(null)}
              className="p-2 text-gray-400 hover:text-white transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Prev/Next */}
          {figures.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setLightboxIdx((lightboxIdx - 1 + figures.length) % figures.length) }}
                className="absolute left-4 p-2 text-gray-400 hover:text-white transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M12 4l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setLightboxIdx((lightboxIdx + 1) % figures.length) }}
                className="absolute right-4 p-2 text-gray-400 hover:text-white transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M8 4l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </>
          )}

          <img
            src={getExperimentFigureUrl(sessionId, experimentId, figures[lightboxIdx])}
            alt={figures[lightboxIdx]}
            className="max-w-[90vw] max-h-[85vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />

          <div className="absolute bottom-4 text-xs text-gray-500 font-mono">
            {figures[lightboxIdx]} ({lightboxIdx + 1}/{figures.length})
          </div>
        </div>
      )}
    </>
  )
}
