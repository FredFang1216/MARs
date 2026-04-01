import { useUiStore } from '../../stores/uiStore'
import Badge from '../shared/Badge'

interface ClaimDetail {
  id: string
  statement: string
  phase: string
  epistemicLayer: string
  is_main?: boolean
  confidence?: number
  evidence_ids?: string[]
  assessment_history?: Array<{
    timestamp: string
    phase: string
    reason: string
  }>
}

interface Props {
  claim: ClaimDetail | null
}

const PHASE_VARIANT: Record<string, 'green' | 'purple' | 'yellow' | 'red' | 'cyan' | 'gray'> = {
  admitted: 'green',
  proposed: 'purple',
  under_investigation: 'yellow',
  refuted: 'red',
  reformulated: 'cyan',
  suspended: 'gray',
}

export default function ClaimDetailDrawer({ claim }: Props) {
  const setSelectedClaimId = useUiStore(s => s.setSelectedClaimId)

  if (!claim) return null

  return (
    <div className="absolute right-0 top-0 bottom-0 w-72 bg-surface-1 border-l border-gray-800 overflow-y-auto animate-slide-in-right z-10">
      <div className="flex items-center justify-between p-3 border-b border-gray-800">
        <span className="text-xs font-mono text-gray-500 truncate">{claim.id}</span>
        <button
          onClick={() => setSelectedClaimId(null)}
          className="p-1 rounded text-gray-500 hover:text-white hover:bg-surface-3"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="p-3 space-y-3">
        <div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            <Badge variant={PHASE_VARIANT[claim.phase] ?? 'gray'} dot>
              {claim.phase.replace(/_/g, ' ')}
            </Badge>
            <Badge variant="gray">{claim.epistemicLayer}</Badge>
            {claim.is_main && <Badge variant="cyan">main</Badge>}
          </div>
          <p className="text-sm text-gray-200 leading-relaxed">
            {claim.statement}
          </p>
        </div>

        {claim.confidence != null && (
          <div>
            <div className="text-xs text-gray-500 mb-1">Confidence</div>
            <div className="w-full h-1.5 bg-surface-3 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-accent-cyan"
                style={{ width: `${claim.confidence * 100}%` }}
              />
            </div>
            <div className="text-xs text-gray-500 mt-0.5 font-mono">
              {(claim.confidence * 100).toFixed(0)}%
            </div>
          </div>
        )}

        {claim.evidence_ids && claim.evidence_ids.length > 0 && (
          <div>
            <div className="text-xs text-gray-500 mb-1">
              Evidence ({claim.evidence_ids.length})
            </div>
            <div className="space-y-1">
              {claim.evidence_ids.map(id => (
                <div key={id} className="text-xs font-mono text-gray-400 bg-surface-2 rounded px-2 py-1 truncate">
                  {id}
                </div>
              ))}
            </div>
          </div>
        )}

        {claim.assessment_history && claim.assessment_history.length > 0 && (
          <div>
            <div className="text-xs text-gray-500 mb-1">History</div>
            <div className="space-y-1.5">
              {claim.assessment_history.map((entry, i) => (
                <div key={i} className="text-xs">
                  <div className="flex gap-2">
                    <Badge variant={PHASE_VARIANT[entry.phase] ?? 'gray'}>
                      {entry.phase.replace(/_/g, ' ')}
                    </Badge>
                    <span className="text-gray-600">
                      {new Date(entry.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-gray-500 mt-0.5">{entry.reason}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
