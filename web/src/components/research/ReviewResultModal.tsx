import { useState } from 'react'
import { useResearchActionsStore } from '../../stores/researchActionsStore'
import Badge from '../shared/Badge'
import MarkdownViewer from '../shared/MarkdownViewer'

export default function ReviewResultModal() {
  const { reviewResult, reviewModalOpen, closeReviewModal } = useResearchActionsStore()
  const [activeReviewer, setActiveReviewer] = useState(0)

  if (!reviewModalOpen || !reviewResult) return null

  const { meta_review, reviews } = reviewResult

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={closeReviewModal}
    >
      <div
        className="bg-surface-1 border border-gray-700 rounded-xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-white">Peer Review Results</h2>
            <DecisionBadge decision={meta_review.decision} />
          </div>
          <button
            onClick={closeReviewModal}
            className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-surface-3 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Meta Review Summary */}
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className="text-3xl font-bold font-mono text-white">{meta_review.average_score.toFixed(1)}</div>
                <div className="text-[10px] text-gray-500 uppercase">Score</div>
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Consensus:</span>
                  <Badge variant={meta_review.consensus_level === 'high' ? 'green' : meta_review.consensus_level === 'medium' ? 'yellow' : 'red'}>
                    {meta_review.consensus_level}
                  </Badge>
                </div>
                <div className="text-xs text-gray-500">{reviews.length} reviewer(s)</div>
              </div>
            </div>
          </div>

          {/* Key Issues */}
          {meta_review.key_issues && meta_review.key_issues.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Key Issues</h3>
              <div className="space-y-2">
                {meta_review.key_issues.map((issue, i) => (
                  <div key={i} className="bg-surface-2 rounded-lg p-3 border border-gray-800">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={issue.priority === 'critical' ? 'red' : issue.priority === 'major' ? 'yellow' : 'gray'}>
                        {issue.priority}
                      </Badge>
                      {issue.assignee && (
                        <span className="text-[10px] text-gray-600 font-mono">{issue.assignee}</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-300">{issue.description}</div>
                    {issue.action && (
                      <div className="text-xs text-accent-cyan mt-1">{issue.action}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Per-Reviewer Tabs */}
          {reviews.length > 0 && (
            <div>
              <div className="flex gap-1 mb-3 border-b border-gray-800">
                {reviews.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveReviewer(i)}
                    className={`px-3 py-2 text-xs font-medium transition-colors relative ${
                      activeReviewer === i ? 'text-accent-cyan' : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {r.reviewer_id || `Reviewer ${i + 1}`}
                    <span className="ml-1.5 font-mono text-[10px] text-gray-600">{r.overall_score.toFixed(1)}</span>
                    {activeReviewer === i && (
                      <div className="absolute bottom-0 left-1 right-1 h-0.5 bg-accent-cyan rounded-full" />
                    )}
                  </button>
                ))}
              </div>

              <ReviewerDetail review={reviews[activeReviewer]} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-3 border-t border-gray-800 flex-shrink-0">
          <button
            onClick={closeReviewModal}
            className="px-4 py-2 bg-surface-2 text-gray-300 rounded-lg text-sm font-medium hover:bg-surface-3 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function ReviewerDetail({ review }: { review: any }) {
  if (!review) return null

  const dimensions = review.dimensions ?? {}
  const dimKeys = ['originality', 'significance', 'soundness', 'clarity', 'reproducibility', 'prior_work', 'contribution']

  return (
    <div className="space-y-4">
      {/* Decision + Score */}
      <div className="flex items-center gap-3">
        <DecisionBadge decision={review.decision} />
        <span className="text-sm font-mono text-white">{review.overall_score.toFixed(1)}/10</span>
        <span className="text-xs text-gray-500">Confidence: {review.confidence}/5</span>
      </div>

      {/* Dimension Scores */}
      {Object.keys(dimensions).length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {dimKeys.map(key => {
            const score = dimensions[key]
            if (score == null) return null
            return (
              <div key={key} className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500 w-24 capitalize">{key.replace(/_/g, ' ')}</span>
                <div className="flex-1 h-1.5 bg-surface-0 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent-cyan"
                    style={{ width: `${(score / 10) * 100}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-gray-400 w-4 text-right">{score}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Summary */}
      {review.summary && (
        <div>
          <h4 className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1">Summary</h4>
          <div className="text-xs text-gray-300">
            <MarkdownViewer content={review.summary} />
          </div>
        </div>
      )}

      {/* Strengths */}
      {review.strengths?.length > 0 && (
        <div>
          <h4 className="text-[10px] font-medium text-accent-green uppercase tracking-wider mb-1">Strengths</h4>
          <ul className="space-y-1">
            {review.strengths.map((s: any, i: number) => (
              <li key={i} className="text-xs text-gray-300 flex gap-1.5">
                <span className="text-accent-green flex-shrink-0">+</span>
                <span><span className="font-medium text-gray-200">{s.aspect}:</span> {s.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Weaknesses */}
      {review.weaknesses?.length > 0 && (
        <div>
          <h4 className="text-[10px] font-medium text-accent-red uppercase tracking-wider mb-1">Weaknesses</h4>
          <ul className="space-y-1">
            {review.weaknesses.map((w: any, i: number) => (
              <li key={i} className="text-xs text-gray-300 flex gap-1.5">
                <span className="text-accent-red flex-shrink-0">-</span>
                <span><span className="font-medium text-gray-200">{w.aspect}:</span> {w.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Questions */}
      {review.questions?.length > 0 && (
        <div>
          <h4 className="text-[10px] font-medium text-accent-yellow uppercase tracking-wider mb-1">Questions</h4>
          <ul className="space-y-0.5">
            {review.questions.map((q: string, i: number) => (
              <li key={i} className="text-xs text-gray-400">? {q}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function DecisionBadge({ decision }: { decision: string }) {
  const variant = decision === 'accept' ? 'green'
    : decision === 'reject' ? 'red'
    : 'yellow'
  return <Badge variant={variant}>{decision.replace(/_/g, ' ')}</Badge>
}
