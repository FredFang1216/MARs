interface Props {
  stability: {
    convergenceScore: number
    paperReadiness: string
    evidenceCoverage: number
    weakestBridge: { claimId: string; vulnerability: number } | null
  }
}

const READINESS_COLORS: Record<string, string> = {
  ready: 'text-accent-green',
  nearly_ready: 'text-accent-cyan',
  needs_work: 'text-accent-yellow',
  not_ready: 'text-accent-red',
}

export default function StabilityPanel({ stability }: Props) {
  const convergencePct = (stability.convergenceScore * 100).toFixed(0)
  const coveragePct = (stability.evidenceCoverage * 100).toFixed(0)
  const readinessColor = READINESS_COLORS[stability.paperReadiness] ?? 'text-gray-400'

  return (
    <div className="bg-surface-1 border border-gray-800 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-400 mb-3">Convergence</h3>

      <div className="flex items-end gap-2 mb-3">
        <span className="text-2xl font-bold text-white">{convergencePct}%</span>
        <span className={`text-sm mb-1 ${readinessColor}`}>
          {stability.paperReadiness.replace('_', ' ')}
        </span>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Evidence coverage</span>
          <span className="text-white">{coveragePct}%</span>
        </div>

        {stability.weakestBridge && (
          <div className="flex justify-between">
            <span className="text-gray-500">Weakest bridge</span>
            <span className="text-accent-yellow">
              vuln={stability.weakestBridge.vulnerability.toFixed(2)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
