interface Props {
  claimGraph: {
    claims: Array<{ phase: string; epistemicLayer: string }>
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

export default function ClaimStats({ claimGraph }: Props) {
  const { claims, edges } = claimGraph

  const byPhase: Record<string, number> = {}
  claims.forEach(c => {
    byPhase[c.phase] = (byPhase[c.phase] || 0) + 1
  })

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

      <div className="mt-3 pt-3 border-t border-gray-800 text-xs text-gray-500">
        {(edges as unknown[]).length} edges
      </div>
    </div>
  )
}
