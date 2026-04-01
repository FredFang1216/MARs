interface Props {
  budget: {
    total_usd: number
    spent_usd: number
    remaining_usd: number
  }
}

export default function BudgetPanel({ budget }: Props) {
  const pct = budget.total_usd > 0
    ? (budget.spent_usd / budget.total_usd) * 100
    : 0
  const isLow = budget.remaining_usd < budget.total_usd * 0.2

  return (
    <div className="bg-surface-1 border border-gray-800 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-400 mb-3">Budget</h3>

      <div className="flex items-end gap-2 mb-2">
        <span className="text-2xl font-bold text-white">
          ${budget.spent_usd.toFixed(2)}
        </span>
        <span className="text-sm text-gray-500 mb-1">
          / ${budget.total_usd.toFixed(0)}
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-surface-3 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            isLow ? 'bg-accent-red' : 'bg-accent-cyan'
          }`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>

      <div className="flex justify-between mt-2 text-xs text-gray-500">
        <span>{pct.toFixed(0)}% used</span>
        <span>${budget.remaining_usd.toFixed(2)} remaining</span>
      </div>
    </div>
  )
}
