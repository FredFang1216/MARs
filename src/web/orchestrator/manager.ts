/**
 * Server-side orchestrator lifecycle manager.
 * Bridges OrchestratorCallbacks → WebSocket JSON-RPC notifications.
 */

import { JsonRpcPeer } from '../../acp/jsonrpc'
import {
  Orchestrator,
  type OrchestratorCallbacks,
  type OrchestratorDecision,
  type ExecutionResult,
} from '../../paper/orchestrator'
import {
  loadResearchState,
  type ResearchState,
} from '../../paper/research-state'
import { executeAgent, executeAgentsParallel } from '../../paper/agent-dispatch'

interface RunningOrchestrator {
  orchestrator: Orchestrator
  sessionId: string
  projectDir: string
  peer: JsonRpcPeer
  status: 'running' | 'paused' | 'stopped' | 'completed' | 'error'
  cycle: number
  phase: string
  decisionResolver: ((choice: 'approve' | 'edit' | 'skip') => void) | null
}

export class OrchestratorManager {
  private readonly running = new Map<string, RunningOrchestrator>()

  /**
   * Start the orchestrator for a session.
   */
  async start(
    projectDir: string,
    sessionId: string,
    peer: JsonRpcPeer,
    opts: { mode: 'auto' | 'interactive' },
  ): Promise<void> {
    // If already running, reattach this peer so notifications flow to the new connection
    if (this.running.has(sessionId)) {
      const existing = this.running.get(sessionId)!
      if (existing.status === 'running') {
        existing.peer = peer
        return
      }
    }

    const state = loadResearchState(projectDir)
    if (!state) {
      throw new Error('No research state found. Run /propose first.')
    }

    const entry: RunningOrchestrator = {
      orchestrator: null as any, // set below
      sessionId,
      projectDir,
      peer,
      status: 'running',
      cycle: 0,
      phase: 'init',
      decisionResolver: null,
    }

    const callbacks: OrchestratorCallbacks = {
      executeAgent: async (
        agentName: string,
        task: string,
        context: string,
      ): Promise<ExecutionResult> => {
        entry.phase = 'executing'
        peer.sendNotification('research/agent_start', {
          sessionId,
          agent: agentName,
          task: task.slice(0, 200),
        })

        const currentState = loadResearchState(projectDir)
        if (!currentState) {
          return {
            success: false,
            agent: agentName,
            summary: 'No research state available',
            artifacts_produced: [],
            new_claims: [],
            new_evidence: [],
            cost_usd: 0,
          }
        }

        const agentProgress = (msg: string) => {
          peer.sendNotification('research/progress', {
            sessionId,
            message: msg,
          })
        }

        const result = await executeAgent(
          agentName,
          task,
          context,
          currentState,
          agentProgress,
          projectDir,
        )

        peer.sendNotification('research/agent_complete', {
          sessionId,
          agent: agentName,
          success: result.success,
          summary: result.summary.slice(0, 200),
        })

        return result
      },

      executeAgentsParallel: async (
        agents: Array<{ agentName: string; task: string; context: string }>,
      ): Promise<ExecutionResult[]> => {
        entry.phase = 'executing'
        const agentNames = agents.map(a => a.agentName).join(', ')
        peer.sendNotification('research/progress', {
          sessionId,
          message: `Dispatching ${agents.length} agents in parallel: ${agentNames}`,
        })

        const currentState = loadResearchState(projectDir)
        if (!currentState) {
          return agents.map(a => ({
            success: false,
            agent: a.agentName,
            summary: 'No research state available',
            artifacts_produced: [],
            new_claims: [],
            new_evidence: [],
            cost_usd: 0,
          }))
        }

        const results = await executeAgentsParallel(
          agents.map(a => ({
            ...a,
            state: currentState,
            onProgress: (msg: string) => {
              peer.sendNotification('research/progress', {
                sessionId,
                agent: a.agentName,
                message: `[${a.agentName}] ${msg}`,
              })
            },
            sessionDir: projectDir,
          })),
        )

        for (const result of results) {
          peer.sendNotification('research/agent_complete', {
            sessionId,
            agent: result.agent,
            success: result.success,
            summary: result.summary.slice(0, 200),
          })
        }

        return results
      },

      presentDecision: async (
        decision: OrchestratorDecision,
        _state: ResearchState,
      ): Promise<'approve' | 'edit' | 'skip'> => {
        entry.phase = 'deciding'

        // In auto mode, approve immediately
        if (opts.mode === 'auto') {
          peer.sendNotification('research/decision_auto', {
            sessionId,
            decision,
            choice: 'approve',
          })
          return 'approve'
        }

        // In interactive mode, send decision to client and wait
        return new Promise<'approve' | 'edit' | 'skip'>(resolve => {
          entry.decisionResolver = resolve
          peer.sendNotification('research/decision_pending', {
            sessionId,
            decision,
          })
        })
      },

      onProgress: (message: string) => {
        peer.sendNotification('research/progress', {
          sessionId,
          message,
        })
      },

      onStateChange: (newState: ResearchState) => {
        entry.cycle = newState.orchestrator_cycle_count
        peer.sendNotification('research/state_update', {
          sessionId,
          cycle: newState.orchestrator_cycle_count,
          stability: newState.stability,
          claimCount: newState.claimGraph.claims.length,
          budget: newState.budget,
        })
      },

      onComplete: (finalState: ResearchState) => {
        entry.status = 'completed'
        entry.phase = 'done'
        peer.sendNotification('research/complete', {
          sessionId,
          cycle: finalState.orchestrator_cycle_count,
          claimCount: finalState.claimGraph.claims.length,
          admittedCount: finalState.claimGraph.claims.filter(
            c => c.phase === 'admitted',
          ).length,
          convergence: finalState.stability.convergenceScore,
        })
      },

      onError: (error: Error) => {
        entry.status = 'error'
        peer.sendNotification('research/error', {
          sessionId,
          error: error.message,
        })
      },
    }

    const orchestrator = Orchestrator.resume(projectDir, callbacks, {
      mode: opts.mode,
    })

    if (!orchestrator) {
      throw new Error('Failed to resume orchestrator — no state found')
    }

    entry.orchestrator = orchestrator
    this.running.set(sessionId, entry)

    // Run in background — don't await
    orchestrator.run().catch(err => {
      entry.status = 'error'
      peer.sendNotification('research/error', {
        sessionId,
        error: err?.message ?? String(err),
      })
    })
  }

  /**
   * Stop the orchestrator for a session.
   */
  stop(sessionId: string): void {
    const entry = this.running.get(sessionId)
    if (!entry) return

    entry.orchestrator.abort()
    entry.status = 'stopped'
    this.running.delete(sessionId)
  }

  /**
   * Resolve a pending decision.
   */
  resolveDecision(
    sessionId: string,
    choice: 'approve' | 'edit' | 'skip',
  ): void {
    const entry = this.running.get(sessionId)
    if (!entry?.decisionResolver) return

    entry.decisionResolver(choice)
    entry.decisionResolver = null
  }

  /**
   * Get orchestrator status for a session.
   */
  getStatus(sessionId: string): {
    running: boolean
    status: string
    cycle: number
    phase: string
    hasPendingDecision: boolean
  } {
    const entry = this.running.get(sessionId)
    if (!entry) {
      return {
        running: false,
        status: 'stopped',
        cycle: 0,
        phase: 'idle',
        hasPendingDecision: false,
      }
    }

    return {
      running: entry.status === 'running',
      status: entry.status,
      cycle: entry.cycle,
      phase: entry.phase,
      hasPendingDecision: entry.decisionResolver !== null,
    }
  }

  /**
   * Re-attach a WebSocket peer (for reconnection).
   */
  reattachPeer(sessionId: string, peer: JsonRpcPeer): void {
    const entry = this.running.get(sessionId)
    if (entry) {
      entry.peer = peer
    }
  }
}
