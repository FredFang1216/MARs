import { useWsStore } from '../../stores/wsStore'
import * as ws from '../../api/ws'
import DecisionPanel from './DecisionPanel'

interface Props {
  sessionId: string
}

export default function OrchestratorPanel({ sessionId }: Props) {
  const { orchestratorStatus, pendingDecision, progressMessages } = useWsStore()

  if (!orchestratorStatus) return null

  const handleDecision = (choice: 'approve' | 'edit' | 'skip') => {
    ws.request('orchestrator/decide', { choice })
  }

  return (
    <div className="bg-surface-1 border border-accent-cyan/30 rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-accent-cyan animate-pulse" />
          <h3 className="text-sm font-semibold text-accent-cyan">
            Orchestrator Running
          </h3>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span>Cycle {orchestratorStatus.cycle}</span>
          <span>Phase: {orchestratorStatus.phase}</span>
        </div>
      </div>

      {/* Decision panel */}
      {pendingDecision && (
        <DecisionPanel
          decision={pendingDecision}
          onResolve={handleDecision}
        />
      )}

      {/* Progress log */}
      {progressMessages.length > 0 && (
        <div className="mt-3 max-h-32 overflow-y-auto">
          {progressMessages.slice(-10).map((msg, i) => (
            <div key={i} className="text-xs text-gray-500 font-mono py-0.5">
              {msg}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
