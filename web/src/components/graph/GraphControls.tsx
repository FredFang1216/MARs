import { useUiStore } from '../../stores/uiStore'

interface Props {
  phases: string[]
  activePhases: Set<string>
  onTogglePhase: (phase: string) => void
  onResetFilter: () => void
}

const PHASE_COLORS: Record<string, string> = {
  admitted: 'bg-accent-green',
  proposed: 'bg-accent-purple',
  under_investigation: 'bg-accent-yellow',
  refuted: 'bg-accent-red',
  reformulated: 'bg-accent-cyan',
  suspended: 'bg-gray-500',
}

export default function GraphControls({ phases, activePhases, onTogglePhase, onResetFilter }: Props) {
  const graphFullscreen = useUiStore(s => s.graphFullscreen)
  const setGraphFullscreen = useUiStore(s => s.setGraphFullscreen)
  const setGraphViewActive = useUiStore(s => s.setGraphViewActive)

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 bg-surface-1">
      <span className="text-xs text-gray-500 mr-1">Filter:</span>
      {phases.map(phase => (
        <button
          key={phase}
          onClick={() => onTogglePhase(phase)}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
            activePhases.has(phase)
              ? 'border-gray-600 text-gray-300'
              : 'border-transparent text-gray-600 opacity-50'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${PHASE_COLORS[phase] ?? 'bg-gray-500'}`} />
          {phase.replace(/_/g, ' ')}
        </button>
      ))}

      {activePhases.size < phases.length && (
        <button
          onClick={onResetFilter}
          className="text-[11px] text-accent-cyan hover:text-accent-cyan/80 ml-1"
        >
          Show all
        </button>
      )}

      <div className="ml-auto flex gap-1">
        <button
          onClick={() => setGraphFullscreen(!graphFullscreen)}
          className="p-1 rounded text-gray-500 hover:text-white hover:bg-surface-3 transition-colors"
          title={graphFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            {graphFullscreen ? (
              <path d="M5 1v4H1M9 1v4h4M5 13V9H1M9 13V9h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            ) : (
              <path d="M1 5V1h4M9 1h4v4M1 9v4h4M13 9v4H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            )}
          </svg>
        </button>
        <button
          onClick={() => setGraphViewActive(false)}
          className="p-1 rounded text-gray-500 hover:text-white hover:bg-surface-3 transition-colors"
          title="Close graph"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}
