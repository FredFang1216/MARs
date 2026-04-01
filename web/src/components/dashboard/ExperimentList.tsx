import { useEffect, useState } from 'react'
import { fetchExperiments } from '../../api/client'

interface Props {
  sessionId: string
}

interface Experiment {
  id: string
  tier: number
  status: string
  purpose: string
  key_result: string | null
  created_at: string
}

const STATUS_COLORS: Record<string, string> = {
  completed: 'text-accent-green',
  running: 'text-accent-yellow',
  failed: 'text-accent-red',
  aborted: 'text-gray-500',
  created: 'text-gray-400',
}

export default function ExperimentList({ sessionId }: Props) {
  const [experiments, setExperiments] = useState<Experiment[]>([])

  useEffect(() => {
    fetchExperiments(sessionId)
      .then(setExperiments)
      .catch(() => setExperiments([]))
  }, [sessionId])

  return (
    <div className="bg-surface-1 border border-gray-800 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-400 mb-3">
        Experiments ({experiments.length})
      </h3>

      <div className="space-y-2 max-h-80 overflow-y-auto">
        {experiments.length === 0 && (
          <div className="text-gray-600 text-sm">No experiments yet.</div>
        )}

        {experiments.map(exp => (
          <div
            key={exp.id}
            className="bg-surface-2 rounded p-3 text-sm"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-gray-400">
                T{exp.tier} {exp.id}
              </span>
              <span className={`text-xs ${STATUS_COLORS[exp.status] ?? 'text-gray-500'}`}>
                {exp.status}
              </span>
            </div>
            <p className="text-gray-300 mt-1 truncate">{exp.purpose}</p>
            {exp.key_result && (
              <p className="text-gray-500 text-xs mt-1 truncate">
                {exp.key_result}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
