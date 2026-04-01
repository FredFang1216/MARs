import Card from '../shared/Card'
import ProgressBar from '../shared/ProgressBar'

interface Props {
  budget: {
    total_usd: number
    spent_usd: number
    remaining_usd: number
    breakdown?: Record<string, number> | Array<{ category: string; spent_usd: number }>
  }
}

export default function BudgetCard({ budget }: Props) {
  const pct = budget.total_usd > 0 ? (budget.spent_usd / budget.total_usd) * 100 : 0
  const isLow = budget.remaining_usd < budget.total_usd * 0.2

  // Sort breakdown by cost descending
  // breakdown can be Record<string, number> or Array<{category, spent_usd}>
  const breakdownEntries: [string, number][] = (() => {
    if (!budget.breakdown) return []
    if (Array.isArray(budget.breakdown)) {
      return budget.breakdown.map((item: any) => [
        String(item.category ?? 'unknown'),
        Number(item.spent_usd ?? 0),
      ] as [string, number])
    }
    return Object.entries(budget.breakdown).map(([k, v]) => [k, Number(v)] as [string, number])
  })().sort(([, a], [, b]) => b - a)

  return (
    <Card title="Budget">
      <div className="flex items-end gap-2 mb-3">
        <span className="text-3xl font-bold text-white font-mono">
          ${budget.spent_usd.toFixed(2)}
        </span>
        <span className="text-sm text-gray-500 mb-0.5">
          / ${budget.total_usd.toFixed(0)} USD
        </span>
      </div>

      <ProgressBar
        value={pct}
        color={isLow ? 'red' : pct > 60 ? 'yellow' : 'cyan'}
        size="md"
      />

      <div className="flex justify-between mt-2 text-xs">
        <span className="text-gray-500">{pct.toFixed(1)}% consumed</span>
        <span className={`font-mono font-medium ${isLow ? 'text-accent-red' : 'text-gray-400'}`}>
          ${budget.remaining_usd.toFixed(2)} remaining
        </span>
      </div>

      {/* Cost breakdown by category */}
      {breakdownEntries.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-800">
          <div className="text-xs font-medium text-gray-500 mb-2">Cost Breakdown</div>
          <div className="space-y-1.5">
            {breakdownEntries.map(([category, amount]) => {
              const catPct = budget.total_usd > 0 ? (amount / budget.total_usd) * 100 : 0
              return (
                <div key={category}>
                  <div className="flex justify-between text-xs mb-0.5">
                    <span className="text-gray-400 capitalize">{category.replace(/_/g, ' ')}</span>
                    <span className="text-gray-300 font-mono">${amount.toFixed(2)}</span>
                  </div>
                  <div className="w-full h-1 bg-surface-3 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent-cyan/60 transition-all"
                      style={{ width: `${Math.min(catPct, 100)}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Card>
  )
}
