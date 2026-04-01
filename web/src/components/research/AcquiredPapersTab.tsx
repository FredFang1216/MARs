import { useState, useMemo } from 'react'
import Badge from '../shared/Badge'
import { removePaper } from '../../api/client'
import { useSessionStore } from '../../stores/sessionStore'

interface AcquiredPaper {
  paper: {
    title: string
    authors: string[]
    year: number
    abstract: string
    source: string
    source_id?: string
    arxiv_id?: string
    doi?: string
    citation_count: number
    relevance_score: number
  }
  status: string
  pdf_path?: string
  source_used?: string
}

interface Props {
  papers: AcquiredPaper[]
}

const STATUS_BADGE: Record<string, { variant: string; label: string }> = {
  downloaded: { variant: 'green', label: 'PDF' },
  oa_found: { variant: 'cyan', label: 'OA' },
  abstract_only: { variant: 'yellow', label: 'Abstract' },
  failed: { variant: 'red', label: 'Failed' },
}

export default function AcquiredPapersTab({ papers }: Props) {
  const [filter, setFilter] = useState('')
  const [sortBy, setSortBy] = useState<'relevance' | 'citations' | 'year'>('relevance')
  const currentSessionId = useSessionStore(s => s.currentSessionId)
  const refreshLiteratureArtifacts = useSessionStore(s => s.refreshLiteratureArtifacts)

  const handleRemove = async (sourceId: string) => {
    if (!currentSessionId || !sourceId) return
    try {
      await removePaper(currentSessionId, sourceId)
      await refreshLiteratureArtifacts()
    } catch {
      // Silently fail — user can retry
    }
  }

  const filtered = useMemo(() => {
    const q = filter.toLowerCase()
    let list = papers
    if (q) {
      list = list.filter(p =>
        p.paper.title.toLowerCase().includes(q) ||
        p.paper.abstract?.toLowerCase().includes(q) ||
        p.paper.authors?.some(a => a.toLowerCase().includes(q)),
      )
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'citations') return (b.paper.citation_count ?? 0) - (a.paper.citation_count ?? 0)
      if (sortBy === 'year') return (b.paper.year ?? 0) - (a.paper.year ?? 0)
      return (b.paper.relevance_score ?? 0) - (a.paper.relevance_score ?? 0)
    })
  }, [papers, filter, sortBy])

  // Status summary
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of papers) {
      counts[p.status] = (counts[p.status] ?? 0) + 1
    }
    return counts
  }, [papers])

  return (
    <>
      {/* Summary */}
      <div className="flex flex-wrap gap-2 text-xs text-gray-500 mb-3">
        <span><span className="text-white font-mono">{papers.length}</span> papers</span>
        {Object.entries(statusCounts).map(([status, count]) => {
          const cfg = STATUS_BADGE[status]
          return (
            <span key={status}>
              <span className="text-gray-400 font-mono">{count}</span> {cfg?.label ?? status}
            </span>
          )
        })}
      </div>

      {/* Filter + Sort */}
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          placeholder="Search papers..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="flex-1 bg-surface-2 border border-gray-800 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent-cyan/50"
        />
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as typeof sortBy)}
          className="bg-surface-2 border border-gray-800 rounded-lg px-2 py-1.5 text-xs text-gray-400 focus:outline-none"
        >
          <option value="relevance">Relevance</option>
          <option value="citations">Citations</option>
          <option value="year">Year</option>
        </select>
      </div>

      {/* Paper list */}
      <div className="space-y-1.5">
        {filtered.length === 0 && (
          <div className="text-center py-8 text-gray-600 text-sm">
            {filter ? 'No papers match your search.' : 'No papers.'}
          </div>
        )}
        {filtered.map((item, i) => (
          <PaperRow
            key={item.paper.source_id ?? item.paper.arxiv_id ?? item.paper.doi ?? i}
            item={item}
            onRemove={item.paper.source_id ? () => handleRemove(item.paper.source_id!) : undefined}
          />
        ))}
      </div>
    </>
  )
}

function PaperRow({ item, onRemove }: { item: AcquiredPaper; onRemove?: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [removing, setRemoving] = useState(false)
  const p = item.paper
  const cfg = STATUS_BADGE[item.status] ?? { variant: 'gray', label: item.status }

  const authorStr = p.authors?.length > 3
    ? `${p.authors.slice(0, 3).join(', ')} et al.`
    : p.authors?.join(', ') ?? ''

  return (
    <div className="border border-gray-800 rounded-md group">
      <div className="flex items-start">
        <button
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex-1 text-left p-2.5 flex items-start gap-2 min-w-0"
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
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-200 line-clamp-2 flex-1">{p.title}</span>
              <Badge variant={cfg.variant as any} className="flex-shrink-0">{cfg.label}</Badge>
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
              <span className="truncate max-w-[200px]">{authorStr}</span>
              {p.year > 0 && <span className="font-mono">{p.year}</span>}
              {p.citation_count > 0 && (
                <span className="font-mono text-gray-600">{p.citation_count} cites</span>
              )}
            </div>
          </div>
        </button>
        {onRemove && (
          <button
            onClick={async (e) => {
              e.stopPropagation()
              if (!window.confirm(`Remove "${p.title}"?`)) return
              setRemoving(true)
              try {
                await onRemove()
              } finally {
                setRemoving(false)
              }
            }}
            disabled={removing}
            className="p-2 mt-1.5 mr-1 opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all flex-shrink-0"
            title="Remove paper"
            aria-label="Remove paper"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {expanded && (
        <div className="px-2.5 pb-2.5 ml-5 space-y-2 text-xs">
          {p.abstract && (
            <p className="text-gray-400 leading-relaxed line-clamp-6">{p.abstract}</p>
          )}
          <div className="flex flex-wrap gap-2 text-gray-600">
            {p.arxiv_id && (
              <span className="bg-surface-2 px-1.5 py-0.5 rounded font-mono">
                arXiv:{p.arxiv_id}
              </span>
            )}
            {p.source && (
              <span className="bg-surface-2 px-1.5 py-0.5 rounded">
                {p.source}
              </span>
            )}
            {p.relevance_score > 0 && (
              <span className="flex items-center gap-1">
                Relevance:
                <span className="inline-block w-12 h-1 bg-surface-3 rounded-full">
                  <span
                    className="block h-1 bg-accent-cyan rounded-full"
                    style={{ width: `${Math.round(p.relevance_score * 100)}%` }}
                  />
                </span>
                <span className="font-mono text-gray-500">{Math.round(p.relevance_score * 100)}%</span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
