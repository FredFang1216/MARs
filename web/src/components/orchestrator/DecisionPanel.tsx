interface Props {
  decision: {
    reasoning: string
    action: {
      type: string
      delegate_to: string
      priority: string
      estimated_cost_usd: number
    }
  }
  onResolve: (choice: 'approve' | 'edit' | 'skip') => void
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'text-accent-red',
  high: 'text-accent-yellow',
  normal: 'text-accent-green',
  low: 'text-gray-500',
}

export default function DecisionPanel({ decision, onResolve }: Props) {
  return (
    <div className="bg-surface-2 rounded-lg p-4 border border-accent-cyan/20">
      <h4 className="text-sm font-semibold text-accent-cyan mb-2">
        Decision Pending
      </h4>

      <div className="space-y-1 text-sm mb-3">
        <div className="flex gap-2">
          <span className="text-gray-500">Action:</span>
          <span className="text-white">{decision.action.type}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-gray-500">Agent:</span>
          <span className="text-white">{decision.action.delegate_to}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-gray-500">Priority:</span>
          <span className={PRIORITY_COLORS[decision.action.priority] ?? 'text-gray-400'}>
            {decision.action.priority}
          </span>
        </div>
        <div className="flex gap-2">
          <span className="text-gray-500">Est. cost:</span>
          <span className="text-white">
            ${decision.action.estimated_cost_usd.toFixed(2)}
          </span>
        </div>
      </div>

      <p className="text-xs text-gray-400 mb-3 line-clamp-3">
        {decision.reasoning}
      </p>

      <div className="flex gap-2">
        <button
          onClick={() => onResolve('approve')}
          className="px-3 py-1.5 bg-accent-green/20 text-accent-green rounded text-sm hover:bg-accent-green/30"
        >
          Approve
        </button>
        <button
          onClick={() => onResolve('skip')}
          className="px-3 py-1.5 bg-accent-yellow/20 text-accent-yellow rounded text-sm hover:bg-accent-yellow/30"
        >
          Skip
        </button>
        <button
          onClick={() => onResolve('edit')}
          className="px-3 py-1.5 bg-accent-purple/20 text-accent-purple rounded text-sm hover:bg-accent-purple/30"
        >
          Re-decide
        </button>
      </div>
    </div>
  )
}
