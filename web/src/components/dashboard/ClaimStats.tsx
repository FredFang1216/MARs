interface Props {
  claimGraph: {
    claims: Array<{
      phase: string
      epistemicLayer: string
      strength?: { evidenceTier?: string }
    }>
    edges: unknown[]
  }
}

const PHASE_COLORS: Record<string, string> = {
  admitted: 'bg-accent-green',
  proposed: 'bg-accent-cyan',
  under_investigation: 'bg-accent-yellow',
  demoted: 'bg-gray-600',
  rejected: 'bg-accent-red',
  retracted: 'bg-gray-700',
  reformulated: 'bg-accent-purple',
}

const TIER_COLORS: Record<string, string> = {
  maximum: 'bg-accent-green',
  solid: 'bg-accent-cyan',
  minimum: 'bg-accent-yellow',
}

const TIER_LABELS: Record<string, string> = {
  maximum: 'Maximum',
  solid: 'Solid',
  minimum: 'Minimum',
}

export default function ClaimStats({ claimGraph }: Props) {
  const { claims, edges } = claimGraph

  const byPhase: Record<string, number> = {}
  claims.forEach(c => {
    byPhase[c.phase] = (byPhase[c.phase] || 0) + 1
  })

  const byTier: Record<string, number> = {}
  claims.forEach(c => {
    const tier = c.strength?.evidenceTier ?? 'unknown'
    byTier[tier] = (byTier[tier] || 0) + 1
  })
  const hasTiers = Object.keys(byTier).some(k => k !== 'unknown')

  return (
    <div className="bg-surface-1 border border-gray-800 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-400 mb-3">
        Claims ({claims.length})
      </h3>

      <div className="space-y-2">
        {Object.entries(byPhase)
          .sort(([, a], [, b]) => b - a)
          .map(([phase, count]) => (
            <div key={phase} className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${PHASE_COLORS[phase] ?? 'bg-gray-500'}`}
              />
              <span className="text-sm text-gray-400 flex-1">
                {phase.replace('_', ' ')}
              </span>
              <span className="text-sm font-mono text-white">{count}</span>
            </div>
          ))}
      </div>

      {hasTiers && (
        <div className="mt-3 pt-3 border-t border-gray-800">
          <h4 className="text-xs font-semibold text-gray-500 mb-2">Evidence Tier</h4>
          <div className="space-y-1.5">
            {['maximum', 'solid', 'minimum'].map(tier => {
              const count = byTier[tier]
              if (!count) return null
              return (
                <div key={tier} className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${TIER_COLORS[tier]}`} />
                  <span className="text-xs text-gray-400 flex-1">{TIER_LABELS[tier]}</span>
                  <span className="text-xs font-mono text-white">{count}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-gray-800 text-xs text-gray-500">
        {(edges as unknown[]).length} edges
      </div>
    </div>
  )
}
