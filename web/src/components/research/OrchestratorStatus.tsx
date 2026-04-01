import { useRef, useEffect, useState } from 'react'
import { useWsStore } from '../../stores/wsStore'
import { useUiStore } from '../../stores/uiStore'
import * as ws from '../../api/ws'
import Card from '../shared/Card'
import Badge from '../shared/Badge'

interface Props {
  sessionId: string
  progressMessages?: string[]
}

export default function OrchestratorStatus({ sessionId, progressMessages = [] }: Props) {
  const orchestratorStatus = useWsStore(s => s.orchestratorStatus)
  const pendingDecision = useWsStore(s => s.pendingDecision)
  const decidingInFlight = useWsStore(s => s.decidingInFlight)
  const connected = useWsStore(s => s.connected)
  const clearPendingDecision = useWsStore(s => s.clearPendingDecision)
  const setDecidingInFlight = useWsStore(s => s.setDecidingInFlight)
  const setOrchestratorStarted = useWsStore(s => s.setOrchestratorStarted)
  const openInterventionModal = useUiStore(s => s.openInterventionModal)
  const setRightPanelVisible = useUiStore(s => s.setRightPanelVisible)
  const setResearchPanelTab = useUiStore(s => s.setResearchPanelTab)
  const logRef = useRef<HTMLDivElement>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [progressMessages])

  const handleStart = async (mode: string) => {
    setError(null)
    setStarting(true)
    try {
      // Ensure session is opened on this WS connection before starting
      await ws.request('sessions/open', { sessionId })
      await ws.request('orchestrator/start', { mode })
      // Optimistic: immediately switch to running view
      setOrchestratorStarted()
      setRightPanelVisible(true)
      setResearchPanelTab('pipeline')
    } catch (err: any) {
      const msg = err?.message || ''
      if (msg.includes('already running')) {
        // Orchestrator is running from a previous connection — just show running state
        setOrchestratorStarted()
        setRightPanelVisible(true)
        setResearchPanelTab('pipeline')
      } else {
        setError(msg || 'Failed to start orchestrator')
      }
    } finally {
      setStarting(false)
    }
  }

  const handleStop = async () => {
    try {
      await ws.request('orchestrator/stop', {})
    } catch (err: any) {
      setError(err?.message || 'Failed to stop')
    }
  }

  const handleDecision = async (choice: 'approve' | 'edit' | 'skip') => {
    setDecidingInFlight(true)
    setError(null)
    try {
      await ws.request('orchestrator/decide', { choice })
      // Optimistically clear after successful RPC — server notifications will also clear it
      clearPendingDecision()
    } catch (err: any) {
      setDecidingInFlight(false)
      setError(err?.message || 'Failed to send decision')
    }
  }

  if (!orchestratorStatus) {
    const disabled = !connected || starting
    return (
      <Card title="Orchestrator">
        <div className="flex items-center gap-2 mb-3">
          <div className={`w-2.5 h-2.5 rounded-full ${starting ? 'bg-yellow-400 animate-pulse' : connected ? 'bg-gray-600' : 'bg-accent-red'}`} />
          <span className="text-sm text-gray-500">
            {starting ? 'Starting...' : connected ? 'Not started' : 'Disconnected'}
          </span>
        </div>
        {error && (
          <div className="mb-3 px-3 py-2 bg-accent-red/10 border border-accent-red/25 rounded-lg text-xs text-accent-red">
            {error}
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={() => handleStart('interactive')}
            disabled={disabled}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              disabled
                ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                : 'bg-accent-cyan/15 text-accent-cyan hover:bg-accent-cyan/25'
            }`}
          >
            Start Interactive
          </button>
          <button
            onClick={() => handleStart('auto')}
            disabled={disabled}
            className={`flex-1 px-3 py-2 rounded-lg text-sm transition-colors ${
              disabled
                ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                : 'bg-surface-2 text-gray-400 hover:bg-surface-3 hover:text-white'
            }`}
          >
            Start Auto
          </button>
        </div>
      </Card>
    )
  }

  return (
    <Card
      title="Orchestrator"
      glow={!!pendingDecision}
    >
      {/* Status header */}
      <div className="flex items-center gap-2 mb-3">
        {orchestratorStatus.running ? (
          <>
            <div className="w-2.5 h-2.5 rounded-full bg-accent-cyan animate-pulse" />
            <span className="text-sm font-medium text-accent-cyan">Running</span>
          </>
        ) : (
          <>
            <div className="w-2.5 h-2.5 rounded-full bg-gray-600" />
            <span className="text-sm text-gray-500 capitalize">{orchestratorStatus.status}</span>
          </>
        )}
        <span className="text-xs text-gray-600 ml-auto font-mono">
          Cycle {orchestratorStatus.cycle}
        </span>
        <span className="text-xs text-gray-700 font-mono">
          {orchestratorStatus.phase}
        </span>
      </div>

      {/* Controls */}
      {!orchestratorStatus.running ? (
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => handleStart('interactive')}
            className="flex-1 px-3 py-2 bg-accent-cyan/15 text-accent-cyan rounded-lg text-sm font-medium hover:bg-accent-cyan/25 transition-colors"
          >
            Start Interactive
          </button>
          <button
            onClick={() => handleStart('auto')}
            className="flex-1 px-3 py-2 bg-surface-2 text-gray-400 rounded-lg text-sm hover:bg-surface-3 hover:text-white transition-colors"
          >
            Start Auto
          </button>
        </div>
      ) : (
        <div className="mb-3">
          <button
            onClick={handleStop}
            className="px-3 py-1.5 bg-accent-red/15 text-accent-red rounded text-xs hover:bg-accent-red/25 transition-colors"
          >
            Stop Orchestrator
          </button>
        </div>
      )}

      {/* Decision pending */}
      {pendingDecision && (
        <div className="bg-surface-2 rounded-lg p-4 border border-accent-yellow/25 mb-3">
          <div className="flex items-center gap-2 mb-3">
            <Badge variant="yellow" dot>Decision Pending</Badge>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm mb-3">
            <div>
              <span className="text-gray-500 text-xs">Action</span>
              <div className="text-white">{pendingDecision.action?.type}</div>
            </div>
            <div>
              <span className="text-gray-500 text-xs">Agent</span>
              <div className="text-white">{pendingDecision.action?.delegate_to}</div>
            </div>
            <div>
              <span className="text-gray-500 text-xs">Priority</span>
              <div className="text-white capitalize">{pendingDecision.action?.priority}</div>
            </div>
            <div>
              <span className="text-gray-500 text-xs">Est. Cost</span>
              <div className="text-white font-mono">
                ${pendingDecision.action?.estimated_cost_usd?.toFixed(2)}
              </div>
            </div>
          </div>

          {pendingDecision.reasoning && (
            <div className="mb-3">
              <div className="text-xs text-gray-500 mb-1">Reasoning</div>
              <p className="text-sm text-gray-400 leading-relaxed">
                {pendingDecision.reasoning}
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => handleDecision('approve')}
              disabled={decidingInFlight}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                decidingInFlight
                  ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                  : 'bg-accent-green/15 text-accent-green hover:bg-accent-green/25'
              }`}
            >
              {decidingInFlight ? 'Sending...' : 'Approve'}
            </button>
            <button
              onClick={() => handleDecision('skip')}
              disabled={decidingInFlight}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                decidingInFlight
                  ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                  : 'bg-accent-yellow/15 text-accent-yellow hover:bg-accent-yellow/25'
              }`}
            >
              Skip
            </button>
            <button
              onClick={() => openInterventionModal(pendingDecision)}
              disabled={decidingInFlight}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                decidingInFlight
                  ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                  : 'bg-accent-purple/15 text-accent-purple hover:bg-accent-purple/25'
              }`}
            >
              Edit
            </button>
          </div>
        </div>
      )}

      {/* Live progress log */}
      {progressMessages.length > 0 && (
        <div>
          <div className="text-xs text-gray-500 mb-1.5">Live Progress</div>
          <div
            ref={logRef}
            className="bg-surface-0 rounded-lg border border-gray-800 p-2.5 max-h-40 overflow-y-auto font-mono text-xs text-gray-500 space-y-0.5"
          >
            {progressMessages.slice(-30).map((msg, i) => (
              <div key={i} className="py-0.5 leading-snug">
                <span className="text-gray-700 mr-1.5">{String(i + 1).padStart(2, '0')}</span>
                {msg}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
