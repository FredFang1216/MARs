import { useState } from 'react'
import Card from '../shared/Card'

// ── Types (mirroring backend ResearchState.literature_awareness) ──

interface DeepReadPaper {
  paper_id: string
  key_takeaways: string[]
  relevance_to_us: string
  useful_techniques: string[]
  potential_conflicts: string[]
}

interface KnownResult {
  statement: string
  source: string
  confidence: number
  directly_usable: boolean
}

interface ConfirmedGap {
  description: string
  evidence: string
  last_checked: string
}

interface LiteratureAwareness {
  deeply_read: DeepReadPaper[]
  aware_but_unread: { paper_id: string; title: string; why_relevant: string }[]
  known_results: KnownResult[]
  confirmed_gaps: ConfirmedGap[]
  last_comprehensive_search: string | null
}

interface Props {
  literatureAwareness: LiteratureAwareness | null | undefined
}

export default function LiteratureTab({ literatureAwareness }: Props) {
  const lit = literatureAwareness ?? {
    deeply_read: [],
    aware_but_unread: [],
    known_results: [],
    confirmed_gaps: [],
    last_comprehensive_search: null,
  }

  const isEmpty =
    lit.deeply_read.length === 0 &&
    lit.aware_but_unread.length === 0 &&
    lit.known_results.length === 0 &&
    lit.confirmed_gaps.length === 0

  if (isEmpty) {
    return (
      <div className="text-center py-12 text-gray-600 text-sm">
        <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-surface-2 flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M3 3h12v12H3z" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
            <path d="M6 7h6M6 10h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.4" />
          </svg>
        </div>
        <p>No literature data yet.</p>
        <p className="text-gray-700 text-xs mt-1">
          Literature will be populated as the research pipeline runs.
        </p>
      </div>
    )
  }

  return (
    <>
      {/* Summary */}
      <div className="flex flex-wrap gap-3 text-xs text-gray-500">
        {lit.deeply_read.length > 0 && (
          <span>
            <span className="text-accent-purple font-mono">{lit.deeply_read.length}</span> deeply read
          </span>
        )}
        {lit.aware_but_unread.length > 0 && (
          <span>
            <span className="text-gray-400 font-mono">{lit.aware_but_unread.length}</span> aware
          </span>
        )}
        {lit.known_results.length > 0 && (
          <span>
            <span className="text-accent-cyan font-mono">{lit.known_results.length}</span> known results
          </span>
        )}
        {lit.confirmed_gaps.length > 0 && (
          <span>
            <span className="text-accent-yellow font-mono">{lit.confirmed_gaps.length}</span> gaps
          </span>
        )}
        {lit.last_comprehensive_search && (
          <span className="text-gray-600">
            Last search: {formatDate(lit.last_comprehensive_search)}
          </span>
        )}
      </div>

      {/* Deeply Read Papers */}
      {lit.deeply_read.length > 0 && (
        <Card title="Deeply Read Papers">
          <div className="space-y-2">
            {lit.deeply_read.map((paper, i) => (
              <DeepReadItem key={paper.paper_id || i} paper={paper} />
            ))}
          </div>
        </Card>
      )}

      {/* Aware But Unread */}
      {lit.aware_but_unread.length > 0 && (
        <Card title="Aware But Unread">
          <div className="space-y-1.5">
            {lit.aware_but_unread.map((p, i) => (
              <div key={p.paper_id || i} className="text-sm">
                <span className="text-gray-400">{p.title || p.paper_id}</span>
                <span className="text-gray-600 text-xs block">{p.why_relevant}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Known Results */}
      {lit.known_results.length > 0 && (
        <Card title="Known Results">
          <div className="space-y-2.5">
            {lit.known_results.map((kr) => (
              <div key={`${kr.source}-${kr.statement.slice(0, 50)}`} className="text-sm">
                <div className="flex items-start gap-2">
                  {kr.directly_usable && (
                    <span className="text-accent-green text-xs mt-0.5 flex-shrink-0" title="Directly usable">
                      &#10003;
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-300">{kr.statement}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-accent-cyan font-mono bg-accent-cyan/10 px-1.5 py-0.5 rounded">
                        {kr.source}
                      </span>
                      <div className="flex-1 h-1 bg-surface-3 rounded-full max-w-[80px]">
                        <div
                          className="h-1 bg-accent-cyan rounded-full"
                          style={{ width: `${Math.round(kr.confidence * 100)}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-600 font-mono">
                        {Math.round(kr.confidence * 100)}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Confirmed Gaps */}
      {lit.confirmed_gaps.length > 0 && (
        <Card title="Confirmed Gaps" className="border-accent-yellow/20">
          <div className="space-y-2.5">
            {lit.confirmed_gaps.map((gap) => (
              <div key={`${gap.description.slice(0, 50)}-${gap.last_checked}`} className="text-sm">
                <p className="text-gray-300">{gap.description}</p>
                <div className="flex items-center gap-2 mt-1 text-xs text-gray-600">
                  <span>Searched: {gap.evidence}</span>
                  <span className="text-gray-700">|</span>
                  <span>Checked: {formatDate(gap.last_checked)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  )
}

// ── DeepReadItem (collapsible) ──

function DeepReadItem({ paper }: { paper: DeepReadPaper }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-gray-800 rounded-md p-2.5">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full text-left flex items-start gap-2"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          className={`mt-1 flex-shrink-0 text-gray-600 transition-transform ${expanded ? 'rotate-90' : ''}`}
        >
          <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        </svg>
        <div className="flex-1 min-w-0">
          <span className="text-sm text-accent-purple font-mono">{paper.paper_id}</span>
          <span className="text-xs text-gray-500 block truncate">{paper.relevance_to_us}</span>
        </div>
      </button>

      {expanded && (
        <div className="mt-2 ml-5 space-y-2 text-xs">
          {paper.key_takeaways.length > 0 && (
            <div>
              <span className="text-gray-500 font-medium">Key Takeaways</span>
              <ul className="mt-0.5 space-y-0.5">
                {paper.key_takeaways.map((t, i) => (
                  <li key={i} className="text-gray-400 flex items-start gap-1.5">
                    <span className="text-gray-600 mt-0.5">-</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {paper.useful_techniques.length > 0 && (
            <div>
              <span className="text-gray-500 font-medium">Techniques</span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {paper.useful_techniques.map((t, i) => (
                  <span
                    key={i}
                    className="text-accent-cyan bg-accent-cyan/10 px-1.5 py-0.5 rounded text-[10px]"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {paper.potential_conflicts.length > 0 && (
            <div>
              <span className="text-gray-500 font-medium">Potential Conflicts</span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {paper.potential_conflicts.map((c, i) => (
                  <span
                    key={i}
                    className="text-accent-red bg-accent-red/10 px-1.5 py-0.5 rounded text-[10px]"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Helpers ──

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return dateStr
  }
}
