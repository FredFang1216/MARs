/**
 * Creation pipeline manager for the web UI.
 * Wraps DeepResearchEngine → ProposalGenerator → Orchestrator initialization,
 * streaming progress via WebSocket JSON-RPC notifications.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { nanoid } from 'nanoid'

import { JsonRpcPeer } from '../../acp/jsonrpc'
import { DeepResearchEngine } from '../../paper/deep-research'
import { ProposalGenerator } from '../../paper/proposal/generator'
import { selectBestProposal } from '../../paper/proposal/selector'
import type { Proposal } from '../../paper/proposal/types'
import {
  initializeFromProposal,
  saveResearchState,
} from '../../paper/research-state'
import { syncPlanFromState } from '../../paper/research-plan'
import { refreshScoreboard } from '../../paper/method-scoreboard'
import { probeSystem } from '../../paper/system-probe'
import { DEFAULT_MODEL_ASSIGNMENTS } from '../../paper/types'
import { extractModelId } from '../../paper/agent-dispatch'
import type { OrchestratorManager } from '../orchestrator/manager'

const SESSIONS_DIR_NAME = '.claude-paper-research'
const SESSION_META = 'session.json'
const MAX_PROPOSAL_COUNT = 3
const MAX_REDESIGN_ATTEMPTS = 3

function sanitizeTopic(topic: string): string {
  const slug = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  // Fallback for non-ASCII topics (e.g. Chinese) that produce an empty slug
  if (!slug) return `session-${Date.now().toString(36)}`
  return slug
}

export type CreationPhase =
  | 'deep_research'
  | 'proposals'
  | 'selecting'
  | 'orchestrator_init'
  | 'complete'
  | 'error'
  | 'cancelled'

export interface CreationStatus {
  creationId: string
  phase: CreationPhase
  topic: string
  sessionId: string | null
  proposals: Proposal[]
  selectedProposal: Proposal | null
  error: string | null
}

interface RunningCreation {
  creationId: string
  topic: string
  cwd: string
  peer: JsonRpcPeer
  phase: CreationPhase
  sessionId: string | null
  projectDir: string | null
  proposals: Proposal[]
  selectedProposal: Proposal | null
  error: string | null
  aborted: boolean
  proposalResolver: ((proposal: Proposal) => void) | null
  options: { budget_usd?: number; max_cycles?: number }
}

export class CreationManager {
  private readonly running = new Map<string, RunningCreation>()

  constructor(private readonly orchestratorManager: OrchestratorManager) {}

  /**
   * Start the full auto pipeline: deep research → proposals (auto-select) → init state.
   */
  async startAuto(
    topic: string,
    cwd: string,
    peer: JsonRpcPeer,
    options?: { budget_usd?: number; max_cycles?: number },
  ): Promise<string> {
    const creationId = nanoid()
    const entry = this.createEntry(creationId, topic, cwd, peer, options)
    this.running.set(creationId, entry)

    // Run pipeline in background
    this.runPipeline(entry, 'auto').catch(err => {
      this.handleError(entry, err)
    })

    return creationId
  }

  /**
   * Start stepwise pipeline: deep research → proposals → pause for selection.
   */
  async startStepwise(
    topic: string,
    cwd: string,
    peer: JsonRpcPeer,
    options?: { budget_usd?: number; max_cycles?: number },
  ): Promise<string> {
    const creationId = nanoid()
    const entry = this.createEntry(creationId, topic, cwd, peer, options)
    this.running.set(creationId, entry)

    this.runPipeline(entry, 'stepwise').catch(err => {
      this.handleError(entry, err)
    })

    return creationId
  }

  /**
   * Select a proposal (stepwise mode only).
   */
  selectProposal(creationId: string, proposalId: string): void {
    const entry = this.running.get(creationId)
    if (!entry || entry.phase !== 'selecting' || !entry.proposalResolver) {
      return
    }

    const proposal = entry.proposals.find(p => p.id === proposalId)
    if (!proposal) return

    entry.selectedProposal = proposal
    entry.proposalResolver(proposal)
    entry.proposalResolver = null
  }

  /**
   * Cancel a running creation.
   */
  cancel(creationId: string): void {
    const entry = this.running.get(creationId)
    if (!entry) return
    entry.aborted = true
    entry.phase = 'cancelled'

    // If waiting for proposal selection, resolve with nothing to unblock
    if (entry.proposalResolver) {
      entry.proposalResolver = null
    }
  }

  /**
   * Get status for a creation.
   */
  getStatus(creationId: string): CreationStatus {
    const entry = this.running.get(creationId)
    if (!entry) {
      return {
        creationId,
        phase: 'error',
        topic: '',
        sessionId: null,
        proposals: [],
        selectedProposal: null,
        error: 'Creation not found',
      }
    }

    return {
      creationId: entry.creationId,
      phase: entry.phase,
      topic: entry.topic,
      sessionId: entry.sessionId,
      proposals: entry.proposals,
      selectedProposal: entry.selectedProposal,
      error: entry.error,
    }
  }

  /**
   * Start from an imported Proposal: skip deep research + proposal generation,
   * go straight to orchestrator initialization.
   */
  async startFromProposal(
    proposal: Proposal,
    cwd: string,
    peer: JsonRpcPeer,
    options?: { budget_usd?: number; max_cycles?: number },
  ): Promise<string> {
    const creationId = nanoid()
    const slug = sanitizeTopic(proposal.title)
    const projectDir = join(cwd, SESSIONS_DIR_NAME, slug)
    mkdirSync(projectDir, { recursive: true })

    const entry: RunningCreation = {
      creationId,
      topic: proposal.title,
      cwd,
      peer,
      phase: 'orchestrator_init',
      sessionId: slug,
      projectDir,
      proposals: [proposal],
      selectedProposal: proposal,
      error: null,
      aborted: false,
      proposalResolver: null,
      options: options ?? {},
    }
    this.running.set(creationId, entry)

    this.runFromProposalPipeline(entry, proposal).catch(err => {
      this.handleError(entry, err)
    })

    return creationId
  }

  /**
   * Bootstrap pipeline from existing literature data (skip deep research).
   * For sessions created by CLI that already have literature/ but no state.json.
   */
  async bootstrapFromLiterature(
    projectDir: string,
    sessionId: string,
    cwd: string,
    peer: JsonRpcPeer,
    options?: { budget_usd?: number; max_cycles?: number },
  ): Promise<string> {
    const creationId = nanoid()

    // Read topic from session.json or research-plan.json
    let topic = 'Research'
    const metaPath = join(projectDir, SESSION_META)
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
        topic = meta.topic || topic
      } catch {}
    }
    const planPath = join(projectDir, 'literature', 'research-plan.json')
    if (existsSync(planPath)) {
      try {
        const plan = JSON.parse(readFileSync(planPath, 'utf-8'))
        if (plan.topic) topic = plan.topic
      } catch {}
    }

    const entry: RunningCreation = {
      creationId,
      topic,
      cwd,
      peer,
      phase: 'proposals',
      sessionId,
      projectDir,
      proposals: [],
      selectedProposal: null,
      error: null,
      aborted: false,
      proposalResolver: null,
      options: options ?? {},
    }
    this.running.set(creationId, entry)

    this.runBootstrapPipeline(entry).catch(err => {
      this.handleError(entry, err)
    })

    return creationId
  }

  // ── Internal ──────────────────────────────────────────────

  private createEntry(
    creationId: string,
    topic: string,
    cwd: string,
    peer: JsonRpcPeer,
    options?: { budget_usd?: number; max_cycles?: number },
  ): RunningCreation {
    return {
      creationId,
      topic,
      cwd,
      peer,
      phase: 'deep_research',
      sessionId: null,
      projectDir: null,
      proposals: [],
      selectedProposal: null,
      error: null,
      aborted: false,
      proposalResolver: null,
      options: options ?? {},
    }
  }

  private async generateProposals(
    entry: RunningCreation,
    emit: (msg: string) => void,
  ): Promise<Proposal[]> {
    const modelId = extractModelId(DEFAULT_MODEL_ASSIGNMENTS.research)
    for (let attempt = 1; attempt <= MAX_REDESIGN_ATTEMPTS; attempt++) {
      if (entry.aborted) return []
      try {
        if (attempt > 1) emit(`Redesign attempt ${attempt}/${MAX_REDESIGN_ATTEMPTS}...`)
        const generator = new ProposalGenerator(modelId)
        const proposals = await generator.generate({
          count: MAX_PROPOSAL_COUNT,
          research_dir: entry.projectDir!,
        })
        if (proposals.length > 0) return proposals
        emit(`Attempt ${attempt}: No proposals generated`)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        emit(`Attempt ${attempt} failed: ${msg}`)
      }
    }
    return []
  }

  private async runPipeline(
    entry: RunningCreation,
    mode: 'auto' | 'stepwise',
  ): Promise<void> {
    const { creationId, topic, cwd, peer, options } = entry

    // Create project directory
    const slug = sanitizeTopic(topic)
    const projectDir = join(cwd, SESSIONS_DIR_NAME, slug)
    mkdirSync(projectDir, { recursive: true })
    entry.projectDir = projectDir
    entry.sessionId = slug

    const emit = (message: string) => {
      if (entry.aborted) return
      peer.sendNotification('creation/progress', { creationId, message })
    }

    const setPhase = (phase: CreationPhase) => {
      if (entry.aborted) return
      entry.phase = phase
      peer.sendNotification('creation/phase', { creationId, phase })
    }

    // ── Phase 1: Deep Research ──────────────────────────────
    setPhase('deep_research')
    emit('Starting deep research...')

    try {
      const engine = new DeepResearchEngine(projectDir, { depth: 'standard' })
      const result = await engine.run(topic, emit)
      emit(`Research complete: ${result.papers_found} papers found`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      emit(`Research failed: ${msg}`)
      // Continue — ProposalGenerator can work without research data
    }

    if (entry.aborted) return

    // ── Phase 2: Generate Proposals ─────────────────────────
    setPhase('proposals')
    emit('Generating research proposals...')

    const proposals = await this.generateProposals(entry, emit)
    if (proposals.length === 0) {
      throw new Error(`Failed to generate proposals after ${MAX_REDESIGN_ATTEMPTS} attempts`)
    }

    entry.proposals = proposals
    emit(`Generated ${proposals.length} proposals`)

    // ── Phase 3: Select Proposal ────────────────────────────
    let selectedProposal: Proposal

    if (mode === 'auto') {
      selectedProposal = selectBestProposal(proposals)
      entry.selectedProposal = selectedProposal
      peer.sendNotification('creation/proposal_selected', {
        creationId,
        proposal: selectedProposal,
      })
      emit(`Auto-selected: "${selectedProposal.title}"`)
    } else {
      // Stepwise: send proposals to client and wait for selection
      setPhase('selecting')
      peer.sendNotification('creation/proposals_ready', {
        creationId,
        proposals,
      })
      emit('Waiting for proposal selection...')

      selectedProposal = await new Promise<Proposal>((resolve, reject) => {
        const check = setInterval(() => {
          if (entry.aborted) {
            clearInterval(check)
            reject(new Error('Creation cancelled'))
          }
        }, 500)

        entry.proposalResolver = (p: Proposal) => {
          clearInterval(check)
          resolve(p)
        }
      })

      entry.selectedProposal = selectedProposal
      peer.sendNotification('creation/proposal_selected', {
        creationId,
        proposal: selectedProposal,
      })
      emit(`Selected: "${selectedProposal.title}"`)
    }

    if (entry.aborted) return

    // ── Phase 4: Initialize Research State ──────────────────
    setPhase('orchestrator_init')
    emit('Initializing research state...')

    // Probe system capabilities
    let systemCaps = null
    try {
      systemCaps = await probeSystem()
    } catch {
      emit('System probe failed, proceeding with defaults')
    }

    const state = initializeFromProposal(selectedProposal, {
      budget_usd: options.budget_usd,
      compute: systemCaps,
      literature_db: join(projectDir, 'literature', 'index'),
    })

    saveResearchState(projectDir, state)

    // Sync durable plan files and scoreboard
    try { syncPlanFromState(projectDir, state) } catch { /* non-critical */ }
    try { refreshScoreboard(projectDir, state) } catch { /* non-critical */ }

    // Write session.json so it appears in session list
    const metaPath = join(projectDir, SESSION_META)
    if (!existsSync(metaPath)) {
      const meta = {
        id: slug,
        topic,
        created_at: new Date().toISOString(),
        last_active: new Date().toISOString(),
      }
      writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf-8')
    }

    emit('Research state initialized')

    // ── Complete ────────────────────────────────────────────
    setPhase('complete')
    peer.sendNotification('creation/complete', {
      creationId,
      sessionId: slug,
      projectDir,
    })

    // Clean up after a delay
    setTimeout(() => this.running.delete(creationId), 5 * 60 * 1000)
  }

  /**
   * Bootstrap pipeline: skip deep research, go straight to proposal generation.
   */
  private async runBootstrapPipeline(entry: RunningCreation): Promise<void> {
    const { creationId, peer, options, projectDir } = entry
    if (!projectDir) throw new Error('projectDir is required for bootstrap')

    const emit = (message: string) => {
      if (entry.aborted) return
      peer.sendNotification('creation/progress', { creationId, message })
    }

    const setPhase = (phase: CreationPhase) => {
      if (entry.aborted) return
      entry.phase = phase
      peer.sendNotification('creation/phase', { creationId, phase })
    }

    // Skip Phase 1 (deep research) — literature already exists
    emit('Bootstrapping from existing literature data...')

    // ── Phase 2: Generate Proposals ─────────────────────────
    setPhase('proposals')
    emit('Generating research proposals from existing literature...')

    const proposals = await this.generateProposals(entry, emit)
    if (proposals.length === 0) {
      throw new Error(`Failed to generate proposals after ${MAX_REDESIGN_ATTEMPTS} attempts`)
    }

    entry.proposals = proposals
    emit(`Generated ${proposals.length} proposals`)

    // ── Phase 3: Auto-select best proposal ──────────────────
    const selectedProposal = selectBestProposal(proposals)
    entry.selectedProposal = selectedProposal
    peer.sendNotification('creation/proposal_selected', {
      creationId,
      proposal: selectedProposal,
    })
    emit(`Auto-selected: "${selectedProposal.title}"`)

    if (entry.aborted) return

    // ── Phase 4: Initialize Research State ──────────────────
    setPhase('orchestrator_init')
    emit('Initializing research state...')

    let systemCaps = null
    try {
      systemCaps = await probeSystem()
    } catch {
      emit('System probe failed, proceeding with defaults')
    }

    const state = initializeFromProposal(selectedProposal, {
      budget_usd: options.budget_usd,
      compute: systemCaps,
      literature_db: join(projectDir, 'literature', 'index'),
    })

    saveResearchState(projectDir, state)

    // Sync durable plan files and scoreboard
    try { syncPlanFromState(projectDir, state) } catch { /* non-critical */ }
    try { refreshScoreboard(projectDir, state) } catch { /* non-critical */ }

    emit('Research state initialized')

    // ── Complete ────────────────────────────────────────────
    setPhase('complete')
    peer.sendNotification('creation/complete', {
      creationId,
      sessionId: entry.sessionId,
      projectDir,
    })

    setTimeout(() => this.running.delete(creationId), 5 * 60 * 1000)
  }

  /**
   * Pipeline for imported proposal: skip research + proposal gen,
   * go straight to state initialization.
   */
  private async runFromProposalPipeline(
    entry: RunningCreation,
    proposal: Proposal,
  ): Promise<void> {
    const { creationId, peer, options, projectDir } = entry
    if (!projectDir) throw new Error('projectDir is required')

    const emit = (message: string) => {
      if (entry.aborted) return
      peer.sendNotification('creation/progress', { creationId, message })
    }

    const setPhase = (phase: CreationPhase) => {
      if (entry.aborted) return
      entry.phase = phase
      peer.sendNotification('creation/phase', { creationId, phase })
    }

    setPhase('orchestrator_init')
    emit(`Initializing from imported proposal: "${proposal.title}"`)

    // Notify client of the selected proposal
    peer.sendNotification('creation/proposal_selected', {
      creationId,
      proposal,
    })

    if (entry.aborted) return

    // Probe system capabilities
    let systemCaps = null
    try {
      systemCaps = await probeSystem()
    } catch {
      emit('System probe failed, proceeding with defaults')
    }

    if (entry.aborted) return

    const state = initializeFromProposal(proposal, {
      budget_usd: options.budget_usd,
      compute: systemCaps,
      literature_db: join(projectDir, 'literature', 'index'),
    })

    saveResearchState(projectDir, state)

    // Sync durable plan files and scoreboard
    try { syncPlanFromState(projectDir, state) } catch { /* non-critical */ }
    try { refreshScoreboard(projectDir, state) } catch { /* non-critical */ }

    // Write session.json
    const metaPath = join(projectDir, SESSION_META)
    if (!existsSync(metaPath)) {
      const meta = {
        id: entry.sessionId,
        topic: proposal.title,
        created_at: new Date().toISOString(),
        last_active: new Date().toISOString(),
        imported_proposal: true,
      }
      writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf-8')
    }

    emit('Research state initialized from imported proposal')

    if (entry.aborted) return

    // Complete
    setPhase('complete')
    peer.sendNotification('creation/complete', {
      creationId,
      sessionId: entry.sessionId,
      projectDir,
    })

    setTimeout(() => this.running.delete(creationId), 5 * 60 * 1000)
  }

  private handleError(entry: RunningCreation, err: unknown): void {
    if (entry.aborted) return

    const failedPhase = entry.phase
    const message = err instanceof Error ? err.message : String(err)
    entry.phase = 'error'
    entry.error = message
    entry.peer.sendNotification('creation/error', {
      creationId: entry.creationId,
      error: message,
      phase: failedPhase,
    })

    // Clean up after a delay
    setTimeout(() => this.running.delete(entry.creationId), 5 * 60 * 1000)
  }
}
