import { useState } from 'react'
import Card from '../shared/Card'
import Badge from '../shared/Badge'

interface TrajectoryEntry {
  timestamp: string
  action_type: string
  agent: string
  description: string
  outcome: string
}

interface Props {
  trajectory: TrajectoryEntry[]
}

const AGENT_COLOR: Record<string, 'cyan' | 'green' | 'yellow' | 'purple' | 'red'> = {
  research: 'cyan',
  experiment: 'green',
  analysis: 'yellow',
  writing: 'purple',
  review: 'red',
}

export default function TrajectoryFeed({ trajectory }: Props) {
  const [showAll, setShowAll] = useState(false)
  const display = showAll ? [...trajectory].reverse() : trajectory.slice(-15).reverse()

  return (
    <Card
      title={`Research Trajectory (${trajectory.length})`}
      action={
        trajectory.length > 15 ? (
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-xs text-accent-cyan hover:text-accent-cyan/80 transition-colors"
          >
            {showAll ? 'Show recent' : `Show all ${trajectory.length}`}
          </button>
        ) : undefined
      }
    >
      <div className="space-y-0.5 max-h-[400px] overflow-y-auto">
        {display.length === 0 && (
          <div className="text-gray-600 text-xs py-4 text-center">No actions yet.</div>
        )}

        {display.map((entry, i) => {
          const agentBase = entry.agent?.split('/')[0] ?? ''
          const color = AGENT_COLOR[agentBase] ?? 'cyan'
          return (
            <div key={i} className="flex gap-3 py-1.5 group hover:bg-surface-2/50 rounded px-1 -mx-1 transition-colors">
              <div className="flex flex-col items-center pt-1.5 flex-shrink-0">
                <div className={`w-2 h-2 rounded-full bg-accent-${color}`} />
                {i < display.length - 1 && (
                  <div className="w-px flex-1 bg-gray-800/80 mt-0.5" />
                )}
              </div>
              <div className="pb-1 min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={color as any}>{entry.agent}</Badge>
                  <span className="text-[11px] text-gray-600">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                  {entry.action_type && (
                    <span className="text-[11px] text-gray-700 font-mono">{entry.action_type}</span>
                  )}
                </div>
                <p className="text-sm text-gray-300 mt-0.5 leading-snug">
                  {entry.description}
                </p>
                {entry.outcome && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    Outcome: {entry.outcome}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
