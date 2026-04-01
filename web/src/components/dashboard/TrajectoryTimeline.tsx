interface Props {
  trajectory: Array<{
    timestamp: string
    action_type: string
    agent: string
    description: string
    outcome: string
  }>
}

export default function TrajectoryTimeline({ trajectory }: Props) {
  const recent = trajectory.slice(-20).reverse()

  return (
    <div className="bg-surface-1 border border-gray-800 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-400 mb-3">
        Research Trajectory ({trajectory.length} actions)
      </h3>

      <div className="space-y-3 max-h-80 overflow-y-auto">
        {recent.length === 0 && (
          <div className="text-gray-600 text-sm">No actions yet.</div>
        )}

        {recent.map((entry, i) => (
          <div key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="w-2 h-2 rounded-full bg-accent-cyan mt-1.5" />
              {i < recent.length - 1 && (
                <div className="w-px flex-1 bg-gray-800" />
              )}
            </div>
            <div className="pb-3 min-w-0">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-accent-cyan font-mono">
                  {entry.agent}
                </span>
                <span className="text-gray-600">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-sm text-gray-300 mt-0.5 truncate">
                {entry.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
