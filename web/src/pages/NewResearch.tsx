import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useCreationStore } from '../stores/creationStore'
import { useWsStore } from '../stores/wsStore'
import CreationProgress from '../components/creation/CreationProgress'
import ProposalCard from '../components/creation/ProposalCard'

const MAX_PROPOSAL_JSON_SIZE = 100_000

/** Validate proposal JSON string. Uses the same rules as backend. */
function validateProposalJson(text: string): { proposal: any; error: null } | { proposal: null; error: string } {
  if (text.length > MAX_PROPOSAL_JSON_SIZE) {
    return { proposal: null, error: `Proposal JSON too large (max ${MAX_PROPOSAL_JSON_SIZE} bytes)` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { proposal: null, error: 'Invalid JSON' }
  }

  // Validate required fields (mirrors validateAndNormalizeProposal on backend)
  if (!parsed || typeof parsed !== 'object') return { proposal: null, error: 'Must be an object' }
  const p = parsed as Record<string, unknown>
  if (!p.title || typeof p.title !== 'string') return { proposal: null, error: 'Missing "title" (string)' }
  if (!p.abstract || typeof p.abstract !== 'string') return { proposal: null, error: 'Missing "abstract" (string)' }
  if (!p.methodology || typeof p.methodology !== 'string') return { proposal: null, error: 'Missing "methodology" (string)' }
  if (!Array.isArray(p.innovation) || p.innovation.length === 0 || !p.innovation.every((i: unknown) => typeof i === 'string')) {
    return { proposal: null, error: '"innovation" must be a non-empty array of strings' }
  }
  if (!p.feasibility || typeof p.feasibility !== 'object') return { proposal: null, error: 'Missing "feasibility" object' }
  if (!p.risk || typeof p.risk !== 'object') return { proposal: null, error: 'Missing "risk" object' }

  // Backend will do full normalization + defaults — just pass validated object
  return { proposal: parsed, error: null }
}

export default function NewResearch() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const store = useCreationStore()
  const connected = useWsStore(s => s.connected)

  const [topic, setTopic] = useState(searchParams.get('topic') ?? '')
  const [mode, setMode] = useState<'auto' | 'stepwise' | 'import'>('auto')
  const [budgetUsd, setBudgetUsd] = useState('')
  const [maxCycles, setMaxCycles] = useState('')
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null)
  const [proposalJson, setProposalJson] = useState('')
  const [proposalError, setProposalError] = useState<string | null>(null)

  // Subscribe to creation WS notifications
  useEffect(() => {
    const cleanup = store.initListeners()
    return cleanup
  }, [])

  // Reset store on unmount if in terminal state
  useEffect(() => {
    return () => {
      const { phase, reset } = useCreationStore.getState()
      if (phase === 'complete' || phase === 'error' || phase === 'cancelled') {
        reset()
      }
    }
  }, [])

  const handleStart = () => {
    const opts: { budget_usd?: number; max_cycles?: number } = {}
    if (budgetUsd) {
      const parsed = Number(budgetUsd)
      if (Number.isFinite(parsed) && parsed > 0) opts.budget_usd = parsed
    }
    if (maxCycles) {
      const parsed = Number(maxCycles)
      if (Number.isInteger(parsed) && parsed > 0) opts.max_cycles = parsed
    }

    if (mode === 'import') {
      const result = validateProposalJson(proposalJson)
      if (result.error) {
        setProposalError(result.error)
        return
      }
      setProposalError(null)
      store.startFromProposal(result.proposal, opts)
    } else if (mode === 'auto') {
      store.startAuto(topic, opts)
    } else {
      store.startStepwise(topic, opts)
    }
  }

  const handleSelectProposal = () => {
    if (!selectedProposalId) return
    store.selectProposal(selectedProposalId)
  }

  // ── Phase: idle — Input form ──────────────────────────
  if (store.phase === 'idle' || store.phase === 'cancelled') {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold mb-6">New Research</h2>

        {store.phase === 'cancelled' && (
          <div className="bg-yellow-900/30 border border-yellow-800 rounded p-3 mb-4 text-yellow-300 text-sm">
            Previous creation was cancelled.
          </div>
        )}

        <div className="space-y-4">
          {/* Mode */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Mode</label>
            <div className="flex gap-2">
              <button
                onClick={() => setMode('auto')}
                className={`flex-1 px-4 py-2 rounded text-sm border transition-colors ${
                  mode === 'auto'
                    ? 'bg-accent-cyan/20 text-accent-cyan border-accent-cyan/50'
                    : 'bg-surface-1 text-gray-400 border-gray-700 hover:border-gray-600'
                }`}
              >
                Automatic
                <span className="block text-xs mt-0.5 opacity-70">
                  Auto-selects best proposal
                </span>
              </button>
              <button
                onClick={() => setMode('stepwise')}
                className={`flex-1 px-4 py-2 rounded text-sm border transition-colors ${
                  mode === 'stepwise'
                    ? 'bg-accent-cyan/20 text-accent-cyan border-accent-cyan/50'
                    : 'bg-surface-1 text-gray-400 border-gray-700 hover:border-gray-600'
                }`}
              >
                Step-by-step
                <span className="block text-xs mt-0.5 opacity-70">
                  Review & pick proposals
                </span>
              </button>
              <button
                onClick={() => setMode('import')}
                className={`flex-1 px-4 py-2 rounded text-sm border transition-colors ${
                  mode === 'import'
                    ? 'bg-accent-cyan/20 text-accent-cyan border-accent-cyan/50'
                    : 'bg-surface-1 text-gray-400 border-gray-700 hover:border-gray-600'
                }`}
              >
                Import Proposal
                <span className="block text-xs mt-0.5 opacity-70">
                  Start from your own proposal
                </span>
              </button>
            </div>
          </div>

          {/* Topic (for auto/stepwise) or Proposal JSON (for import) */}
          {mode !== 'import' ? (
            <div>
              <label className="block text-sm text-gray-400 mb-1">Research Topic</label>
              <textarea
                value={topic}
                onChange={e => setTopic(e.target.value)}
                placeholder="e.g., Optimal Transport for Generative Flow Matching"
                rows={3}
                className="w-full bg-surface-1 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent-cyan/50"
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm text-gray-400 mb-1">Proposal JSON</label>
              <textarea
                value={proposalJson}
                onChange={e => { setProposalJson(e.target.value); setProposalError(null) }}
                placeholder={'Paste your proposal JSON here. Required fields:\n{\n  "title": "...",\n  "abstract": "...",\n  "methodology": "...",\n  "innovation": ["..."],\n  "feasibility": { "data_required": "...", "compute_estimate": "..." },\n  "risk": { "level": "low|medium|high", "description": "..." }\n}'}
                rows={10}
                className="w-full bg-surface-1 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent-cyan/50 font-mono text-xs"
              />
              {proposalError && (
                <p className="text-red-400 text-xs mt-1">{proposalError}</p>
              )}
            </div>
          )}

          {/* Options */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Budget (USD)</label>
              <input
                type="number"
                value={budgetUsd}
                onChange={e => setBudgetUsd(e.target.value)}
                placeholder="100"
                className="w-full bg-surface-1 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent-cyan/50"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Max Cycles</label>
              <input
                type="number"
                value={maxCycles}
                onChange={e => setMaxCycles(e.target.value)}
                placeholder="50"
                className="w-full bg-surface-1 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent-cyan/50"
              />
            </div>
          </div>

          {/* Connection warning */}
          {!connected && (
            <div className="bg-yellow-900/30 border border-yellow-800 rounded p-3 text-yellow-300 text-sm">
              WebSocket disconnected. Make sure the backend server is running (
              <code className="text-yellow-200">bun run web:serve</code>).
            </div>
          )}

          {/* Start button */}
          <button
            onClick={handleStart}
            disabled={
              !connected ||
              (mode === 'import' ? !proposalJson.trim() : !topic.trim())
            }
            className="w-full px-4 py-2.5 bg-accent-cyan/20 text-accent-cyan rounded-lg text-sm font-medium hover:bg-accent-cyan/30 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {!connected
              ? 'Waiting for connection...'
              : mode === 'import'
                ? 'Start from Proposal'
                : 'Start Research'}
          </button>
        </div>
      </div>
    )
  }

  // ── Phase: selecting — Proposal selection (stepwise) ───
  if (store.phase === 'selecting') {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold mb-2">Select a Proposal</h2>
        <p className="text-sm text-gray-400 mb-4">
          {store.proposals.length} proposals generated. Click one to select, then confirm.
        </p>

        <CreationProgress
          phase={store.phase}
          progress={store.progress}
          onCancel={() => store.cancel()}
        />

        <div className="grid gap-3 mt-4">
          {store.proposals.map(proposal => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              selected={selectedProposalId === proposal.id}
              onClick={() => setSelectedProposalId(proposal.id)}
            />
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={handleSelectProposal}
            disabled={!selectedProposalId}
            className="px-6 py-2 bg-accent-cyan/20 text-accent-cyan rounded text-sm font-medium hover:bg-accent-cyan/30 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirm Selection
          </button>
          <button
            onClick={() => store.cancel()}
            className="px-4 py-2 bg-surface-2 text-gray-400 rounded text-sm hover:bg-surface-3"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // ── Phase: complete — Success ─────────────────────────
  if (store.phase === 'complete') {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-accent-green/20 flex items-center justify-center">
            <span className="text-2xl text-accent-green">{'\u2713'}</span>
          </div>
          <h2 className="text-2xl font-bold mb-2">Research Session Created</h2>
          {store.selectedProposal && (
            <p className="text-sm text-gray-400 mb-1">
              &ldquo;{store.selectedProposal.title}&rdquo;
            </p>
          )}
          <p className="text-xs text-gray-500 mb-6">
            Session ID: {store.resultSessionId}
          </p>

          <div className="flex gap-3 justify-center">
            <button
              onClick={() => {
                const sid = store.resultSessionId
                store.reset()
                navigate(`/dashboard/${sid}`)
              }}
              className="px-6 py-2 bg-accent-cyan/20 text-accent-cyan rounded text-sm font-medium hover:bg-accent-cyan/30"
            >
              Go to Dashboard
            </button>
            <button
              onClick={() => {
                const sid = store.resultSessionId
                store.reset()
                navigate(`/chat/${sid}`)
              }}
              className="px-6 py-2 bg-surface-2 text-gray-300 rounded text-sm hover:bg-surface-3"
            >
              Open Chat
            </button>
          </div>
        </div>

        <CreationProgress
          phase={store.phase}
          progress={store.progress}
          onCancel={() => {}}
        />
      </div>
    )
  }

  // ── Phase: error — Error display ──────────────────────
  if (store.phase === 'error') {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold mb-4">Creation Failed</h2>

        <div className="bg-red-900/30 border border-red-800 rounded p-4 mb-4 text-red-300 text-sm">
          {store.error}
        </div>

        <CreationProgress
          phase={store.phase}
          progress={store.progress}
          onCancel={() => {}}
        />

        <div className="mt-4">
          <button
            onClick={() => store.reset()}
            className="px-6 py-2 bg-accent-cyan/20 text-accent-cyan rounded text-sm font-medium hover:bg-accent-cyan/30"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  // ── Phase: deep_research / proposals / orchestrator_init — Progress ───
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">Creating Research Session</h2>
      <p className="text-sm text-gray-400 mb-4">
        Topic: <span className="text-white">{topic || store.progress[0] || '...'}</span>
      </p>

      <CreationProgress
        phase={store.phase}
        progress={store.progress}
        onCancel={() => store.cancel()}
      />
    </div>
  )
}
