import Badge from '../shared/Badge'
import type { ExperimentNoteSummary, ExperimentLogEntry } from './types'

interface Props {
  summary: ExperimentNoteSummary
  logEntry?: ExperimentLogEntry
  onSelect: (id: string) => void
}

const STATUS_COLORS: Record<string, string> = {
  completed: 'green',
  running: 'yellow',
  failed: 'red',
  aborted: 'gray',
  created: 'gray',
}

export default function ExperimentSummaryRow({ summary, logEntry, onSelect }: Props) {
  const status = logEntry?.status ?? (summary.success ? 'completed' : 'failed')
  const color = STATUS_COLORS[status] ?? 'gray'
  const tier = logEntry?.tier

  return (
    <button
      onClick={() => onSelect(summary.id)}
      className="w-full text-left p-3 border border-gray-800 rounded-md hover:border-gray-700 hover:bg-surface-2/50 transition-colors group"
    >
      <div className="flex items-start gap-2">
        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
          status === 'completed' ? 'bg-accent-green' :
          status === 'running' ? 'bg-yellow-400 animate-pulse' :
          status === 'failed' ? 'bg-accent-red' : 'bg-gray-600'
        }`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-mono text-gray-500">{summary.id}</span>
            <Badge variant={color as any} className="text-[10px]">{status}</Badge>
            {tier && <span className="text-[10px] text-gray-600 font-mono">T{tier}</span>}
          </div>
          <p className="text-sm text-gray-200 line-clamp-2">{summary.purpose}</p>
          {summary.key_metrics.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-1.5">
              {summary.key_metrics.map((m, i) => (
                <span key={i} className="text-[11px] font-mono text-accent-cyan bg-accent-cyan/10 px-1.5 py-0.5 rounded">
                  {m}
                </span>
              ))}
            </div>
          )}
          {summary.one_liner && summary.one_liner !== summary.purpose && (
            <p className="text-xs text-gray-500 mt-1 line-clamp-1">{summary.one_liner}</p>
          )}
        </div>
        <svg
          width="12" height="12" viewBox="0 0 12 12"
          className="mt-1.5 text-gray-700 group-hover:text-gray-400 transition-colors flex-shrink-0"
        >
          <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        </svg>
      </div>
    </button>
  )
}
