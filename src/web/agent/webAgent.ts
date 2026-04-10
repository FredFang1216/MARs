/**
 * Lightweight web agent that manages a research session over WebSocket.
 * Handles JSON-RPC methods for chat, commands, and orchestrator interaction.
 */

import { nanoid } from 'nanoid'

import { JsonRpcPeer, JsonRpcError } from '../../acp/jsonrpc'
import type * as Protocol from '../../acp/protocol'
import { loadResearchState } from '../../paper/research-state'
import { listSessions, getSessionDir, getSessionDirById, type SessionMeta } from '../../paper/session'
import { getResearchSummary } from '../../paper/data-queries'
import {
  createEmptySessionState,
  loadSessionState,
  saveSessionState,
} from '../../paper/session-state'
import { DKPLoader } from '../../paper/domain-knowledge/loader'
import { OrchestratorManager } from '../orchestrator/manager'
import { CreationManager } from '../creation/manager'
import { ChatManager } from '../chat/manager'
import { validateAndNormalizeProposal } from '../../paper/proposal/types'

export interface WebAgentOptions {
  cwd: string
}

interface ActiveSession {
  sessionId: string
  projectDir: string
}

export class WebAgent {
  private session: ActiveSession | null = null
  private chatManager: ChatManager | null = null
  private readonly cwd: string

  constructor(
    private readonly peer: JsonRpcPeer,
    private readonly orchestratorManager: OrchestratorManager,
    private readonly creationManager: CreationManager,
    opts: WebAgentOptions,
  ) {
    this.cwd = opts.cwd
    this.registerMethods()
  }

  private registerMethods(): void {
    // ── Lifecycle ──────────────────────────────────────

    this.peer.registerMethod('initialize', () => {
      return {
        protocolVersion: 1,
        agentInfo: {
          name: 'claude-paper-web',
          version: '0.1.0',
        },
        agentCapabilities: {
          loadSession: true,
        },
      }
    })

    // ── Session Management ─────────────────────────────

    this.peer.registerMethod('sessions/list', () => {
      return listSessions()
    })

    this.peer.registerMethod(
      'sessions/new',
      async (params: unknown) => {
        const { topic } = params as { topic: string }
        if (!topic) throw new JsonRpcError(-32602, 'topic is required')

        const projectDir = getSessionDir(topic)

        // Create session-state.json for conversation mode
        if (!loadSessionState(projectDir)) {
          saveSessionState(projectDir, createEmptySessionState())
        }

        // Use the slug from session.json as the stable session ID
        const sessions = listSessions()
        const meta = sessions.find(s => {
          // Compare by ID (directory name) — never re-derive slug from topic
          const dir = getSessionDirById(s.id)
          return dir === projectDir
        })
        const sessionId = meta?.id ?? nanoid()

        this.session = { sessionId, projectDir }
        this.chatManager = new ChatManager(projectDir, sessionId, this.peer)

        return { sessionId, projectDir }
      },
    )

    this.peer.registerMethod(
      'sessions/open',
      async (params: unknown) => {
        const { sessionId } = params as { sessionId: string }
        if (!sessionId) throw new JsonRpcError(-32602, 'sessionId is required')

        const sessions = listSessions()
        const meta = sessions.find(s => s.id === sessionId)
        if (!meta) throw new JsonRpcError(-32602, `Session not found: ${sessionId}`)

        const projectDir = getSessionDirById(meta.id)
        this.session = { sessionId: meta.id, projectDir }
        this.chatManager = new ChatManager(projectDir, meta.id, this.peer)

        const sessionState = loadSessionState(projectDir)
        return {
          sessionId: meta.id,
          projectDir,
          mode: sessionState?.mode ?? meta.mode ?? 'conversation',
        }
      },
    )

    // ── Research State ─────────────────────────────────

    this.peer.registerMethod('research/state', () => {
      this.requireSession()
      const state = loadResearchState(this.session!.projectDir)
      if (!state) throw new JsonRpcError(-32000, 'No research state found')
      return state
    })

    this.peer.registerMethod('research/summary', () => {
      this.requireSession()
      const summary = getResearchSummary(this.session!.projectDir)
      if (!summary) throw new JsonRpcError(-32000, 'No research state found')
      return summary
    })

    // ── Orchestrator Control ───────────────────────────

    this.peer.registerMethod(
      'orchestrator/start',
      async (params: unknown) => {
        this.requireSession()
        const opts = (params as Record<string, unknown>) ?? {}
        const mode = (opts.mode as 'auto' | 'interactive') ?? 'interactive'

        await this.orchestratorManager.start(
          this.session!.projectDir,
          this.session!.sessionId,
          this.peer,
          { mode },
        )

        return { status: 'started' }
      },
    )

    this.peer.registerMethod('orchestrator/stop', () => {
      this.requireSession()
      this.orchestratorManager.stop(this.session!.sessionId)
      return { status: 'stopped' }
    })

    this.peer.registerMethod('orchestrator/status', () => {
      this.requireSession()
      return this.orchestratorManager.getStatus(this.session!.sessionId)
    })

    // ── Decision Response ──────────────────────────────

    this.peer.registerMethod(
      'orchestrator/decide',
      async (params: unknown) => {
        this.requireSession()
        const { choice } = params as { choice: 'approve' | 'edit' | 'skip' }
        if (!choice) throw new JsonRpcError(-32602, 'choice is required')

        this.orchestratorManager.resolveDecision(
          this.session!.sessionId,
          choice,
        )
        return { status: 'resolved' }
      },
    )

    // ── Chat ─────────────────────────────────────────────

    this.peer.registerMethod(
      'chat/send',
      async (params: unknown) => {
        this.requireSession()
        if (!this.chatManager) {
          this.chatManager = new ChatManager(
            this.session!.projectDir,
            this.session!.sessionId,
            this.peer,
          )
        }

        const { message } = params as { message: string }
        if (!message) throw new JsonRpcError(-32602, 'message is required')

        // processMessage runs async — sends WS notifications for progress
        await this.chatManager.processMessage(message)
        return { status: 'ok' }
      },
    )

    this.peer.registerMethod('chat/cancel', () => {
      this.requireSession()
      this.chatManager?.cancel()
      return { status: 'cancelled' }
    })

    this.peer.registerMethod('chat/history', () => {
      this.requireSession()
      if (!this.chatManager) {
        this.chatManager = new ChatManager(
          this.session!.projectDir,
          this.session!.sessionId,
          this.peer,
        )
      }
      return this.chatManager.loadHistory()
    })

    this.peer.registerMethod('session/state', () => {
      this.requireSession()
      const sessionState = loadSessionState(this.session!.projectDir)
      return sessionState ?? createEmptySessionState()
    })

    // ── Knowledge Base ────────────────────────────────────

    this.peer.registerMethod('knowledge/list', () => {
      const loader = new DKPLoader()
      return loader.listAvailablePacks()
    })

    this.peer.registerMethod('knowledge/load', (params: unknown) => {
      this.requireSession()
      const { packId } = params as { packId: string }
      if (!packId) throw new JsonRpcError(-32602, 'packId is required')

      this.ensureChatManager()
      const result = this.chatManager!.loadKnowledgePack(packId)
      if (!result.success) throw new JsonRpcError(-32000, result.error!)

      const sessionState = loadSessionState(this.session!.projectDir)
      this.peer.sendNotification('session/state-changed', { sessionState })
      return { status: 'loaded', packId }
    })

    this.peer.registerMethod('knowledge/unload', () => {
      this.requireSession()
      this.ensureChatManager()
      this.chatManager!.unloadKnowledgePack()

      const sessionState = loadSessionState(this.session!.projectDir)
      this.peer.sendNotification('session/state-changed', { sessionState })
      return { status: 'unloaded' }
    })

    // ── Creation ──────────────────────────────────────────

    this.peer.registerMethod(
      'creation/start-auto',
      async (params: unknown) => {
        const { topic, budget_usd, max_cycles } = params as {
          topic: string
          budget_usd?: number
          max_cycles?: number
        }
        if (!topic) throw new JsonRpcError(-32602, 'topic is required')

        const creationId = await this.creationManager.startAuto(
          topic,
          this.cwd,
          this.peer,
          { budget_usd, max_cycles },
        )
        return { creationId }
      },
    )

    this.peer.registerMethod(
      'creation/start-stepwise',
      async (params: unknown) => {
        const { topic, budget_usd, max_cycles } = params as {
          topic: string
          budget_usd?: number
          max_cycles?: number
        }
        if (!topic) throw new JsonRpcError(-32602, 'topic is required')

        const creationId = await this.creationManager.startStepwise(
          topic,
          this.cwd,
          this.peer,
          { budget_usd, max_cycles },
        )
        return { creationId }
      },
    )

    this.peer.registerMethod(
      'creation/select-proposal',
      async (params: unknown) => {
        const { creationId, proposalId } = params as {
          creationId: string
          proposalId: string
        }
        if (!creationId || !proposalId) {
          throw new JsonRpcError(-32602, 'creationId and proposalId are required')
        }
        this.creationManager.selectProposal(creationId, proposalId)
        return { status: 'selected' }
      },
    )

    this.peer.registerMethod(
      'creation/cancel',
      async (params: unknown) => {
        const { creationId } = params as { creationId: string }
        if (!creationId) throw new JsonRpcError(-32602, 'creationId is required')
        this.creationManager.cancel(creationId)
        return { status: 'cancelled' }
      },
    )

    this.peer.registerMethod(
      'creation/status',
      async (params: unknown) => {
        const { creationId } = params as { creationId: string }
        if (!creationId) throw new JsonRpcError(-32602, 'creationId is required')
        return this.creationManager.getStatus(creationId)
      },
    )

    this.peer.registerMethod(
      'creation/start-from-proposal',
      async (params: unknown) => {
        const { proposal: rawProposal, budget_usd, max_cycles } = params as {
          proposal: unknown
          budget_usd?: number
          max_cycles?: number
        }

        const validated = validateAndNormalizeProposal(rawProposal)
        if ('error' in validated) {
          throw new JsonRpcError(-32602, `Invalid proposal: ${validated.error}`)
        }
        const proposal = validated.proposal

        const creationId = await this.creationManager.startFromProposal(
          proposal,
          this.cwd,
          this.peer,
          { budget_usd, max_cycles },
        )
        return { creationId }
      },
    )

    this.peer.registerMethod(
      'creation/bootstrap',
      async (params: unknown) => {
        this.requireSession()
        const opts = (params as Record<string, unknown>) ?? {}
        const creationId = await this.creationManager.bootstrapFromLiterature(
          this.session!.projectDir,
          this.session!.sessionId,
          this.cwd,
          this.peer,
          {
            budget_usd: opts.budget_usd as number | undefined,
            max_cycles: opts.max_cycles as number | undefined,
          },
        )
        return { creationId }
      },
    )
  }

  private requireSession(): void {
    if (!this.session) {
      throw new JsonRpcError(-32000, 'No active session. Call sessions/open or sessions/new first.')
    }
  }

  private ensureChatManager(): void {
    if (!this.chatManager) {
      this.requireSession()
      this.chatManager = new ChatManager(
        this.session!.projectDir,
        this.session!.sessionId,
        this.peer,
      )
    }
  }

  getSessionId(): string | null {
    return this.session?.sessionId ?? null
  }
}
