import { useState } from 'react'
import ExperimentSummaryRow from './ExperimentSummaryRow'
import type { ExperimentNoteSummary, ExperimentLogEntry } from './types'

interface Props {
  category: string
  summaries: ExperimentNoteSummary[]
  logEntries: Map<string, ExperimentLogEntry>
  onSelect: (id: string) => void
}

export default function PurposeGroup({ category, summaries, logEntries, onSelect }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const completedCount = summaries.filter(s => s.success).length

  return (
    <div className="mb-4">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-1 py-1.5 text-left"
      >
        <svg
          width="10" height="10" viewBox="0 0 10 10"
          className={`text-gray-600 transition-transform ${collapsed ? '' : 'rotate-90'}`}
        >
          <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        </svg>
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{category}</span>
        <span className="text-[10px] font-mono text-gray-600">
          {completedCount}/{summaries.length}
        </span>
      </button>
      {!collapsed && (
        <div className="space-y-1.5 mt-1">
          {summaries.map(s => (
            <ExperimentSummaryRow
              key={s.id}
              summary={s}
              logEntry={logEntries.get(s.id)}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}
