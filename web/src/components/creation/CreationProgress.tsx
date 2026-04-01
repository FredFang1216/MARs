import { useEffect, useRef } from 'react'
import type { CreationPhase } from '../../stores/creationStore'

const PHASES: { key: CreationPhase; label: string; description: string }[] = [
  { key: 'deep_research', label: 'Deep Research', description: 'Searching and analyzing academic literature' },
  { key: 'proposals', label: 'Proposals', description: 'Generating research proposals from findings' },
  { key: 'selecting', label: 'Selection', description: 'Evaluating and selecting best proposal' },
  { key: 'orchestrator_init', label: 'Initialize', description: 'Setting up research state and orchestrator' },
  { key: 'complete', label: 'Complete', description: 'Research session is ready' },
]

function phaseIndex(phase: CreationPhase): number {
  const idx = PHASES.findIndex(p => p.key === phase)
  return idx >= 0 ? idx : -1
}

interface Props {
  phase: CreationPhase
  progress: string[]
  onCancel: () => void
}

export default function CreationProgress({ phase, progress, onCancel }: Props) {
  const logRef = useRef<HTMLDivElement>(null)
  const activeIdx = phaseIndex(phase)

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [progress])

  const currentPhase = PHASES[activeIdx]

  return (
    <div>
      {/* Current phase highlight */}
      {currentPhase && phase !== 'error' && phase !== 'cancelled' && (
        <div className="bg-accent-cyan/10 border border-accent-cyan/20 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-2 mb-1">
            {phase !== 'complete' && (
              <div className="w-2.5 h-2.5 rounded-full bg-accent-cyan animate-pulse" />
            )}
            <span className="text-sm font-semibold text-accent-cyan">
              {phase === 'complete' ? 'Completed' : currentPhase.label}
            </span>
            <span className="text-xs text-gray-500 ml-auto font-mono">
              Step {activeIdx + 1}/{PHASES.length}
            </span>
          </div>
          <p className="text-sm text-gray-400">{currentPhase.description}</p>
        </div>
      )}

      {/* Phase stepper */}
      <div className="flex items-center gap-0.5 mb-4 overflow-x-auto pb-1">
        {PHASES.map((p, i) => {
          const isActive = p.key === phase
          const isDone = activeIdx > i || phase === 'complete'
          return (
            <div key={p.key} className="flex items-center gap-0.5 flex-shrink-0">
              {i > 0 && (
                <div
                  className={`w-8 h-0.5 rounded ${isDone ? 'bg-accent-cyan' : 'bg-gray-800'}`}
                />
              )}
              <div className="flex items-center gap-1.5">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                    isDone
                      ? 'bg-accent-cyan text-black'
                      : isActive
                        ? 'bg-accent-cyan/20 text-accent-cyan border-2 border-accent-cyan'
                        : 'bg-surface-2 text-gray-600 border border-gray-700'
                  }`}
                >
                  {isDone ? '\u2713' : i + 1}
                </div>
                <div>
                  <span
                    className={`text-xs font-medium block leading-tight ${
                      isActive
                        ? 'text-accent-cyan'
                        : isDone
                          ? 'text-gray-300'
                          : 'text-gray-600'
                    }`}
                  >
                    {p.label}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Log panel — larger */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-gray-500">
            Progress Log ({progress.length} messages)
          </span>
          {progress.length > 0 && (
            <span className="text-[11px] text-gray-600 font-mono">
              {progress[progress.length - 1]?.slice(0, 60)}
            </span>
          )}
        </div>
        <div
          ref={logRef}
          className="bg-surface-0 rounded-lg border border-gray-800 p-4 min-h-[200px] max-h-[400px] overflow-y-auto font-mono text-sm text-gray-400 space-y-0.5"
        >
          {progress.length === 0 && (
            <div className="flex items-center gap-2 text-gray-600">
              <div className="w-1.5 h-1.5 rounded-full bg-gray-600 animate-pulse" />
              Waiting for progress...
            </div>
          )}
          {progress.map((msg, i) => (
            <div key={i} className="py-0.5 leading-relaxed flex gap-2">
              <span className="text-gray-700 select-none flex-shrink-0 w-6 text-right">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className={i === progress.length - 1 ? 'text-gray-300' : ''}>{msg}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Cancel button */}
      {phase !== 'complete' && phase !== 'error' && phase !== 'cancelled' && (
        <div className="mt-4">
          <button
            onClick={onCancel}
            className="px-5 py-2 bg-red-900/20 text-red-400 rounded-lg text-sm hover:bg-red-900/30 transition-colors"
          >
            Cancel Creation
          </button>
        </div>
      )}
    </div>
  )
}
