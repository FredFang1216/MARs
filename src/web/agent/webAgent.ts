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
import { DeepResearchEngine } from '../../paper/deep-research/index'
import { ProposalGenerator, selectBestProposal } from '../../paper/proposal/index'
import { WritingPipeline } from '../../paper/writing/pipeline'
import { TemplateResolver } from '../../paper/writing/template-resolver'
import { probeSystem } from '../../paper/system-probe'

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
        const { choice, editedDecision } = params as {
          choice: 'approve' | 'edit' | 'skip'
          editedDecision?: { context?: string; delegate_to?: string; targets_claim?: string }
        }
        if (!choice) throw new JsonRpcError(-32602, 'choice is required')

        this.orchestratorManager.resolveDecision(
          this.session!.sessionId,
          choice,
          editedDecision,
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

    // ── Deep Research (standalone) ────────────────────────

    this.peer.registerMethod(
      'research/deep-research',
      async (params: unknown) => {
        this.requireSession()
        const opts = (params ?? {}) as {
          depth?: 'quick' | 'standard' | 'thorough'
          continue_from?: string
          max_papers?: number
        }
        const projectDir = this.session!.projectDir
        const state = loadResearchState(projectDir)
        const topic = state?.proposal?.title ?? 'research'

        const engine = new DeepResearchEngine(projectDir, {
          depth: opts.depth ?? 'standard',
          continue_from: opts.continue_from,
          max_papers: opts.max_papers,
        })

        const emit = (msg: string) => {
          this.peer.sendNotification('research/progress', {
            sessionId: this.session!.sessionId,
            message: `[deep-research] ${msg}`,
          })
        }

        const result = await engine.run(topic, emit)
        return {
          papers_found: result.papers_found,
          papers_acquired: result.papers_acquired,
          survey_path: result.survey_path,
          gaps_path: result.gaps_path,
        }
      },
    )

    // ── Proposal Generation (standalone) ──────────────────

    this.peer.registerMethod(
      'research/generate-proposals',
      async (params: unknown) => {
        this.requireSession()
        const opts = (params ?? {}) as {
          count?: number
          focus?: string
        }
        const projectDir = this.session!.projectDir
        const { extractModelId } = await import('../../paper/agent-dispatch')
        const { DEFAULT_MODEL_ASSIGNMENTS } = await import('../../paper/types')
        const modelId = extractModelId(DEFAULT_MODEL_ASSIGNMENTS.research)

        const generator = new ProposalGenerator(modelId)
        const proposals = await generator.generate({
          count: opts.count ?? 3,
          research_dir: projectDir,
          focus: opts.focus,
        })

        return { proposals }
      },
    )

    // ── Writing Pipeline ─────────────────────────────────

    this.peer.registerMethod(
      'research/write-paper',
      async (params: unknown) => {
        this.requireSession()
        const opts = (params ?? {}) as { templateId?: string }
        const projectDir = this.session!.projectDir
        const state = loadResearchState(projectDir)
        if (!state) throw new JsonRpcError(-32000, 'No research state found')

        const sessionId = this.session!.sessionId
        const pipeline = new WritingPipeline({
          projectDir,
          state,
          templateId: opts.templateId,
          onProgress: (phase, message) => {
            this.peer.sendNotification('research/progress', {
              sessionId,
              message: `[write/${phase}] ${message}`,
            })
          },
        })

        const result = await pipeline.run()
        return {
          success: result.success,
          pdfPath: result.pdfPath,
          warnings: result.warnings,
          phases_completed: result.phases_completed,
        }
      },
    )

    // ── Multi-Model Review ───────────────────────────────

    this.peer.registerMethod(
      'research/review',
      async (params: unknown) => {
        this.requireSession()
        const opts = (params ?? {}) as {
          strength?: 'light' | 'standard' | 'thorough' | 'brutal'
          num_reviewers?: number
        }
        const projectDir = this.session!.projectDir
        const sessionId = this.session!.sessionId
        const state = loadResearchState(projectDir)
        if (!state) throw new JsonRpcError(-32000, 'No research state found')

        // Find the compiled paper text
        const { readFileSync, existsSync } = await import('fs')
        const { join } = await import('path')
        const paperDir = join(projectDir, 'paper')
        const mainTexPath = join(paperDir, 'main.tex')
        if (!existsSync(mainTexPath)) {
          throw new JsonRpcError(-32000, 'No paper found. Run write-paper first.')
        }

        // Collect all tex content
        const mainTex = readFileSync(mainTexPath, 'utf-8')
        const sectionsDir = join(paperDir, 'sections')
        let paperText = mainTex
        if (existsSync(sectionsDir)) {
          const { readdirSync } = await import('fs')
          for (const f of readdirSync(sectionsDir)) {
            if (f.endsWith('.tex')) {
              paperText += '\n\n' + readFileSync(join(sectionsDir, f), 'utf-8')
            }
          }
        }

        const { PaperReviewer } = await import('../../paper/review/reviewer')
        const { MetaReviewer } = await import('../../paper/review/meta-reviewer')
        const { DEFAULT_MODEL_ASSIGNMENTS } = await import('../../paper/types')
        const { extractModelId } = await import('../../paper/agent-dispatch')

        const numReviewers = Math.min(opts.num_reviewers ?? 3, 5)
        const reviewModel = extractModelId(DEFAULT_MODEL_ASSIGNMENTS.review)

        this.peer.sendNotification('research/progress', {
          sessionId,
          message: `[review] Starting ${numReviewers}-reviewer review...`,
        })

        // Run reviews in parallel
        const reviewers = Array.from({ length: numReviewers }, (_, i) =>
          new PaperReviewer(reviewModel, `reviewer-${i + 1}`),
        )
        const config = { strength: opts.strength ?? 'standard' }
        const reports = await Promise.all(
          reviewers.map(r => r.review(paperText, config)),
        )

        this.peer.sendNotification('research/progress', {
          sessionId,
          message: `[review] All ${numReviewers} reviews complete. Synthesizing meta-review...`,
        })

        // Meta-review
        const metaReviewer = new MetaReviewer(reviewModel)
        const metaReview = await metaReviewer.synthesize(reports, config)

        return {
          reviews: reports,
          meta_review: metaReview,
        }
      },
    )

    // ── Delivery Packaging ───────────────────────────────

    this.peer.registerMethod(
      'research/deliver',
      async (params: unknown) => {
        this.requireSession()
        const opts = (params ?? {}) as {
          format?: 'arxiv' | 'camera-ready' | 'standard'
          include_code?: boolean
        }
        const projectDir = this.session!.projectDir
        const { DeliveryPackager } = await import('../../paper/delivery/packager')
        const packager = new DeliveryPackager(projectDir)
        const manifest = await packager.package({
          format: opts.format ?? 'standard',
          include_code: opts.include_code ?? false,
        })
        return manifest
      },
    )

    // ── Templates ────────────────────────────────────────

    this.peer.registerMethod('templates/list', () => {
      const resolver = new TemplateResolver()
      return resolver.listTemplates()
    })

    this.peer.registerMethod(
      'templates/resolve',
      (params: unknown) => {
        const { templateId } = params as { templateId: string }
        if (!templateId) throw new JsonRpcError(-32602, 'templateId is required')
        const resolver = new TemplateResolver()
        const resolved = resolver.resolve(templateId)
        return {
          manifest: resolved.manifest,
          constraints: resolved.constraints,
        }
      },
    )

    // ── System Check ─────────────────────────────────────

    this.peer.registerMethod('system/check', async () => {
      return probeSystem()
    })

    // ── Next Action Recommendation ───────────────────────

    this.peer.registerMethod('research/next-action', async () => {
      this.requireSession()
      const projectDir = this.session!.projectDir
      const state = loadResearchState(projectDir)
      if (!state) throw new JsonRpcError(-32000, 'No research state found')

      const { chatCompletion } = await import('../../paper/llm-client')
      const { DEFAULT_MODEL_ASSIGNMENTS } = await import('../../paper/types')
      const { buildStateContext } = await import('../../paper/research-state')

      const context = buildStateContext(state)
      const response = await chatCompletion({
        modelSpec: DEFAULT_MODEL_ASSIGNMENTS.quick,
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Based on this research state, what is the single most impactful next action?\n\n${context}\n\nRespond in JSON: {"action": "description", "delegate_to": "agent-name", "targets_claim": "claim-id or null", "reasoning": "why this action", "risk": "what could go wrong"}`,
        }],
      })

      try {
        return JSON.parse(response.text)
      } catch {
        return { action: response.text, delegate_to: 'unknown', reasoning: 'Could not parse structured response' }
      }
    })
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
