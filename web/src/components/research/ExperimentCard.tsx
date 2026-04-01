import { useEffect, useState } from 'react'
import { fetchExperiments } from '../../api/client'
import Card from '../shared/Card'
import Badge from '../shared/Badge'

interface Props {
  sessionId: string
}

interface Experiment {
  id: string
  tier: number
  status: string
  purpose: string
  key_result: string | null
  created_at?: string
}

const STATUS_VARIANT: Record<string, 'green' | 'yellow' | 'red' | 'gray'> = {
  completed: 'green',
  running: 'yellow',
  failed: 'red',
  aborted: 'gray',
  created: 'gray',
}

export default function ExperimentCard({ sessionId }: Props) {
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    fetchExperiments(sessionId)
      .then(setExperiments)
      .catch(() => setExperiments([]))
  }, [sessionId])

  // Group by tier
  const tiers: Record<number, Experiment[]> = {}
  experiments.forEach(exp => {
    if (!tiers[exp.tier]) tiers[exp.tier] = []
    tiers[exp.tier].push(exp)
  })

  const stats = {
    total: experiments.length,
    completed: experiments.filter(e => e.status === 'completed').length,
    running: experiments.filter(e => e.status === 'running').length,
    failed: experiments.filter(e => e.status === 'failed').length,
  }

  return (
    <Card title={`Experiments (${experiments.length})`}>
      {experiments.length === 0 ? (
        <div className="text-gray-600 text-xs py-4 text-center">No experiments yet.</div>
      ) : (
        <>
          {/* Summary row */}
          <div className="flex gap-3 mb-3 text-xs">
            <span className="text-accent-green font-mono">{stats.completed} done</span>
            {stats.running > 0 && (
              <span className="text-accent-yellow font-mono">{stats.running} running</span>
            )}
            {stats.failed > 0 && (
              <span className="text-accent-red font-mono">{stats.failed} failed</span>
            )}
          </div>

          {/* Grouped by tier */}
          <div className="space-y-3 max-h-[350px] overflow-y-auto">
            {Object.entries(tiers)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([tier, exps]) => (
                <div key={tier}>
                  <div className="text-[11px] text-gray-600 font-medium uppercase tracking-wider mb-1.5">
                    Tier {tier}
                    <span className="text-gray-700 normal-case ml-1">({exps.length})</span>
                  </div>
                  <div className="space-y-1.5">
                    {exps.map(exp => (
                      <button
                        key={exp.id}
                        onClick={() => setExpandedId(expandedId === exp.id ? null : exp.id)}
                        className="w-full text-left bg-surface-2 rounded-lg p-3 hover:bg-surface-3/70 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[11px] text-gray-500 truncate">
                            {exp.id}
                          </span>
                          <Badge variant={STATUS_VARIANT[exp.status] ?? 'gray'}>
                            {exp.status}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-300 mt-1 leading-snug">
                          {exp.purpose}
                        </p>
                        {expandedId === exp.id && exp.key_result && (
                          <div className="mt-2 pt-2 border-t border-gray-700">
                            <div className="text-[11px] text-gray-500 mb-0.5">Key Result</div>
                            <p className="text-xs text-gray-400 leading-relaxed">{exp.key_result}</p>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </>
      )}
    </Card>
  )
}
