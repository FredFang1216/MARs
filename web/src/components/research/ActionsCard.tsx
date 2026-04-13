import { useState, useEffect, useRef } from 'react'
import Card from '../shared/Card'
import Badge from '../shared/Badge'
import { useResearchActionsStore } from '../../stores/researchActionsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { fetchTemplates, getPaperPdfUrl } from '../../api/client'
import type { TemplateEntry } from '../../api/client'

interface Props {
  sessionId: string
}

export default function ActionsCard({ sessionId }: Props) {
  const store = useResearchActionsStore()
  const researchState = useSessionStore(s => s.researchState)
  const [templates, setTemplates] = useState<TemplateEntry[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [reviewStrength, setReviewStrength] = useState<string>('standard')
  const [reviewerCount, setReviewerCount] = useState(3)
  const [deliverFormat, setDeliverFormat] = useState<string>('standard')
  const [includeCode, setIncludeCode] = useState(false)
  const progressRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchTemplates().then(setTemplates).catch(() => {})
    store.fetchNextAction()
    const cleanup = store.initListeners()
    return cleanup
  }, [])

  useEffect(() => {
    if (progressRef.current) {
      progressRef.current.scrollTop = progressRef.current.scrollHeight
    }
  }, [store.actionProgress])

  const anyLoading = store.writePaperLoading || store.reviewLoading || store.deliverLoading
  const hasPdf = store.writePaperResult?.success || researchState?.artifacts?.compiled_pdf

  return (
    <Card title="Research Actions">
      <div className="space-y-4">
        {/* Next Action Recommendation */}
        <NextActionSection />

        {/* Write Paper */}
        <ActionSection title="Write Paper" icon="M">
          <div className="flex items-center gap-2">
            <select
              value={selectedTemplate}
              onChange={e => setSelectedTemplate(e.target.value)}
              className="flex-1 bg-surface-2 border border-gray-700 rounded px-2 py-1.5 text-xs text-white"
              disabled={store.writePaperLoading}
            >
              <option value="">Default template</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <ActionButton
              loading={store.writePaperLoading}
              onClick={() => store.writePaper(selectedTemplate || undefined)}
              disabled={anyLoading}
            >
              Write
            </ActionButton>
          </div>
          {store.writePaperError && (
            <div className="text-xs text-accent-red mt-1">{store.writePaperError}</div>
          )}
          {store.writePaperResult?.success && (
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="green">Complete</Badge>
              <button
                onClick={() => store.openPdfModal()}
                className="text-xs text-accent-cyan hover:underline"
              >
                View PDF
              </button>
              <a
                href={getPaperPdfUrl(sessionId)}
                download
                className="text-xs text-gray-400 hover:text-white"
              >
                Download
              </a>
            </div>
          )}
          {store.writePaperResult?.warnings && store.writePaperResult.warnings.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {store.writePaperResult.warnings.map((w, i) => (
                <div key={i} className="text-xs text-accent-yellow">{w}</div>
              ))}
            </div>
          )}
        </ActionSection>

        {/* Review */}
        <ActionSection title="Review Paper" icon="R">
          <div className="flex items-center gap-2">
            <select
              value={reviewStrength}
              onChange={e => setReviewStrength(e.target.value)}
              className="bg-surface-2 border border-gray-700 rounded px-2 py-1.5 text-xs text-white"
              disabled={store.reviewLoading}
            >
              <option value="light">Light</option>
              <option value="standard">Standard</option>
              <option value="thorough">Thorough</option>
              <option value="brutal">Brutal</option>
            </select>
            <input
              type="number"
              min={1}
              max={5}
              value={reviewerCount}
              onChange={e => setReviewerCount(Math.min(5, Math.max(1, parseInt(e.target.value) || 1)))}
              className="w-14 bg-surface-2 border border-gray-700 rounded px-2 py-1.5 text-xs text-white text-center"
              disabled={store.reviewLoading}
              title="Number of reviewers"
            />
            <ActionButton
              loading={store.reviewLoading}
              onClick={() => store.review({ strength: reviewStrength, num_reviewers: reviewerCount })}
              disabled={anyLoading}
            >
              Review
            </ActionButton>
          </div>
          {store.reviewError && (
            <div className="text-xs text-accent-red mt-1">{store.reviewError}</div>
          )}
          {store.reviewResult && (
            <div className="flex items-center gap-2 mt-2">
              <DecisionBadge decision={store.reviewResult.meta_review.decision} />
              <span className="text-xs text-gray-400">
                Score: {store.reviewResult.meta_review.average_score.toFixed(1)}/10
              </span>
              <button
                onClick={() => store.openReviewModal()}
                className="text-xs text-accent-cyan hover:underline"
              >
                View Details
              </button>
            </div>
          )}
        </ActionSection>

        {/* Deliver */}
        <ActionSection title="Package & Deliver" icon="D">
          <div className="flex items-center gap-2">
            <select
              value={deliverFormat}
              onChange={e => setDeliverFormat(e.target.value)}
              className="flex-1 bg-surface-2 border border-gray-700 rounded px-2 py-1.5 text-xs text-white"
              disabled={store.deliverLoading}
            >
              <option value="standard">Standard</option>
              <option value="arxiv">arXiv</option>
              <option value="camera-ready">Camera Ready</option>
            </select>
            <label className="flex items-center gap-1 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={includeCode}
                onChange={e => setIncludeCode(e.target.checked)}
                disabled={store.deliverLoading}
                className="rounded"
              />
              Code
            </label>
            <ActionButton
              loading={store.deliverLoading}
              onClick={() => store.deliver({ format: deliverFormat, include_code: includeCode })}
              disabled={anyLoading}
            >
              Package
            </ActionButton>
          </div>
          {store.deliverError && (
            <div className="text-xs text-accent-red mt-1">{store.deliverError}</div>
          )}
          {store.deliverResult && (
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="green">{store.deliverResult.format}</Badge>
                <span className="text-xs text-gray-400">{store.deliverResult.files.length} files</span>
              </div>
              <div className="text-xs text-gray-500 space-y-0.5">
                {store.deliverResult.files.slice(0, 5).map((f, i) => (
                  <div key={i} className="font-mono truncate">{f.path}</div>
                ))}
                {store.deliverResult.files.length > 5 && (
                  <div>...and {store.deliverResult.files.length - 5} more</div>
                )}
              </div>
            </div>
          )}
        </ActionSection>

        {/* Progress Log */}
        {store.actionProgress.length > 0 && (
          <div
            ref={progressRef}
            className="bg-surface-0 rounded-lg border border-gray-800 p-2.5 max-h-40 overflow-y-auto"
          >
            {store.actionProgress.map((msg, i) => (
              <div key={i} className="text-xs font-mono text-gray-500 leading-relaxed">
                {msg}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

function NextActionSection() {
  const { nextAction, nextActionLoading, fetchNextAction } = useResearchActionsStore()

  if (nextActionLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Spinner />
        Analyzing next steps...
      </div>
    )
  }

  if (!nextAction) return null

  return (
    <div className="bg-surface-2 rounded-lg border border-gray-800 p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Suggested Next</span>
        <button
          onClick={() => fetchNextAction()}
          className="text-[10px] text-gray-600 hover:text-accent-cyan transition-colors"
        >
          Refresh
        </button>
      </div>
      <div className="text-sm text-white font-medium mb-1">{nextAction.action}</div>
      {nextAction.delegate_to && (
        <div className="text-xs text-gray-500 mb-1">
          Agent: <span className="text-accent-cyan font-mono">{nextAction.delegate_to}</span>
        </div>
      )}
      <div className="text-xs text-gray-500">{nextAction.reasoning}</div>
      {nextAction.risk && (
        <div className="text-xs text-accent-yellow mt-1">Risk: {nextAction.risk}</div>
      )}
    </div>
  )
}

function ActionSection({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-gray-800 pt-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-5 h-5 rounded bg-surface-2 flex items-center justify-center text-[10px] font-bold text-accent-cyan">
          {icon}
        </span>
        <span className="text-xs font-medium text-gray-300">{title}</span>
      </div>
      {children}
    </div>
  )
}

function ActionButton({
  children,
  loading,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  loading: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-1.5 bg-accent-cyan/15 text-accent-cyan rounded text-xs font-medium hover:bg-accent-cyan/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 whitespace-nowrap"
    >
      {loading && <Spinner />}
      {children}
    </button>
  )
}

function DecisionBadge({ decision }: { decision: string }) {
  const variant = decision === 'accept' ? 'green'
    : decision === 'reject' ? 'red'
    : 'yellow'
  const label = decision.replace(/_/g, ' ')
  return <Badge variant={variant}>{label}</Badge>
}

function Spinner() {
  return (
    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
