import type { ExperimentLogEntry } from './types'

interface Props {
  experiments: ExperimentLogEntry[]
  groupBy: 'purpose' | 'claim' | 'chronological'
  filterStatus: string | null
  onGroupByChange: (g: 'purpose' | 'claim' | 'chronological') => void
  onFilterChange: (s: string | null) => void
  onJournalClick: () => void
}

export default function ExperimentDashboardHeader({
  experiments,
  groupBy,
  filterStatus,
  onGroupByChange,
  onFilterChange,
  onJournalClick,
}: Props) {
  const total = experiments.length
  const completed = experiments.filter(e => e.status === 'completed').length
  const running = experiments.filter(e => e.status === 'running').length
  const failed = experiments.filter(e => e.status === 'failed').length

  const statuses = [
    { key: null, label: 'All', count: total },
    { key: 'completed', label: 'Completed', count: completed, color: 'text-accent-green' },
    { key: 'running', label: 'Running', count: running, color: 'text-yellow-400' },
    { key: 'failed', label: 'Failed', count: failed, color: 'text-accent-red' },
  ] as const

  return (
    <div className="space-y-3">
      {/* Stats row */}
      <div className="flex items-center gap-4">
        <div className="text-sm font-medium text-gray-300">
          {total} experiment{total !== 1 ? 's' : ''}
        </div>
        <div className="flex-1" />
        <button
          onClick={onJournalClick}
          className="text-xs text-gray-500 hover:text-accent-cyan transition-colors"
        >
          Journal
        </button>
      </div>

      {/* Filter pills */}
      <div className="flex gap-1.5 flex-wrap">
        {statuses.map(s => (
          <button
            key={s.key ?? 'all'}
            onClick={() => onFilterChange(s.key)}
            className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
              filterStatus === s.key
                ? 'border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan'
                : 'border-gray-800 text-gray-500 hover:border-gray-700 hover:text-gray-400'
            }`}
          >
            {s.label}
            {s.count > 0 && (
              <span className={`ml-1 font-mono ${'color' in s ? s.color : ''}`}>{s.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Group-by toggle */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-gray-600 uppercase tracking-wider mr-1">Group by</span>
        {(['purpose', 'claim', 'chronological'] as const).map(g => (
          <button
            key={g}
            onClick={() => onGroupByChange(g)}
            className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
              groupBy === g
                ? 'bg-surface-3 text-gray-200'
                : 'text-gray-600 hover:text-gray-400'
            }`}
          >
            {g === 'purpose' ? 'Purpose' : g === 'claim' ? 'Claim' : 'Time'}
          </button>
        ))}
      </div>
    </div>
  )
}
