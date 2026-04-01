import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useSessionStore } from '../stores/sessionStore'
import { useWsStore } from '../stores/wsStore'
import BudgetPanel from '../components/dashboard/BudgetPanel'
import StabilityPanel from '../components/dashboard/StabilityPanel'
import ClaimStats from '../components/dashboard/ClaimStats'
import TrajectoryTimeline from '../components/dashboard/TrajectoryTimeline'
import ExperimentList from '../components/dashboard/ExperimentList'
import OrchestratorPanel from '../components/orchestrator/OrchestratorPanel'

export default function Dashboard() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const { researchState, loading, error, selectSession } = useSessionStore()
  const orchestratorStatus = useWsStore(s => s.orchestratorStatus)

  useEffect(() => {
    if (sessionId) {
      selectSession(sessionId)
    }
  }, [sessionId, selectSession])

  if (loading) {
    return (
      <div className="p-6 text-gray-500">Loading research state...</div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-900/30 border border-red-800 rounded p-3 text-red-300 text-sm">
          {error}
        </div>
      </div>
    )
  }

  if (!researchState) {
    return (
      <div className="p-6 text-gray-500">
        No research state found for this session.
      </div>
    )
  }

  const state = researchState

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">{state.proposal?.title ?? 'Untitled'}</h2>
          <div className="flex gap-3 mt-1 text-sm text-gray-500">
            <span>Type: {state.paper_type}</span>
            <span>Cycle: {state.orchestrator_cycle_count}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            to={`/chat/${sessionId}`}
            className="px-4 py-2 bg-accent-cyan/20 text-accent-cyan rounded hover:bg-accent-cyan/30 text-sm"
          >
            Open Chat
          </Link>
        </div>
      </div>

      {/* Orchestrator status */}
      {orchestratorStatus?.running && (
        <OrchestratorPanel sessionId={sessionId!} />
      )}

      {/* Dashboard grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        <StabilityPanel stability={state.stability} />
        <BudgetPanel budget={state.budget} />
        <ClaimStats claimGraph={state.claimGraph} />
      </div>

      {/* Lower section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <TrajectoryTimeline trajectory={state.trajectory} />
        <ExperimentList sessionId={sessionId!} />
      </div>
    </div>
  )
}
