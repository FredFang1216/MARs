import Badge from '../shared/Badge'
import MarkdownViewer from '../shared/MarkdownViewer'
import MetricsTable from './MetricsTable'
import FigureGallery from './FigureGallery'
import Card from '../shared/Card'
import type { ExperimentDetail } from './types'

interface Props {
  sessionId: string
  detail: ExperimentDetail
  note: string | null
  onBack: () => void
}

export default function ExperimentDetailView({ sessionId, detail, note, onBack }: Props) {
  const { log_entry, meta, metrics, audit, figures, tables } = detail
  const status = log_entry.status
  const success = status === 'completed'
  const duration = log_entry.duration_seconds ?? meta?.duration_seconds

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="p-1 text-gray-500 hover:text-white transition-colors"
          title="Back to list"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <span className="text-sm font-mono text-gray-400">{log_entry.id}</span>
        <Badge variant={success ? 'green' : status === 'running' ? 'yellow' : status === 'failed' ? 'red' : 'gray'}>
          {status}
        </Badge>
        <span className="text-[10px] font-mono text-gray-600">Tier {log_entry.tier}</span>
      </div>

      {/* Purpose / Hypothesis */}
      <Card title="Purpose">
        <p className="text-sm text-gray-300">{meta?.purpose ?? log_entry.purpose}</p>
        {log_entry.targets_claim && (
          <div className="mt-2 text-xs text-gray-500">
            <span className="text-gray-600">Target claim:</span>{' '}
            <span className="font-mono text-gray-400">{log_entry.targets_claim}</span>
          </div>
        )}
      </Card>

      {/* Key Result Banner */}
      {log_entry.key_result && (
        <div className={`px-3 py-2.5 rounded-lg border text-sm ${
          success
            ? 'bg-accent-green/10 border-accent-green/30 text-accent-green'
            : 'bg-accent-red/10 border-accent-red/30 text-accent-red'
        }`}>
          {log_entry.key_result}
        </div>
      )}

      {/* Metrics */}
      {metrics && (
        <Card title="Metrics">
          <MetricsTable metrics={metrics} />
        </Card>
      )}

      {/* Figures */}
      {figures.length > 0 && (
        <Card title={`Figures (${figures.length})`}>
          <FigureGallery
            sessionId={sessionId}
            experimentId={log_entry.id}
            figures={figures}
          />
        </Card>
      )}

      {/* Audit */}
      {audit && (
        <Card title="Audit">
          <div className="space-y-1.5">
            {audit.static_audit.checks.map(check => (
              <div key={check.name} className="flex items-center gap-2 text-xs">
                <span className={`w-4 text-center ${check.passed ? 'text-accent-green' : 'text-accent-red'}`}>
                  {check.passed ? '\u2713' : '\u2717'}
                </span>
                <span className="text-gray-400">{check.name}</span>
                {!check.passed && check.details && (
                  <span className="text-gray-600 truncate ml-1">{check.details}</span>
                )}
              </div>
            ))}
          </div>
          {audit.semantic_audit && audit.semantic_audit.issues.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-800">
              <div className="text-xs text-gray-500 mb-1.5">Semantic Audit Issues</div>
              {audit.semantic_audit.issues.map((issue, i) => (
                <div key={i} className="text-xs mb-1.5">
                  <span className={`font-medium ${
                    issue.severity === 'critical' ? 'text-accent-red' :
                    issue.severity === 'major' ? 'text-yellow-400' : 'text-gray-500'
                  }`}>{issue.severity}</span>
                  <span className="text-gray-400 ml-1">{issue.description}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Execution Summary (collapsed by default) */}
      <details className="group">
        <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-400 transition-colors px-1">
          Execution Details
        </summary>
        <div className="mt-2 px-3 py-2 bg-surface-2 rounded-md text-xs space-y-1 text-gray-500">
          <div>Created: <span className="text-gray-400">{log_entry.created_at}</span></div>
          {duration != null && <div>Duration: <span className="text-gray-400">{duration}s</span></div>}
          {meta?.seed != null && <div>Seed: <span className="font-mono text-gray-400">{meta.seed}</span></div>}
          {meta?.created_by && <div>Agent: <span className="text-gray-400">{meta.created_by}</span></div>}
          {meta?.promoted_to_run && <div>Promoted to: <span className="font-mono text-accent-cyan">{meta.promoted_to_run}</span></div>}
          {tables.length > 0 && <div>Tables: <span className="text-gray-400">{tables.join(', ')}</span></div>}
        </div>
      </details>

      {/* Full NOTE.md */}
      {note && (
        <Card title="Experiment Note">
          <div className="prose-sm">
            <MarkdownViewer content={note} />
          </div>
        </Card>
      )}
    </div>
  )
}
