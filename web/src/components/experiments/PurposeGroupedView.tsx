import { useMemo } from 'react'
import PurposeGroup from './PurposeGroup'
import type { ExperimentNoteSummary, ExperimentLogEntry } from './types'

interface Props {
  summaries: ExperimentNoteSummary[]
  experiments: ExperimentLogEntry[]
  filterStatus: string | null
  onSelect: (id: string) => void
}

function classifyPurpose(purpose: string): string {
  const lower = purpose.toLowerCase()
  if (lower.match(/baseline|benchmark/)) return 'Baseline & Benchmarking'
  if (lower.match(/validate|verify|hypothesis|test(?:ing)?/)) return 'Hypothesis Validation'
  if (lower.match(/compare|comparison|ablation|versus|vs\b/)) return 'Comparison & Ablation'
  if (lower.match(/probe|sanity|check|debug/)) return 'Sanity Checks'
  if (lower.match(/optimize|tune|sensitivity|hyperparameter/)) return 'Optimization & Tuning'
  return 'General Experiments'
}

export default function PurposeGroupedView({ summaries, experiments, filterStatus, onSelect }: Props) {
  const logMap = useMemo(() => {
    const m = new Map<string, ExperimentLogEntry>()
    for (const e of experiments) m.set(e.id, e)
    return m
  }, [experiments])

  const filtered = useMemo(() => {
    if (!filterStatus) return summaries
    return summaries.filter(s => {
      const entry = logMap.get(s.id)
      return entry?.status === filterStatus
    })
  }, [summaries, filterStatus, logMap])

  const groups = useMemo(() => {
    const map = new Map<string, ExperimentNoteSummary[]>()
    for (const s of filtered) {
      const cat = classifyPurpose(s.purpose)
      const list = map.get(cat) ?? []
      list.push(s)
      map.set(cat, list)
    }
    // Sort groups by size descending
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [filtered])

  if (groups.length === 0) {
    return (
      <div className="text-center py-12 text-gray-600 text-sm">
        {filterStatus ? 'No experiments match this filter.' : 'No experiments yet.'}
      </div>
    )
  }

  return (
    <div>
      {groups.map(([category, items]) => (
        <PurposeGroup
          key={category}
          category={category}
          summaries={items}
          logEntries={logMap}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
