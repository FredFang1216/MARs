import Card from '../shared/Card'
import Badge from '../shared/Badge'
import ProgressBar from '../shared/ProgressBar'

interface Props {
  stability: {
    convergenceScore: number
    paperReadiness: string
    evidenceCoverage: number
    weakestBridge: { claimId: string; vulnerability: number } | null
    claimStability?: number
    experimentalCoverage?: number
    lastDelta?: number
  }
}

const READINESS_VARIANT: Record<string, 'green' | 'cyan' | 'yellow' | 'red'> = {
  ready: 'green',
  nearly_ready: 'cyan',
  needs_work: 'yellow',
  not_ready: 'red',
}

export default function StabilityCard({ stability }: Props) {
  const convergencePct = stability.convergenceScore * 100
  const coveragePct = stability.evidenceCoverage * 100
  const variant = READINESS_VARIANT[stability.paperReadiness] ?? 'gray'

  return (
    <Card title="Convergence & Stability">
      <div className="flex items-end gap-3 mb-3">
        <span className="text-3xl font-bold text-white font-mono">
          {convergencePct.toFixed(0)}%
        </span>
        <Badge variant={variant as any} dot>
          {stability.paperReadiness.replace(/_/g, ' ')}
        </Badge>
        {stability.lastDelta != null && (
          <span className={`text-xs font-mono ml-auto ${stability.lastDelta >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
            {stability.lastDelta >= 0 ? '+' : ''}{(stability.lastDelta * 100).toFixed(1)}%
          </span>
        )}
      </div>

      <ProgressBar
        value={convergencePct}
        color={convergencePct >= 80 ? 'green' : convergencePct >= 50 ? 'cyan' : 'yellow'}
        size="md"
      />

      {/* Detailed metrics */}
      <div className="mt-4 space-y-3">
        <div>
          <ProgressBar
            value={coveragePct}
            color="cyan"
            size="sm"
            label="Evidence Coverage"
            sublabel={`${coveragePct.toFixed(0)}%`}
          />
        </div>

        {stability.claimStability != null && (
          <div>
            <ProgressBar
              value={stability.claimStability * 100}
              color="purple"
              size="sm"
              label="Claim Stability"
              sublabel={`${(stability.claimStability * 100).toFixed(0)}%`}
            />
          </div>
        )}

        {stability.experimentalCoverage != null && (
          <div>
            <ProgressBar
              value={stability.experimentalCoverage * 100}
              color="green"
              size="sm"
              label="Experimental Coverage"
              sublabel={`${(stability.experimentalCoverage * 100).toFixed(0)}%`}
            />
          </div>
        )}
      </div>

      {stability.weakestBridge && (
        <div className="mt-3 pt-3 border-t border-gray-800">
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Weakest bridge</span>
            <span className="text-accent-yellow font-mono">
              vuln={stability.weakestBridge.vulnerability.toFixed(2)}
            </span>
          </div>
          <div className="text-[11px] text-gray-600 font-mono mt-0.5 truncate">
            {stability.weakestBridge.claimId}
          </div>
        </div>
      )}
    </Card>
  )
}
