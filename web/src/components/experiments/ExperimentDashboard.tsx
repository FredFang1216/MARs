import { useEffect, useMemo, useState } from 'react'
import { useExperimentStore } from '../../stores/experimentStore'
import ExperimentDashboardHeader from './ExperimentDashboardHeader'
import ExperimentDetailView from './ExperimentDetailView'
import PurposeGroupedView from './PurposeGroupedView'
import ExperimentSummaryRow from './ExperimentSummaryRow'
import MarkdownViewer from '../shared/MarkdownViewer'
import Card from '../shared/Card'
import type { ExperimentLogEntry, ExperimentNoteSummary } from './types'

interface Props {
  sessionId: string
}

export default function ExperimentDashboard({ sessionId }: Props) {
  const experiments = useExperimentStore(s => s.experiments)
  const summaries = useExperimentStore(s => s.summaries)
  const selectedId = useExperimentStore(s => s.selectedExperimentId)
  const detail = useExperimentStore(s => s.experimentDetail)
  const note = useExperimentStore(s => s.experimentNote)
  const detailLoading = useExperimentStore(s => s.detailLoading)
  const groupBy = useExperimentStore(s => s.groupBy)
  const filterStatus = useExperimentStore(s => s.filterStatus)
  const journalContent = useExperimentStore(s => s.journalContent)

  const loadExperiments = useExperimentStore(s => s.loadExperiments)
  const loadSummaries = useExperimentStore(s => s.loadSummaries)
  const selectExperiment = useExperimentStore(s => s.selectExperiment)
  const clearSelection = useExperimentStore(s => s.clearSelection)
  const setGroupBy = useExperimentStore(s => s.setGroupBy)
  const setFilterStatus = useExperimentStore(s => s.setFilterStatus)
  const loadJournal = useExperimentStore(s => s.loadJournal)

  const [showJournal, setShowJournal] = useState(false)

  useEffect(() => {
    loadExperiments(sessionId)
    loadSummaries(sessionId)
  }, [sessionId, loadExperiments, loadSummaries])

  const handleSelect = (id: string) => {
    selectExperiment(sessionId, id)
  }

  const handleJournalClick = () => {
    if (!journalContent) loadJournal(sessionId)
    setShowJournal(true)
  }

  // Journal view
  if (showJournal) {
    return (
      <div className="space-y-3">
        <button
          onClick={() => setShowJournal(false)}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-white transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M8 2L3 6l5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Back to experiments
        </button>
        <Card title="Research Journal">
          {journalContent ? (
            <div className="prose-sm">
              <MarkdownViewer content={journalContent} />
            </div>
          ) : (
            <div className="text-center py-8 text-gray-600 text-sm">
              No journal entries yet.
            </div>
          )}
        </Card>
      </div>
    )
  }

  // Detail view
  if (selectedId) {
    if (detailLoading) {
      return (
        <div className="flex items-center justify-center py-16">
          <svg className="animate-spin h-5 w-5 text-gray-500" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
      )
    }
    if (detail) {
      return (
        <ExperimentDetailView
          sessionId={sessionId}
          detail={detail}
          note={note}
          onBack={clearSelection}
        />
      )
    }
  }

  // Empty state
  if (experiments.length === 0) {
    return (
      <div className="text-center py-16 text-gray-600 text-sm">
        <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-surface-2 flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M3 9h12M9 3v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
          </svg>
        </div>
        <p>No experiments yet.</p>
        <p className="text-gray-700 text-xs mt-1">
          Experiments will appear as the pipeline runs probes and full experiments.
        </p>
      </div>
    )
  }

  // List view
  return (
    <div className="space-y-4">
      <ExperimentDashboardHeader
        experiments={experiments}
        groupBy={groupBy}
        filterStatus={filterStatus}
        onGroupByChange={setGroupBy}
        onFilterChange={setFilterStatus}
        onJournalClick={handleJournalClick}
      />

      {groupBy === 'purpose' && summaries.length > 0 ? (
        <PurposeGroupedView
          summaries={summaries}
          experiments={experiments}
          filterStatus={filterStatus}
          onSelect={handleSelect}
        />
      ) : (
        <ChronologicalList
          experiments={experiments}
          summaries={summaries}
          filterStatus={filterStatus}
          groupBy={groupBy}
          onSelect={handleSelect}
        />
      )}
    </div>
  )
}

// Simple chronological / claim-grouped list
function ChronologicalList({
  experiments,
  summaries,
  filterStatus,
  groupBy,
  onSelect,
}: {
  experiments: ExperimentLogEntry[]
  summaries: ExperimentNoteSummary[]
  filterStatus: string | null
  groupBy: string
  onSelect: (id: string) => void
}) {
  const summaryMap = useMemo(() => {
    const m = new Map<string, ExperimentNoteSummary>()
    for (const s of summaries) m.set(s.id, s)
    return m
  }, [summaries])

  const filtered = useMemo(() => {
    let list = [...experiments]
    if (filterStatus) list = list.filter(e => e.status === filterStatus)
    return list
  }, [experiments, filterStatus])

  const claimGroups = useMemo(() => {
    if (groupBy !== 'claim') return null
    const map = new Map<string, ExperimentLogEntry[]>()
    for (const e of filtered) {
      const claim = e.targets_claim || 'No claim'
      const list = map.get(claim) ?? []
      list.push(e)
      map.set(claim, list)
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [filtered, groupBy])

  // Claim grouping
  if (claimGroups) {
    return (
      <div className="space-y-4">
        {claimGroups.map(([claim, items]) => (
          <div key={claim}>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
              {claim}
              <span className="text-gray-600 font-mono ml-1.5">{items.length}</span>
            </div>
            <div className="space-y-1.5">
              {items.map(e => {
                const s = summaryMap.get(e.id)
                return s ? (
                  <ExperimentSummaryRow key={e.id} summary={s} logEntry={e} onSelect={onSelect} />
                ) : (
                  <FallbackRow key={e.id} experiment={e} onSelect={onSelect} />
                )
              })}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // Chronological (default fallback)
  return (
    <div className="space-y-1.5">
      {filtered.map(e => {
        const s = summaryMap.get(e.id)
        return s ? (
          <ExperimentSummaryRow key={e.id} summary={s} logEntry={e} onSelect={onSelect} />
        ) : (
          <FallbackRow key={e.id} experiment={e} onSelect={onSelect} />
        )
      })}
      {filtered.length === 0 && (
        <div className="text-center py-8 text-gray-600 text-sm">
          No experiments match this filter.
        </div>
      )}
    </div>
  )
}

// Minimal row when no summary is available
function FallbackRow({ experiment, onSelect }: { experiment: ExperimentLogEntry; onSelect: (id: string) => void }) {
  return (
    <button
      onClick={() => onSelect(experiment.id)}
      className="w-full text-left p-3 border border-gray-800 rounded-md hover:border-gray-700 hover:bg-surface-2/50 transition-colors"
    >
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
          experiment.status === 'completed' ? 'bg-accent-green' :
          experiment.status === 'running' ? 'bg-yellow-400 animate-pulse' :
          experiment.status === 'failed' ? 'bg-accent-red' : 'bg-gray-600'
        }`} />
        <span className="text-xs font-mono text-gray-500">{experiment.id}</span>
        <span className="text-[10px] text-gray-600 font-mono">T{experiment.tier}</span>
        <span className="text-xs text-gray-600">{experiment.status}</span>
      </div>
      <p className="text-sm text-gray-300 mt-1 line-clamp-2">{experiment.purpose}</p>
    </button>
  )
}
