import Card from '../shared/Card'
import { useUiStore } from '../../stores/uiStore'

interface Props {
  claimGraph: {
    claims: Array<{ phase: string; epistemicLayer: string; is_main?: boolean }>
    edges: Array<{ relation?: string }>
  }
}

const PHASE_COLORS: Record<string, string> = {
  admitted: 'bg-accent-green',
  proposed: 'bg-accent-purple',
  under_investigation: 'bg-accent-yellow',
  demoted: 'bg-gray-600',
  rejected: 'bg-accent-red',
  retracted: 'bg-gray-700',
  reformulated: 'bg-accent-cyan',
  suspended: 'bg-gray-500',
}

export default function ClaimSummaryCard({ claimGraph }: Props) {
  const setGraphViewActive = useUiStore(s => s.setGraphViewActive)
  const { claims, edges } = claimGraph

  const byPhase: Record<string, number> = {}
  const byLayer: Record<string, number> = {}
  let mainCount = 0

  claims.forEach(c => {
    byPhase[c.phase] = (byPhase[c.phase] || 0) + 1
    if (c.epistemicLayer) {
      byLayer[c.epistemicLayer] = (byLayer[c.epistemicLayer] || 0) + 1
    }
    if (c.is_main) mainCount++
  })

  // Edge type breakdown
  const byRelation: Record<string, number> = {}
  ;(edges as Array<{ relation?: string }>).forEach(e => {
    const rel = e.relation ?? 'unknown'
    byRelation[rel] = (byRelation[rel] || 0) + 1
  })

  return (
    <Card
      title={`Claim Graph (${claims.length} claims)`}
      action={
        <button
          onClick={() => setGraphViewActive(true)}
          className="px-2.5 py-1 bg-accent-cyan/15 text-accent-cyan rounded text-xs hover:bg-accent-cyan/25 transition-colors"
        >
          Open Graph
        </button>
      }
    >
      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-surface-2 rounded px-2.5 py-2 text-center">
          <div className="text-lg font-bold text-white font-mono">{claims.length}</div>
          <div className="text-[11px] text-gray-500">Claims</div>
        </div>
        <div className="bg-surface-2 rounded px-2.5 py-2 text-center">
          <div className="text-lg font-bold text-white font-mono">{edges.length}</div>
          <div className="text-[11px] text-gray-500">Edges</div>
        </div>
        <div className="bg-surface-2 rounded px-2.5 py-2 text-center">
          <div className="text-lg font-bold text-accent-cyan font-mono">{mainCount}</div>
          <div className="text-[11px] text-gray-500">Main</div>
        </div>
      </div>

      {/* Phase breakdown */}
      <div className="mb-3">
        <div className="text-xs font-medium text-gray-500 mb-1.5">By Phase</div>
        <div className="space-y-1">
          {Object.entries(byPhase)
            .sort(([, a], [, b]) => b - a)
            .map(([phase, count]) => {
              const pct = claims.length > 0 ? (count / claims.length) * 100 : 0
              return (
                <div key={phase} className="flex items-center gap-2">
                  <span
                    className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${PHASE_COLORS[phase] ?? 'bg-gray-500'}`}
                  />
                  <span className="text-xs text-gray-400 flex-1">
                    {phase.replace(/_/g, ' ')}
                  </span>
                  <div className="w-16 h-1 bg-surface-3 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${PHASE_COLORS[phase] ?? 'bg-gray-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono text-white w-6 text-right">{count}</span>
                </div>
              )
            })}
        </div>
      </div>

      {/* Layer breakdown */}
      {Object.keys(byLayer).length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-medium text-gray-500 mb-1.5">By Epistemic Layer</div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(byLayer)
              .sort(([, a], [, b]) => b - a)
              .map(([layer, count]) => (
                <span key={layer} className="text-xs bg-surface-2 text-gray-400 px-2 py-0.5 rounded">
                  {layer} <span className="text-white font-mono">{count}</span>
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Relation breakdown */}
      {Object.keys(byRelation).length > 0 && (
        <div className="pt-2 border-t border-gray-800">
          <div className="text-xs font-medium text-gray-500 mb-1.5">Edge Types</div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(byRelation)
              .sort(([, a], [, b]) => b - a)
              .map(([rel, count]) => (
                <span key={rel} className="text-[11px] bg-surface-2 text-gray-500 px-2 py-0.5 rounded font-mono">
                  {rel} ({count})
                </span>
              ))}
          </div>
        </div>
      )}
    </Card>
  )
}
