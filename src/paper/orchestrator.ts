import { randomUUID } from 'crypto'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from 'fs'
import { join } from 'path'
import { FragmentStore, type FragmentType } from './fragment-store'
import { BibTeXManager } from './writing/bibtex-manager'
import type { Proposal } from './proposal/types'
import type {
  ResearchState,
  TrajectoryEntry,
  SystemCapabilities,
  PaperType,
  DeepReadPaper,
  KnownResult,
  ConfirmedGap,
  ProofRecord,
  AssumptionGap,
  ArtifactEntry,
  StabilityMetrics,
} from './research-state'
import {
  initializeFromProposal,
  enrichStateWithLLM,
  addTrajectoryEntry,
  recordSpending,
  saveResearchState,
  loadResearchState,
  buildStateContext,
  isBudgetLow,
  createEmptyStability,
  getUnresolvedClaims,
  getAdmittedClaims,
} from './research-state'
import { ClaimGraph, type ClaimInput } from './claim-graph/index'
import { syncPlanFromState } from './research-plan'
import { createDecisionArtifact, recordDecision } from './decision-artifact'
import { refreshScoreboard } from './method-scoreboard'
import type {
  ClaimType,
  ClaimPhase,
  EpistemicLayer,
  EvidenceStrengthType,
} from './claim-graph/types'
import { EvidencePoolManager } from './evidence-pool'
import { chatCompletion } from './llm-client'
import { DEFAULT_MODEL_ASSIGNMENTS, type ResearchStance } from './types'
import {
  ProofBudgetController,
  type ProofBudgetDecision,
  type TheoremSpec,
} from './proof-budget'
import { MathReasoningController } from './math-reasoning-controller'
import type { ProofContext } from './math-reasoning-controller'
import { ResourceEstimator } from './experiment/resource-estimator'
import { DataAcquisition } from './experiment/data-acquisition'
import { BudgetTracker, type BudgetCategory } from './budget-tracker'
import { addArtifact } from './research-state'
import { PromptAssembler } from './claim-graph/prompt-assembler'
import type {
  BuilderOutput,
  SkepticOutput,
  ArbiterOutput,
} from './claim-graph/triple-role-types'
import { canAdmit } from './admission-gate'
import { repairTruncatedJSON, parseTripleRoleOutput } from './json-repair'
import { ConvergenceDetector } from './convergence'
import { truncate, truncateToTokens } from './claim-graph/token-utils'
import { DKPLoader } from './domain-knowledge/loader'
import { initAgentDKP } from './agent-dispatch'
import { WritingPipeline } from './writing/pipeline'
import {
  determineEffort,
  type EffortLevel,
  type EffortDecision,
} from './effort-controller'
import { ExperimentLogManager } from './experiments/experiment-log'
import { ExperimentResultsReader } from './experiments/results-reader'
import { ExperimentAuditor } from './experiments/auditor'
import { ExperimentNotebook } from './experiments/notebook'
import { ResearchJournal } from './experiments/journal'
import { CreateExperiment } from './experiments/create-experiment'
import { ExperimentPromoter } from './experiments/promoter'
import type {
  ExperimentNoteSummary,
  ExperimentLogEntry,
  ClaimDelta as JournalClaimDelta,
  DashboardData,
  ExperimentPlan,
} from './experiments/types'
import { summarizeExperimentPlan } from './experiments/plan-generator'
import { PlanExecutor } from './experiments/plan-executor'
import { ExperimentEvidenceConverter } from './experiments/evidence-converter'

// ── Types ────────────────────────────────────────────────

export interface OrchestratorDecision {
  reasoning: string
  action: {
    type: string // free-form description
    delegate_to: string // agent name
    context: string // what to tell the agent
    model_preference: string
    estimated_cost_usd: number
    priority: 'urgent' | 'high' | 'normal' | 'low'
    if_this_fails: string
    targets_claim?: string
    related_claims?: string[]
    experiment_tier?: 1 | 2
  }
}

/** @deprecated Replaced by Builder phase in Step 6. Kept for type export compatibility. */
export interface ReflectionResult {
  overall_progress: string
  biggest_uncertainty: string
  should_check_literature: boolean
  literature_query: string | null
  recent_results_impact: string
  story_coherence: string
  risk_assessment: string
  budget_advice: string
  recommended_focus: string
}

export interface LiteratureFinding {
  paper_id: string
  title: string
  url?: string
  abstract?: string
  downloaded_path?: string
}

export interface KnownResultFinding {
  statement: string
  source: string
  confidence: number
  directly_usable: boolean
}

export interface CitationFinding {
  key: string
  bibtex?: string
}

export interface ExecutionResult {
  success: boolean
  agent: string
  summary: string
  artifacts_produced: string[]
  new_claims: Array<{
    type?: ClaimType
    epistemicLayer?: EpistemicLayer
    statement: string
    confidence?: number
    evidenceType?: EvidenceStrengthType
    vulnerabilityScore?: number
  }>
  new_evidence: Array<{
    claim_statement?: string
    kind: 'grounded' | 'derived'
    method?: string
    source_ref?: string
  }>
  /** Literature findings from investigator/research agents */
  literature_findings?: {
    papers_found: LiteratureFinding[]
    known_results: KnownResultFinding[]
    citations: CitationFinding[]
  }
  cost_usd: number
}

export interface OrchestratorCallbacks {
  /** Execute an agent task */
  executeAgent: (
    agentName: string,
    task: string,
    context: string,
  ) => Promise<ExecutionResult>

  /** Execute multiple independent agents in parallel (optional; falls back to sequential) */
  executeAgentsParallel?: (
    agents: Array<{ agentName: string; task: string; context: string }>,
  ) => Promise<ExecutionResult[]>

  /** Present a decision to the user for approval (interactive mode) */
  presentDecision: (
    decision: OrchestratorDecision,
    state: ResearchState,
  ) => Promise<'approve' | 'edit' | 'skip'>

  /** Report progress */
  onProgress: (message: string) => void

  /** Report state change */
  onStateChange: (state: ResearchState) => void

  /** Called when orchestrator finishes */
  onComplete: (state: ResearchState) => void

  /** Called on error */
  onError: (error: Error) => void
}

export interface OrchestratorOptions {
  mode: 'auto' | 'interactive'
  budget_usd?: number
  max_cycles?: number
  paper_type?: PaperType
  compute?: SystemCapabilities | null
  rigor_level?: 1 | 2 | 3
  research_stance?: ResearchStance
  experiment_plan?: ExperimentPlan
}

const MAX_CONSECUTIVE_REDESIGNS = 3
const MAX_REFORMULATIONS_PER_CLAIM = 3

// repairTruncatedJSON and parseTripleRoleOutput imported from ./json-repair

// ── LLM Digest Types ────────────────────────────────────

interface LLMDigestResult {
  literature_updates: {
    new_known_results: {
      statement: string
      source: string
      confidence: number
      directly_usable: boolean
    }[]
    new_confirmed_gaps: {
      description: string
      evidence: string
      last_checked: string
    }[]
    papers_to_deeply_read: {
      paper_id: string
      key_takeaways: string[]
      relevance_to_us: string
      useful_techniques: string[]
      potential_conflicts: string[]
    }[]
    papers_to_mark_aware: {
      paper_id: string
      title: string
      why_relevant: string
    }[]
  }
  theory_updates: {
    new_proofs: {
      theorem_statement: string
      proof_status: 'not_started' | 'sketch' | 'draft' | 'rigorous' | 'verified'
      assumptions: string[]
      rigor_level: 'informal' | 'semi_formal' | 'formal'
      fragment_path: string | null
      assumption_reality_gaps: {
        assumption: string
        experimental_reality: string
        gap_severity: 'negligible' | 'minor' | 'significant' | 'critical'
      }[]
    }[]
    updated_proofs: {
      id: string
      proof_status?:
        | 'not_started'
        | 'sketch'
        | 'draft'
        | 'rigorous'
        | 'verified'
      new_assumption_reality_gaps?: {
        assumption: string
        experimental_reality: string
        gap_severity: 'negligible' | 'minor' | 'significant' | 'critical'
      }[]
    }[]
  }
  paper_type_adjustment: {
    new_paper_type: PaperType
    reasoning: string
  } | null
}

// ── Orchestrator ─────────────────────────────────────────

export class Orchestrator {
  private state: ResearchState
  private projectDir: string
  private callbacks: OrchestratorCallbacks
  private options: OrchestratorOptions
  private aborted = false
  private consecutiveRedesigns = 0
  private consecutiveReformulations = 0
  private recentRedesignReasonings: string[] = []
  private budgetTracker: BudgetTracker
  private fragmentStore: FragmentStore
  private lastProofBudget: ProofBudgetDecision | null = null
  private rigorLevel: number
  private promptAssembler: PromptAssembler
  private convergenceDetector: ConvergenceDetector
  private dkpLoader: DKPLoader | null = null
  private previousStability: StabilityMetrics | null = null
  private experimentLog: ExperimentLogManager
  private experimentResults: ExperimentResultsReader
  private experimentAuditor: ExperimentAuditor
  private notebook: ExperimentNotebook
  private journal: ResearchJournal
  private createExperiment: CreateExperiment
  private experimentPromoter: ExperimentPromoter
  private researchStance: ResearchStance
  private planExecutor: PlanExecutor | null = null
  private evidenceConverter: ExperimentEvidenceConverter
  private lastCreatedExperimentId: string | null = null
  private lastCreatedExperimentDir: string | null = null
  private lastEffortLevels: {
    builder: EffortLevel
    skeptic: EffortLevel
    arbiter: EffortLevel
    escalation_reasons: string[]
  } | null = null

  constructor(
    projectDir: string,
    state: ResearchState,
    callbacks: OrchestratorCallbacks,
    options: OrchestratorOptions,
  ) {
    this.projectDir = projectDir
    this.state = state
    this.callbacks = callbacks
    this.options = options
    this.budgetTracker = new BudgetTracker({
      limitUSD: options.budget_usd ?? state.budget.total_usd ?? undefined,
      warnAtPercent: 20,
      onWarning: (msg: string) => callbacks.onProgress(msg),
    })
    // Seed with already-spent amount from state
    if (state.budget.spent_usd > 0) {
      this.budgetTracker.recordCost(state.budget.spent_usd, 'other')
    }
    // Initialize fragment store
    this.fragmentStore = new FragmentStore(projectDir)
    this.fragmentStore.init()

    // Load rigor level and research stance
    this.rigorLevel = options.rigor_level ?? 2
    this.researchStance = options.research_stance ?? 'standard'

    // Initialize DKP loader if knowledge packs are configured
    this.dkpLoader = this.initDKPLoader(state)

    // Initialize prompt assembler for triple-role phases
    const graph = ClaimGraph.fromJSON(state.claimGraph)
    const pool = new EvidencePoolManager(state.evidencePool)
    this.promptAssembler = new PromptAssembler(
      graph,
      pool,
      state,
      this.rigorLevel,
      this.dkpLoader ?? undefined,
      this.researchStance,
    )
    this.convergenceDetector = new ConvergenceDetector()

    // Initialize experiment system
    this.experimentLog = new ExperimentLogManager(this.projectDir)
    this.experimentResults = new ExperimentResultsReader(
      this.projectDir,
      this.experimentLog,
    )
    this.experimentAuditor = new ExperimentAuditor(this.projectDir)
    this.notebook = new ExperimentNotebook(this.projectDir)
    this.journal = new ResearchJournal(this.projectDir)
    this.createExperiment = new CreateExperiment(this.projectDir)
    this.experimentPromoter = new ExperimentPromoter(this.projectDir)

    // Initialize plan executor if an experiment plan exists
    if (state.experiment_plan) {
      this.planExecutor = new PlanExecutor(this.projectDir, state.experiment_plan)
    }

    // Initialize experiment evidence converter
    this.evidenceConverter = new ExperimentEvidenceConverter()
  }

  /**
   * Initialize from a proposal (used when starting a new research project).
   */
  static fromProposal(
    projectDir: string,
    proposal: Proposal,
    callbacks: OrchestratorCallbacks,
    options: OrchestratorOptions,
  ): Orchestrator {
    const state = initializeFromProposal(proposal, {
      budget_usd: options.budget_usd,
      paper_type: options.paper_type,
      compute: options.compute,
    })
    // Attach experiment plan if provided
    if (options.experiment_plan) {
      state.experiment_plan = options.experiment_plan
    }
    return new Orchestrator(projectDir, state, callbacks, options)
  }

  /**
   * Resume from a saved state.
   */
  static resume(
    projectDir: string,
    callbacks: OrchestratorCallbacks,
    options: OrchestratorOptions,
  ): Orchestrator | null {
    const state = loadResearchState(projectDir)
    if (!state) return null
    return new Orchestrator(projectDir, state, callbacks, options)
  }

  getState(): ResearchState {
    return this.state
  }

  abort(): void {
    this.aborted = true
  }

  /**
   * Main orchestration loop: builder → skeptic → arbiter → execute → digest
   */
  async run(): Promise<ResearchState> {
    const maxCycles = this.options.max_cycles ?? 100

    if (!this.state.initialized) {
      throw new Error('ResearchState not initialized. Use fromProposal().')
    }

    this.callbacks.onProgress('Orchestrator started')

    // Initialize DKP loader for agent-dispatch module so agents can use DK tools
    initAgentDKP(this.state)

    // Enrich initial state with LLM-derived claims
    if (this.state.orchestrator_cycle_count === 0) {
      this.callbacks.onProgress('Enriching initial cognitive state via LLM...')
      const enrichResult = await enrichStateWithLLM(this.state)
      if (enrichResult.error) {
        this.callbacks.onProgress(
          `Warning: LLM enrichment failed: ${enrichResult.error} — using template cognitive state`,
        )
      } else {
        this.state = enrichResult.state
        this.callbacks.onProgress(
          `Cognitive state enriched: ${this.state.claimGraph.claims.length} claims, readiness: ${this.state.stability.paperReadiness}`,
        )
      }

      // Pre-fetch datasets from experiment plan
      if (this.planExecutor) {
        this.callbacks.onProgress('Pre-fetching experiment datasets...')
        try {
          const { downloaded, failed } = await this.planExecutor.prefetchData(
            msg => this.callbacks.onProgress(`  [data] ${msg}`),
          )
          this.callbacks.onProgress(
            `Data pre-fetch complete: ${downloaded} downloaded, ${failed} failed`,
          )
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          this.callbacks.onProgress(
            `Data pre-fetch failed: ${msg} — experiments will download data on demand`,
          )
        }
      }
    }

    while (!this.isDone() && !this.aborted) {
      if (this.state.orchestrator_cycle_count >= maxCycles) {
        this.callbacks.onProgress(
          `Max cycles (${maxCycles}) reached. Stopping.`,
        )
        break
      }

      const cycleNum = this.state.orchestrator_cycle_count + 1

      try {
        // Update prompt assembler with latest state
        const graph = ClaimGraph.fromJSON(this.state.claimGraph)
        const pool = new EvidencePoolManager(this.state.evidencePool)
        this.promptAssembler.update(
          graph,
          pool,
          this.state,
          this.rigorLevel,
          undefined,
          this.researchStance,
        )

        // 1. Builder phase: propose narrative + claims + next actions
        this.callbacks.onProgress(`Builder phase (cycle ${cycleNum})...`)
        const builderOutput = await this.builderPhase()

        // 2. Add Builder's proposed claims to the graph
        const builderClaimIds = this.addBuilderClaimsToGraph(
          builderOutput,
          graph,
        )

        // Update state with new claims before Skeptic sees them
        this.state = {
          ...this.state,
          claimGraph: graph.toJSON(),
        }
        this.promptAssembler.update(
          graph,
          pool,
          this.state,
          this.rigorLevel,
          undefined,
          this.researchStance,
        )

        // 3. Skeptic phase: challenge the Builder's proposals
        this.callbacks.onProgress(`Skeptic phase (cycle ${cycleNum})...`)
        let skepticOutput: SkepticOutput
        try {
          skepticOutput = await this.skepticPhase(builderOutput)
        } catch (skepticErr: any) {
          // Graceful degradation: if skeptic fails, continue with empty challenges
          this.callbacks.onProgress(
            `Skeptic phase failed: ${skepticErr.message?.slice(0, 200)} — continuing with no challenges`,
          )
          skepticOutput = {
            internal_inconsistencies: [],
            bridge_gaps: [],
            evidence_inflation: [],
            theorem_overreach: [],
            top3_collapse_points: [],
            admission_denials: [],
          }
        }

        // 4. Arbiter phase: synthesize Builder + Skeptic, decide
        this.callbacks.onProgress(`Arbiter phase (cycle ${cycleNum})...`)
        const arbiterOutput = await this.arbiterPhase(
          builderOutput,
          skepticOutput,
        )

        // 5. Convert to OrchestratorDecision for UI compat
        const decision = this.arbiterToDecision(arbiterOutput)

        // 5.1. Record decision artifact for audit trail (P3)
        this.recordDecisionArtifact(decision)

        // 5.5. Track consecutive redesign decisions
        if (decision.action.type.toLowerCase().includes('redesign')) {
          this.consecutiveRedesigns++
          this.recentRedesignReasonings.push(decision.reasoning)
          if (
            this.recentRedesignReasonings.length > MAX_CONSECUTIVE_REDESIGNS
          ) {
            this.recentRedesignReasonings = this.recentRedesignReasonings.slice(
              -MAX_CONSECUTIVE_REDESIGNS,
            )
          }

          if (this.consecutiveRedesigns >= MAX_CONSECUTIVE_REDESIGNS) {
            const failureMessage = [
              `Orchestrator stopped: ${MAX_CONSECUTIVE_REDESIGNS} consecutive redesign decisions detected.`,
              'This indicates the research direction may be fundamentally blocked.',
              '',
              'Decision reasonings:',
              ...this.recentRedesignReasonings.map(
                (r, i) => `  ${i + 1}. ${r}`,
              ),
            ].join('\n')

            this.callbacks.onProgress(failureMessage)

            this.state = addTrajectoryEntry(this.state, {
              action_type: 'redesign_failure',
              agent: 'orchestrator',
              description: `${MAX_CONSECUTIVE_REDESIGNS} consecutive redesign decisions — halting`,
              outcome: failureMessage,
              state_changes: [],
            })

            this.checkpoint()
            break
          }
        } else {
          this.consecutiveRedesigns = 0
          this.recentRedesignReasonings = []
        }

        // 6. Interactive gate: present decision to user
        if (this.options.mode === 'interactive') {
          const approval = await this.callbacks.presentDecision(
            decision,
            this.state,
          )
          if (approval === 'skip') {
            this.state = addTrajectoryEntry(this.state, {
              action_type: 'user_skip',
              agent: decision.action.delegate_to,
              description: `User skipped: "${decision.action.type}"`,
              outcome:
                'User rejected this action. Do NOT propose the same or similar action again. Move on to a different type of work.',
              state_changes: [],
            })
            this.checkpoint()
            continue
          }
          if (approval === 'edit') {
            continue
          }
        }

        // 7. Budget gate
        if (
          this.budgetTracker.wouldExceedBudget(
            decision.action.estimated_cost_usd,
          )
        ) {
          this.callbacks.onProgress(
            `Skipping action (estimated $${decision.action.estimated_cost_usd.toFixed(2)} would exceed budget, remaining $${this.budgetTracker.getRemaining().toFixed(2)})`,
          )
          this.state = addTrajectoryEntry(this.state, {
            action_type: 'budget_skip',
            agent: 'orchestrator',
            description: `Skipped "${decision.action.type}" — would exceed budget`,
            outcome: `Estimated $${decision.action.estimated_cost_usd.toFixed(2)}, remaining $${this.budgetTracker.getRemaining().toFixed(2)}`,
            state_changes: [],
          })
          this.checkpoint()
          continue
        }

        // 8. Apply Arbiter claim updates to graph
        this.callbacks.onProgress('Applying claim updates...')
        const updateCounts = this.applyClaimUpdates(arbiterOutput, graph, pool)
        const contractCount = this.applyContractions(arbiterOutput, graph)
        const reformulationCount = this.applyReformulations(
          arbiterOutput,
          graph,
        )

        // Track consecutive reformulations
        if (reformulationCount > 0) {
          this.consecutiveReformulations++
          if (this.consecutiveReformulations >= 3) {
            this.callbacks.onProgress(
              `Warning: ${this.consecutiveReformulations} consecutive cycles with reformulations`,
            )
          }
        } else {
          this.consecutiveReformulations = 0
        }

        // 8.5. Phase progression: move targeted claim to under_investigation
        if (decision.action.targets_claim) {
          const targetClaim = graph.getClaim(decision.action.targets_claim)
          if (targetClaim && targetClaim.phase === 'proposed') {
            graph.updateClaim(decision.action.targets_claim, {
              phase: 'under_investigation',
            })
          }
        }

        // 9. Execute agent via callbacks
        // Validate/fix delegate_to: map role names to actual agent names
        const ROLE_TO_AGENT: Record<string, string> = {
          builder: 'investigator',
          skeptic: 'investigator',
          arbiter: 'investigator',
        }
        if (ROLE_TO_AGENT[decision.action.delegate_to]) {
          decision.action.delegate_to =
            ROLE_TO_AGENT[decision.action.delegate_to]
        }

        // 9. Create experiment directory + tier-2 audit gate before dispatch
        if (decision.action.delegate_to === 'experiment-runner') {
          try {
            const targetsClaim = decision.action.targets_claim || 'unknown'
            const requestedTier = decision.action.experiment_tier ?? 1
            const completedProbe = this.findCompletedProbeForClaim(targetsClaim)

            if (completedProbe && requestedTier >= 2) {
              // Promote existing probe to tier-2 run
              const { runId, runDir } =
                await this.experimentPromoter.promoteToRun(completedProbe.id)
              this.lastCreatedExperimentId = runId
              this.lastCreatedExperimentDir = runDir
              this.callbacks.onProgress(
                `Promoted probe ${completedProbe.id} → run ${runId}`,
              )
            } else {
              // Create new experiment at the requested tier
              const expName = this.inferExperimentName(decision)
              const created = await this.createExperiment.execute({
                name: expName,
                tier: requestedTier,
                purpose: decision.action.type,
                targets_claim: targetsClaim,
              })
              this.lastCreatedExperimentId = created.id
              this.lastCreatedExperimentDir = created.dir
              this.callbacks.onProgress(created.message)
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            this.callbacks.onProgress(`Experiment setup failed: ${msg}`)
          }

          // Tier 2 audit gate: run static audit AFTER creation, BEFORE agent dispatch
          if (this.lastCreatedExperimentId) {
            const auditBlock = await this.preExperimentAudit(
              this.lastCreatedExperimentId,
            )
            if (auditBlock) {
              this.callbacks.onProgress(`Audit failed: ${auditBlock}`)
              this.state = addTrajectoryEntry(this.state, {
                action_type: 'audit_failure',
                agent: 'experiment-runner',
                description: `Tier 2 audit failed: ${decision.action.type}`,
                outcome: auditBlock,
                state_changes: [],
              })
              this.checkpoint()
              continue
            }
          }
        }

        this.callbacks.onProgress(
          `Executing: ${decision.action.type} via ${decision.action.delegate_to}`,
        )

        const preExecFiles = this.snapshotProjectFiles()

        // Build structured claim-graph-aware context first
        let enrichedContext = this.buildSubAgentContext(
          decision.action.delegate_to,
          decision.action,
        )
        // Then layer on domain-specific enrichments
        if (decision.action.delegate_to === 'math-reasoner') {
          enrichedContext = this.enrichMathContext(
            enrichedContext,
            decision.action.type,
          )
        }
        // Save experiment ID before enrichExperimentContext clears it
        const createdExperimentId = this.lastCreatedExperimentId
        if (decision.action.delegate_to === 'experiment-runner') {
          enrichedContext = await this.enrichExperimentContext(
            enrichedContext,
            decision.action.type,
            decision.action.targets_claim ?? null,
          )
        }
        if (decision.action.delegate_to === 'data-scout') {
          enrichedContext = this.enrichDataScoutContext(enrichedContext)
        }
        if (decision.action.delegate_to === 'investigator') {
          enrichedContext = this.enrichInvestigatorContext(enrichedContext)
        }

        const execStartMs = Date.now()

        // Check for independent tasks that can run in parallel with the primary agent.
        // Only attempt if the callback is available and the primary agent is "heavy".
        const parallelTasks = this.identifyParallelTasks(decision, graph)
        let result: ExecutionResult
        let parallelResults: ExecutionResult[] = []

        if (
          parallelTasks.length > 0 &&
          this.callbacks.executeAgentsParallel
        ) {
          this.callbacks.onProgress(
            `Running ${parallelTasks.length} bonus task(s) in parallel with ${decision.action.delegate_to}`,
          )
          const allAgents = [
            {
              agentName: decision.action.delegate_to,
              task: decision.action.type,
              context: enrichedContext,
            },
            ...parallelTasks,
          ]
          const allResults = await this.callbacks.executeAgentsParallel(allAgents)
          result = allResults[0]
          parallelResults = allResults.slice(1)
        } else {
          result = await this.callbacks.executeAgent(
            decision.action.delegate_to,
            decision.action.type,
            enrichedContext,
          )
        }

        // Post-execution: run MathReasoningController for math proofs
        if (
          decision.action.delegate_to === 'math-reasoner' &&
          result.success &&
          result.summary
        ) {
          await this.runMathReasoningPostProcess(result, decision)
        }

        // Record cost in BudgetTracker (primary + parallel)
        const allResultsForCost = [result, ...parallelResults]
        for (const r of allResultsForCost) {
          if (r.cost_usd > 0) {
            const agentCategory = r.success
              ? this.agentToCategory(r.agent)
              : 'failed'
            this.budgetTracker.recordCost(r.cost_usd, agentCategory)
          }
        }

        // 10. Register evidence from agent output
        const registeredEvidence = this.registerEvidence(result, pool)

        // Add agent-produced claims to graph
        for (const c of result.new_claims) {
          if (c.statement) {
            graph.addClaim({
              type: c.type ?? 'hypothesis',
              epistemicLayer: c.epistemicLayer ?? 'explanation',
              statement: c.statement,
              phase: 'proposed',
              evidence: { grounded: [], derived: [] },
              strength: {
                confidence: c.confidence ?? 0.5,
                evidenceType: c.evidenceType ?? 'heuristic_motivation',
                vulnerabilityScore: c.vulnerabilityScore ?? 0.5,
              },
              created_by: result.agent,
            })
          }
        }

        // Link evidence to matching claims (after both evidence and claims are in the graph)
        const targetClaimIds: string[] = []
        if (decision.action.targets_claim)
          targetClaimIds.push(decision.action.targets_claim)
        if (decision.action.related_claims)
          targetClaimIds.push(...decision.action.related_claims)
        this.linkEvidenceToClaims(
          registeredEvidence,
          graph,
          pool,
          targetClaimIds,
        )

        // 10.2.5. Digest parallel results: register their evidence and claims
        for (const pr of parallelResults) {
          if (!pr.success) continue
          const prEvidence = this.registerEvidence(pr, pool)
          for (const c of pr.new_claims) {
            if (c.statement) {
              graph.addClaim({
                type: c.type ?? 'hypothesis',
                epistemicLayer: c.epistemicLayer ?? 'explanation',
                statement: c.statement,
                phase: 'proposed',
                evidence: { grounded: [], derived: [] },
                strength: {
                  confidence: c.confidence ?? 0.5,
                  evidenceType: c.evidenceType ?? 'heuristic_motivation',
                  vulnerabilityScore: c.vulnerabilityScore ?? 0.5,
                },
                created_by: pr.agent,
              })
            }
          }
          // Link parallel evidence to claims broadly (no specific target)
          this.linkEvidenceToClaims(prEvidence, graph, pool, [])
        }

        // 10.3. Process experiment results: update log, extract metrics evidence
        if (decision.action.delegate_to === 'experiment-runner') {
          const durationSec = (Date.now() - execStartMs) / 1000
          await this.processExperimentResult(
            result,
            decision,
            pool,
            durationSec,
            createdExperimentId,
          )
        }

        // 10.4. Generate experiment NOTE.md
        if (decision.action.delegate_to === 'experiment-runner') {
          const expId = this.findExperimentId(result, createdExperimentId)
          if (expId) {
            try {
              const metrics = this.experimentResults.readMetrics(expId)
              const audit = this.experimentResults.readAudit(expId)
              await this.notebook.generateNote(expId, {
                arbiterDecision: decision,
                builderNarrative: builderOutput.narrative || '',
                skepticChallenge:
                  skepticOutput.top3_collapse_points?.[0]
                    ?.falsification_experiment || null,
                executionResult: result,
                metricsJson: metrics,
                auditResult: audit,
                claimImpacts: arbiterOutput.claim_updates || [],
              })
            } catch {
              /* non-critical */
            }
          }
        }

        // 10.5. Retry admission on claims that were blocked before evidence existed
        if (updateCounts.blockedAdmitIds.length > 0) {
          const postEvidenceAdmitted = this.retryBlockedAdmissions(
            updateCounts.blockedAdmitIds,
            graph,
            pool,
          )
          updateCounts.admitted += postEvidenceAdmitted
        }

        // Update state with graph + pool changes
        this.state = {
          ...this.state,
          claimGraph: graph.toJSON(),
          evidencePool: pool.pool,
        }

        // 11. Digest: literature + theory LLM synthesis
        this.callbacks.onProgress('Digesting execution results...')
        this.state = await this.digest(result)

        // 11.1 Digest parallel results
        for (const pr of parallelResults) {
          if (pr.success) {
            this.state = await this.digest(pr)
          }
        }

        // 11.5. Harvest literature findings as grounded evidence
        const allLitResults = [result, ...parallelResults.filter(r => r.success)]
        const hasLiterature = allLitResults.some(
          r => r.literature_findings?.known_results?.length,
        )
        if (hasLiterature) {
          const postDigestGraph = new ClaimGraph(this.state.claimGraph)
          const postDigestPool = new EvidencePoolManager(
            this.state.evidencePool,
          )
          for (const r of allLitResults) {
            if (r.literature_findings?.known_results?.length) {
              this.harvestLiteratureEvidence(r, postDigestGraph, postDigestPool)
            }
          }
          this.state = {
            ...this.state,
            claimGraph: postDigestGraph.toJSON(),
            evidencePool: postDigestPool.pool,
          }
        }

        // 12. Update stability + lastArbiterAssessment (full convergence detector)
        this.previousStability = { ...this.state.stability }
        const postPool = new EvidencePoolManager(this.state.evidencePool)
        const stability = this.convergenceDetector.compute(
          this.state,
          postPool,
          this.researchStance,
        )
        stability.lastArbiterAssessment = arbiterOutput.overall_assessment
        this.state = { ...this.state, stability }

        // 13. Add trajectory entry with triple-role summaries
        const agentClaimsAdded = result.new_claims.filter(
          c => c.statement,
        ).length
        this.state = addTrajectoryEntry(this.state, {
          action_type: decision.action.type,
          agent: result.agent,
          description: arbiterOutput.overall_assessment,
          outcome: result.summary,
          state_changes: [],
          claim_graph_delta: {
            claims_added: builderClaimIds.length + agentClaimsAdded,
            claims_admitted: updateCounts.admitted,
            claims_demoted: updateCounts.demoted,
            claims_rejected: updateCounts.rejected,
            claims_reformulated: reformulationCount,
            edges_added: (builderOutput.new_edges_proposed ?? []).length,
          },
          cycle: cycleNum,
          builder_output_summary: builderOutput.narrative,
          skeptic_challenges_summary:
            this.summarizeSkepticForTrajectory(skepticOutput),
          arbiter_decision_summary: arbiterOutput.overall_assessment,
          effort_levels: this.lastEffortLevels ?? undefined,
        })
        // Reset effort tracking for next cycle
        this.lastEffortLevels = null

        // 13.5. Lab Journal: append cycle entry + update dashboard
        try {
          const journalExpId =
            decision.action.delegate_to === 'experiment-runner'
              ? this.findExperimentId(result, createdExperimentId)
              : null
          const experimentSummaries: ExperimentNoteSummary[] = journalExpId
            ? [this.notebook.extractSummary(journalExpId)]
            : []

          await this.journal.appendCycleEntry({
            cycle: cycleNum,
            timestamp: new Date().toISOString(),
            action: decision.action.type,
            builder_summary: builderOutput.narrative || '',
            skeptic_summary: this.summarizeSkepticBrief(skepticOutput),
            arbiter_decision: arbiterOutput.overall_assessment || '',
            result_summary: result.summary || '',
            claim_delta: this.computeClaimDelta(
              builderClaimIds.length + agentClaimsAdded,
              updateCounts,
              reformulationCount,
            ),
            experiment_notes: experimentSummaries,
            is_turning_point: (arbiterOutput.claim_updates || []).some(
              (u: { action: string }) =>
                ['demoted', 'rejected', 'contracted', 'retracted'].includes(
                  u.action,
                ),
            ),
          })
          await this.journal.updateDashboard(this.buildDashboard())
        } catch {
          /* non-critical */
        }

        // 14. Store agent-produced artifacts
        for (const artifact of result.artifacts_produced) {
          this.state = addArtifact(this.state, {
            type: this.inferArtifactType(decision.action.delegate_to),
            path: artifact,
            created_by: result.agent,
            description: `Produced by ${result.agent}: ${decision.action.type}`,
          })
        }

        const newFiles = this.discoverNewArtifacts(preExecFiles)
        for (const filePath of newFiles) {
          this.state = addArtifact(this.state, {
            type: this.inferArtifactTypeFromPath(filePath),
            path: filePath,
            created_by: result.agent,
            description: `Discovered after ${result.agent}: ${decision.action.type}`,
          })
        }

        this.syncFragmentIndex(result.agent, result.artifacts_produced)

        if (
          decision.action.delegate_to === 'paper-assembler' &&
          result.success
        ) {
          await this.triggerCompilation()
        }

        // 14b. Auto-trigger writing pipeline when research is ready
        if (
          (this.state.stability.paperReadiness === 'nearly_ready' ||
            this.state.stability.paperReadiness === 'ready') &&
          !this.state.artifacts.compiled_pdf &&
          this.state.artifacts.entries.some(a => a.type === 'experiment_result')
        ) {
          await this.triggerWritingPipeline()
        }

        // 15. Sync BudgetTracker state back to ResearchState
        const budgetState = this.budgetTracker.toStateBudget()
        this.state = {
          ...this.state,
          budget: {
            ...this.state.budget,
            spent_usd: budgetState.spent_usd,
            remaining_usd:
              this.state.budget.total_usd > 0
                ? this.state.budget.total_usd - budgetState.spent_usd
                : this.state.budget.remaining_usd,
            breakdown: budgetState.breakdown,
          },
        }

        // 16. Checkpoint: persist state
        this.checkpoint()

        this.callbacks.onStateChange(this.state)
      } catch (error: any) {
        this.callbacks.onError(error)
        this.state = addTrajectoryEntry(this.state, {
          action_type: 'error',
          agent: 'orchestrator',
          description: `Error in cycle ${this.state.orchestrator_cycle_count}`,
          outcome: error.message,
          state_changes: [],
        })
        this.checkpoint()

        // If we get 3 consecutive errors, stop
        const recentErrors = this.state.trajectory
          .slice(-3)
          .filter(t => t.action_type === 'error')
        if (recentErrors.length >= 3) {
          this.callbacks.onProgress(
            '3 consecutive errors. Stopping orchestrator.',
          )
          break
        }
      }
    }

    this.callbacks.onComplete(this.state)
    return this.state
  }

  // ── Triple-Role Methods (Step 6) ────────────────────────

  /**
   * Builder phase: propose narrative, new claims, and next actions.
   * Uses research model (Opus).
   */
  private async builderPhase(): Promise<BuilderOutput> {
    const prompt = this.promptAssembler.assembleBuilder()

    const { effort, reasons } = determineEffort(
      this.state,
      'builder',
      this.previousStability,
    )
    if (reasons.length) {
      this.callbacks.onProgress(`Builder effort: HIGH (${reasons.join('; ')})`)
    }
    this.recordEffort('builder', effort, reasons)

    const response = await chatCompletion({
      modelSpec: DEFAULT_MODEL_ASSIGNMENTS.research,
      max_tokens: 8192,
      reasoning_effort: effort,
      messages: [{ role: 'user', content: prompt }],
    })

    this.recordOrchestratorCost(response.cost_usd ?? 0, 'builder')
    return parseTripleRoleOutput<BuilderOutput>(response.text, 'builder')
  }

  /**
   * Skeptic phase: challenge the Builder's proposals.
   * Uses review model (GPT-5.4-Pro), falls back to research model if unavailable.
   */
  private async skepticPhase(
    builderOutput: BuilderOutput,
  ): Promise<SkepticOutput> {
    const prompt = this.promptAssembler.assembleSkeptic(builderOutput)

    const { effort, reasons } = determineEffort(
      this.state,
      'skeptic',
      this.previousStability,
    )
    if (reasons.length) {
      this.callbacks.onProgress(`Skeptic effort: HIGH (${reasons.join('; ')})`)
    }
    this.recordEffort('skeptic', effort, reasons)

    // Try review model first, fall back to research model
    const modelsToTry = [
      DEFAULT_MODEL_ASSIGNMENTS.review,
      DEFAULT_MODEL_ASSIGNMENTS.research,
    ]

    for (const modelSpec of modelsToTry) {
      try {
        const response = await chatCompletion({
          modelSpec,
          max_tokens: 8192,
          reasoning_effort: effort,
          messages: [{ role: 'user', content: prompt }],
        })

        this.recordOrchestratorCost(response.cost_usd ?? 0, 'skeptic')
        return parseTripleRoleOutput<SkepticOutput>(response.text, 'skeptic')
      } catch (err: any) {
        const isLastModel = modelSpec === modelsToTry[modelsToTry.length - 1]
        if (isLastModel) throw err
        this.callbacks.onProgress(
          `Skeptic model ${modelSpec} failed: ${err.message?.slice(0, 150)} — retrying with fallback`,
        )
      }
    }

    // Unreachable, but satisfies TypeScript
    throw new Error('Skeptic phase: all models failed')
  }

  /**
   * Arbiter phase: synthesize Builder + Skeptic, decide next action.
   * Uses research model (Opus).
   */
  private async arbiterPhase(
    builderOutput: BuilderOutput,
    skepticOutput: SkepticOutput,
  ): Promise<ArbiterOutput> {
    const prompt = this.promptAssembler.assembleArbiter(
      builderOutput,
      skepticOutput,
    )

    const { effort, reasons } = determineEffort(
      this.state,
      'arbiter',
      this.previousStability,
    )
    if (reasons.length) {
      this.callbacks.onProgress(`Arbiter effort: HIGH (${reasons.join('; ')})`)
    }
    this.recordEffort('arbiter', effort, reasons)

    const response = await chatCompletion({
      modelSpec: DEFAULT_MODEL_ASSIGNMENTS.research,
      max_tokens: 8192,
      reasoning_effort: effort,
      messages: [{ role: 'user', content: prompt }],
    })

    this.recordOrchestratorCost(response.cost_usd ?? 0, 'arbiter')
    return parseTripleRoleOutput<ArbiterOutput>(response.text, 'arbiter')
  }

  // parseTripleRoleOutput is now imported from ./json-repair

  /**
   * Record orchestrator phase cost to budget tracker and state.
   */
  private recordOrchestratorCost(cost: number, phase: string): void {
    if (cost > 0) {
      this.budgetTracker.recordCost(cost, 'other')
      this.state = recordSpending(this.state, `orchestrator-${phase}`, cost)
    }
  }

  /**
   * Track effort level for a role in the current cycle.
   */
  private recordEffort(
    role: 'builder' | 'skeptic' | 'arbiter',
    effort: EffortLevel,
    reasons: string[],
  ): void {
    if (!this.lastEffortLevels) {
      this.lastEffortLevels = {
        builder: 'medium',
        skeptic: 'medium',
        arbiter: 'medium',
        escalation_reasons: [],
      }
    }
    this.lastEffortLevels[role] = effort
    if (reasons.length > 0) {
      this.lastEffortLevels.escalation_reasons.push(...reasons)
    }
  }

  /**
   * Convert ArbiterOutput → OrchestratorDecision for UI compatibility.
   */
  private arbiterToDecision(arbiter: ArbiterOutput): OrchestratorDecision {
    const na = arbiter.next_action
    return {
      reasoning: arbiter.overall_assessment,
      action: {
        type: na.action,
        delegate_to: na.delegate_to,
        context: na.context,
        model_preference: 'default',
        estimated_cost_usd: na.estimated_cost_usd ?? 0,
        priority: this.validateEnum(
          na.priority,
          ['urgent', 'high', 'normal', 'low'] as const,
          'normal',
        ),
        if_this_fails: na.if_this_fails,
        targets_claim: na.targets_claim,
        related_claims: na.related_claims,
        experiment_tier:
          na.experiment_tier === 1 || na.experiment_tier === 2
            ? na.experiment_tier
            : undefined,
      },
    }
  }

  /**
   * Apply Arbiter's claim_updates to the graph.
   * Uses canAdmit() gate for 'admit' actions.
   */
  private applyClaimUpdates(
    arbiter: ArbiterOutput,
    graph: ClaimGraph,
    pool: EvidencePoolManager,
  ): {
    admitted: number
    demoted: number
    rejected: number
    kept: number
    blockedAdmitIds: string[]
  } {
    const counts = { admitted: 0, demoted: 0, rejected: 0, kept: 0 }
    const blockedAdmitIds: string[] = []

    for (const update of arbiter.claim_updates ?? []) {
      const claim = graph.getClaim(update.claim_id)
      if (!claim) continue // unknown claim_id — skip silently

      switch (update.action) {
        case 'admit': {
          const decision = canAdmit(
            update.claim_id,
            graph,
            pool,
            this.researchStance,
          )
          if (decision.admit) {
            const ladderResult = graph.updateClaim(update.claim_id, { phase: 'admitted' })
            if (ladderResult.admitted) {
              counts.admitted++
            } else {
              // Evidence ladder blocked admission — claim needs stronger evidence
              this.callbacks.onProgress(
                `Evidence ladder blocked admission of ${update.claim_id}: ${ladderResult.gap}`,
              )
              blockedAdmitIds.push(update.claim_id)
            }
          } else {
            this.callbacks.onProgress(
              `Admission gate blocked ${update.claim_id}: ${decision.reason} (will retry after evidence)`,
            )
            blockedAdmitIds.push(update.claim_id)
          }
          break
        }
        case 'demote':
          graph.updateClaim(update.claim_id, { phase: 'demoted' })
          counts.demoted++
          break
        case 'reject':
          graph.updateClaim(update.claim_id, { phase: 'rejected' })
          counts.rejected++
          break
        case 'keep':
          if (update.new_confidence != null) {
            graph.updateClaim(update.claim_id, {
              strength: {
                ...claim.strength,
                confidence: this.clampConfidence(update.new_confidence),
              },
            })
          }
          counts.kept++
          break
        case 'contract':
          // Handled by applyContractions separately
          break
        case 'reformulate':
          // Handled by applyReformulations separately
          break
      }
    }

    return { ...counts, blockedAdmitIds }
  }

  /**
   * Retry admission gate on claims that were blocked before agent execution.
   * Called after evidence linking, when claims may now have evidence attached.
   */
  private retryBlockedAdmissions(
    blockedIds: string[],
    graph: ClaimGraph,
    pool: EvidencePoolManager,
  ): number {
    let admitted = 0
    for (const claimId of blockedIds) {
      const claim = graph.getClaim(claimId)
      if (!claim || claim.phase === 'admitted') continue

      const decision = canAdmit(claimId, graph, pool, this.researchStance)
      if (decision.admit) {
        graph.updateClaim(claimId, { phase: 'admitted' })
        admitted++
        this.callbacks.onProgress(
          `Post-evidence admission: ${claimId} now admitted`,
        )
      }
    }
    return admitted
  }

  /**
   * Apply Arbiter's contracted_claims: update layer, statement, revert to proposed.
   */
  private applyContractions(arbiter: ArbiterOutput, graph: ClaimGraph): number {
    let count = 0
    for (const contraction of arbiter.contracted_claims ?? []) {
      const claim = graph.getClaim(contraction.claim_id)
      if (!claim) continue

      const validLayer = this.validateEnum(
        contraction.new_layer,
        [
          'observation',
          'explanation',
          'exploitation',
          'justification',
        ] as const,
        claim.epistemicLayer,
      )

      graph.updateClaim(contraction.claim_id, {
        epistemicLayer: validLayer,
        statement: contraction.contracted_statement || claim.statement,
        phase: 'proposed', // revert to proposed after contraction
      })
      count++
    }
    return count
  }

  /**
   * Apply Arbiter's reformulated_claims: create successor main claims, archive old ones.
   * Returns number of reformulations applied.
   */
  applyReformulations(arbiter: ArbiterOutput, graph: ClaimGraph): number {
    let count = 0
    for (const reform of arbiter.reformulated_claims ?? []) {
      const oldClaim = graph.getClaim(reform.claim_id)
      if (!oldClaim) continue

      // Guard: only main claims
      if (!oldClaim.is_main) continue

      // Guard: must have been investigated (not just proposed)
      if (oldClaim.phase === 'proposed') continue

      // Guard: per-lineage limit
      const currentCount = oldClaim.reformulation_count ?? 0
      if (currentCount >= MAX_REFORMULATIONS_PER_CLAIM) {
        this.callbacks.onProgress(
          `Reformulation skipped for ${reform.claim_id}: lineage limit (${MAX_REFORMULATIONS_PER_CLAIM}) reached`,
        )
        continue
      }

      // Create successor claim
      const newType = this.validateEnum(
        reform.new_type,
        [
          'observation',
          'assumption',
          'hypothesis',
          'theorem',
          'algorithmic',
          'empirical',
          'novelty',
          'benchmark',
          'limitation',
        ] as const,
        oldClaim.type,
      )
      const newLayer = this.validateEnum(
        reform.new_layer,
        [
          'observation',
          'explanation',
          'exploitation',
          'justification',
        ] as const,
        oldClaim.epistemicLayer,
      )

      const successorId = graph.addClaim({
        type: newType,
        epistemicLayer: newLayer,
        statement: reform.new_statement,
        phase: 'proposed',
        evidence: { grounded: [], derived: [] },
        strength: {
          confidence: 0.5,
          evidenceType: 'heuristic_motivation',
          vulnerabilityScore: 0.5,
        },
        created_by: 'arbiter',
        is_main: true,
        depth: 0,
        reformulated_from: reform.claim_id,
        reformulation_count: currentCount + 1,
      })

      // Archive old claim
      graph.updateClaim(reform.claim_id, {
        phase: 'reformulated',
        reformulated_into: successorId,
      })

      // Add supersedes edge (old -> new)
      graph.addEdge({
        source: reform.claim_id,
        target: successorId,
        relation: 'supersedes',
        strength: 'strong',
        note: reform.rationale,
      })

      // Transfer sub-claim depends_on edges with weak strength
      const oldEdges = graph.getEdgesOf(reform.claim_id)
      for (const edge of oldEdges) {
        // Only transfer edges where something depends on the old claim
        if (edge.relation === 'depends_on' && edge.target === reform.claim_id) {
          try {
            graph.addEdge({
              source: edge.source,
              target: successorId,
              relation: 'depends_on',
              strength: 'weak',
              note: `Transferred from reformulated claim ${reform.claim_id}`,
            })
          } catch {
            // Skip if source claim doesn't exist
          }
        }
      }

      this.callbacks.onProgress(
        `Reformulated claim ${reform.claim_id} -> ${successorId}: "${truncate(reform.new_statement, 60)}"`,
      )
      count++
    }
    return count
  }

  /**
   * Add Builder's proposed claims to the graph, patch IDs back into BuilderOutput.
   */
  private addBuilderClaimsToGraph(
    builder: BuilderOutput,
    graph: ClaimGraph,
  ): string[] {
    const newIds: string[] = []
    const MAX_NEW_CLAIMS_PER_CYCLE = 5
    const claimsToAdd = (builder.new_claims_proposed ?? []).slice(
      0,
      MAX_NEW_CLAIMS_PER_CYCLE,
    )
    const maxDepth = this.rigorLevel - 1

    // Pre-compute proposed edges for depth checking
    const proposedEdges = builder.new_edges_proposed ?? []

    for (const c of claimsToAdd) {
      // Reject Builder trying to create main claims — only proposal can
      if ((c as any).is_main) continue

      // Depth enforcement: check proposed depends_on targets
      let parentDepth: number | null = null
      let rootMainId: string | undefined
      for (const e of proposedEdges) {
        if (e.source_id === c.id && e.relation === 'depends_on') {
          const target = graph.getClaim(e.target_id)
          if (target) {
            const targetDepth =
              target.depth ?? graph.getDepthFromMain(e.target_id)
            if (targetDepth != null) {
              if (parentDepth == null || targetDepth < parentDepth) {
                parentDepth = targetDepth
              }
              rootMainId =
                target.root_main_id ?? (target.is_main ? target.id : undefined)
            }
          }
        }
      }

      // If parent is at max depth, this claim would exceed depth limit — skip
      if (parentDepth != null && parentDepth >= maxDepth) continue

      const claimDepth = parentDepth != null ? parentDepth + 1 : undefined

      const claimId = graph.addClaim({
        type: this.validateEnum(
          c.type,
          [
            'observation',
            'assumption',
            'hypothesis',
            'theorem',
            'algorithmic',
            'empirical',
            'novelty',
            'benchmark',
            'limitation',
          ] as const,
          'hypothesis',
        ),
        epistemicLayer: this.validateEnum(
          c.epistemicLayer,
          [
            'observation',
            'explanation',
            'exploitation',
            'justification',
          ] as const,
          'explanation',
        ),
        statement: c.statement,
        phase: 'proposed',
        evidence: { grounded: [], derived: [] },
        strength: {
          confidence: this.clampConfidence(c.confidence ?? 0.5),
          evidenceType: 'heuristic_motivation',
          vulnerabilityScore: 0.5,
        },
        created_by: 'builder',
        depth: claimDepth,
        root_main_id: rootMainId,
      })
      // Patch ID back into the builder output for downstream reference
      c.id = claimId
      newIds.push(claimId)
    }

    // Add edges between claims
    for (const e of proposedEdges) {
      try {
        // Resolve source/target — could be existing claims or newly added
        if (graph.getClaim(e.source_id) && graph.getClaim(e.target_id)) {
          graph.addEdge({
            source: e.source_id,
            target: e.target_id,
            relation: this.validateEnum(
              e.relation,
              [
                'supports',
                'depends_on',
                'contradicts',
                'motivates',
                'refines',
                'generalizes',
                'bridges',
              ] as const,
              'supports',
            ),
            strength: this.validateEnum(
              e.strength,
              ['strong', 'moderate', 'weak', 'conjectured'] as const,
              'moderate',
            ),
          })
        }
      } catch {
        // Skip edges referencing invalid IDs
      }
    }

    return newIds
  }

  /**
   * Register evidence from ExecutionResult into the EvidencePool.
   * Returns metadata for each registered evidence item so linking can happen after claims are added.
   */
  private registerEvidence(
    result: ExecutionResult,
    pool: EvidencePoolManager,
  ): Array<{ id: string; kind: 'grounded' | 'derived'; claimText: string }> {
    const registered: Array<{
      id: string
      kind: 'grounded' | 'derived'
      claimText: string
    }> = []

    for (const ev of result.new_evidence) {
      const claimText = ev.claim_statement ?? ''
      if (ev.kind === 'grounded') {
        const id = pool.addGrounded({
          claim: claimText,
          source_type: this.agentToSourceType(result.agent),
          source_ref: ev.source_ref ?? result.agent,
          verified: !!(ev.source_ref && ev.source_ref.trim().length > 0),
          supports_claims: [],
          contradicts_claims: [],
          acquired_by: result.agent,
        })
        registered.push({ id, kind: 'grounded', claimText })
      } else {
        const id = pool.addDerived({
          claim: claimText,
          method: this.agentToDerivedMethod(result.agent, ev.method),
          reproducible: result.artifacts_produced.length > 0,
          artifact_id: result.artifacts_produced[0] ?? '',
          assumptions: [],
          supports_claims: [],
          contradicts_claims: [],
          produced_by: result.agent,
        })
        registered.push({ id, kind: 'derived', claimText })
      }
    }

    return registered
  }

  /** Map agent name to grounded evidence source_type per spec Section 6. */
  private agentToSourceType(
    agent: string,
  ): 'literature' | 'dataset' | 'known_result' | 'external_tool' {
    const name = agent.toLowerCase()
    if (name.includes('investigator') || name.includes('fragment-writer'))
      return 'literature'
    if (name.includes('data-scout')) return 'dataset'
    return 'external_tool'
  }

  /** Map agent name to derived evidence method per spec Section 6. */
  private agentToDerivedMethod(
    agent: string,
    explicit?: string,
  ): 'proof' | 'derivation' | 'computation' | 'simulation' | 'experiment' {
    if (
      explicit &&
      [
        'proof',
        'derivation',
        'computation',
        'simulation',
        'experiment',
      ].includes(explicit)
    ) {
      return explicit as
        | 'proof'
        | 'derivation'
        | 'computation'
        | 'simulation'
        | 'experiment'
    }
    const name = agent.toLowerCase()
    if (name.includes('math-reasoner')) return 'proof'
    if (name.includes('experiment-runner')) return 'experiment'
    if (name.includes('result-analyzer')) return 'computation'
    return 'computation'
  }

  /**
   * Link registered evidence to matching claims in the ClaimGraph.
   * Uses deterministic text matching (no LLM call): exact → substring → Jaccard.
   */
  private linkEvidenceToClaims(
    registeredEvidence: Array<{
      id: string
      kind: 'grounded' | 'derived'
      claimText: string
    }>,
    graph: ClaimGraph,
    pool: EvidencePoolManager,
    targetClaimIds?: string[],
  ): void {
    if (registeredEvidence.length === 0) return

    // Phase 0: Seed-link via arbiter-specified target claims (bypasses text matching)
    if (targetClaimIds && targetClaimIds.length > 0) {
      for (const ev of registeredEvidence) {
        for (const targetId of targetClaimIds) {
          const claim = graph.getClaim(targetId)
          if (!claim) continue
          // Forward link: evidence → claim
          if (ev.kind === 'grounded') {
            const entry = pool.getGrounded(ev.id)
            if (entry && !entry.supports_claims.includes(targetId)) {
              entry.supports_claims.push(targetId)
            }
          } else {
            const entry = pool.getDerived(ev.id)
            if (entry && !entry.supports_claims.includes(targetId)) {
              entry.supports_claims.push(targetId)
            }
          }
          // Reverse link: claim → evidence
          const bucket = ev.kind === 'grounded' ? 'grounded' : 'derived'
          if (!claim.evidence[bucket].includes(ev.id)) {
            graph.updateClaim(targetId, {
              evidence: {
                ...claim.evidence,
                [bucket]: [...claim.evidence[bucket], ev.id],
              },
            })
          }
        }
      }
    }

    const allClaims = graph.allClaims

    for (const ev of registeredEvidence) {
      if (!ev.claimText) continue

      const matchedClaimIds = this.findMatchingClaims(ev.claimText, allClaims)

      // Forward link: evidence → claims
      if (ev.kind === 'grounded') {
        const entry = pool.getGrounded(ev.id)
        if (entry) {
          for (const cid of matchedClaimIds) {
            if (!entry.supports_claims.includes(cid)) {
              entry.supports_claims.push(cid)
            }
          }
        }
      } else {
        const entry = pool.getDerived(ev.id)
        if (entry) {
          for (const cid of matchedClaimIds) {
            if (!entry.supports_claims.includes(cid)) {
              entry.supports_claims.push(cid)
            }
          }
        }
      }

      // Reverse link: claim → evidence
      for (const claimId of matchedClaimIds) {
        const claim = graph.getClaim(claimId)
        if (!claim) continue

        const bucket = ev.kind === 'grounded' ? 'grounded' : 'derived'
        if (!claim.evidence[bucket].includes(ev.id)) {
          graph.updateClaim(claimId, {
            evidence: {
              ...claim.evidence,
              [bucket]: [...claim.evidence[bucket], ev.id],
            },
          })
        }
      }
    }
  }

  /**
   * Convert literature findings (known_results) into grounded evidence
   * and link them to matching claims. This bridges the gap where
   * literature_findings go to state.literature_awareness but never
   * into the evidence pool.
   */
  private harvestLiteratureEvidence(
    result: ExecutionResult,
    graph: ClaimGraph,
    pool: EvidencePoolManager,
  ): void {
    if (!result.literature_findings?.known_results) return

    const harvested: Array<{
      id: string
      kind: 'grounded'
      claimText: string
    }> = []

    for (const kr of result.literature_findings.known_results) {
      const id = pool.addGrounded({
        claim: kr.statement,
        source_type: 'literature',
        source_ref: kr.source,
        verified: kr.confidence >= 0.8,
        supports_claims: [],
        contradicts_claims: [],
        acquired_by: result.agent,
      })
      harvested.push({ id, kind: 'grounded', claimText: kr.statement })
    }

    if (harvested.length > 0) {
      this.linkEvidenceToClaims(harvested, graph, pool)
    }
  }

  /**
   * Find claims whose statement matches the given text.
   * 4-tier strategy: exact match → substring containment → Jaccard >= 0.4 → keyword overlap
   */
  private findMatchingClaims(
    text: string,
    claims: import('./claim-graph/types').Claim[],
  ): string[] {
    const matched: string[] = []
    const normalizedText = text.trim().toLowerCase()

    for (const claim of claims) {
      const normalizedStatement = claim.statement.trim().toLowerCase()

      // Tier 1: Exact match (case-insensitive, trimmed)
      if (normalizedText === normalizedStatement) {
        matched.push(claim.id)
        continue
      }

      // Tier 2: Substring containment (either direction)
      if (
        normalizedText.includes(normalizedStatement) ||
        normalizedStatement.includes(normalizedText)
      ) {
        matched.push(claim.id)
        continue
      }

      // Tier 3: Jaccard token similarity >= 0.4
      if (this.jaccardSimilarity(normalizedText, normalizedStatement) >= 0.4) {
        matched.push(claim.id)
        continue
      }

      // Tier 4: Keyword overlap — if >=3 significant words match
      const STOP_WORDS = new Set([
        'the',
        'a',
        'an',
        'is',
        'are',
        'was',
        'were',
        'be',
        'been',
        'being',
        'have',
        'has',
        'had',
        'do',
        'does',
        'did',
        'will',
        'would',
        'could',
        'should',
        'may',
        'might',
        'can',
        'shall',
        'to',
        'of',
        'in',
        'for',
        'on',
        'with',
        'at',
        'by',
        'from',
        'as',
        'into',
        'through',
        'during',
        'before',
        'after',
        'and',
        'but',
        'or',
        'nor',
        'not',
        'so',
        'yet',
        'both',
        'either',
        'neither',
        'each',
        'every',
        'all',
        'any',
        'few',
        'more',
        'most',
        'other',
        'some',
        'such',
        'no',
        'only',
        'own',
        'same',
        'than',
        'too',
        'very',
        'just',
        'that',
        'this',
        'these',
        'those',
        'it',
        'its',
        'we',
        'our',
        'they',
        'their',
      ])
      const significantWords = (s: string) =>
        new Set(
          s
            .replace(/[^\w\s]/g, '')
            .split(/\s+/)
            .filter(w => w.length > 2 && !STOP_WORDS.has(w)),
        )
      const wordsA = significantWords(normalizedText)
      const wordsB = significantWords(normalizedStatement)
      let overlap = 0
      for (const w of wordsA) {
        if (wordsB.has(w)) overlap++
      }
      if (overlap >= 3) {
        matched.push(claim.id)
      }
    }

    return matched
  }

  /**
   * Jaccard similarity between two strings based on word tokens.
   */
  private jaccardSimilarity(a: string, b: string): number {
    const tokenize = (s: string): Set<string> =>
      new Set(
        s
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
          .filter(w => w.length > 0),
      )
    const setA = tokenize(a)
    const setB = tokenize(b)
    if (setA.size === 0 && setB.size === 0) return 1
    if (setA.size === 0 || setB.size === 0) return 0

    let intersection = 0
    for (const token of setA) {
      if (setB.has(token)) intersection++
    }
    const union = setA.size + setB.size - intersection
    return union === 0 ? 0 : intersection / union
  }

  /**
   * Summarize Skeptic output for trajectory entry.
   */
  private summarizeSkepticForTrajectory(skeptic: SkepticOutput): string {
    const parts: string[] = []
    const inconsistencies = skeptic.internal_inconsistencies?.length ?? 0
    const gaps = skeptic.bridge_gaps?.length ?? 0
    const inflation = skeptic.evidence_inflation?.length ?? 0
    const collapses = skeptic.top3_collapse_points?.length ?? 0
    const denials = skeptic.admission_denials?.length ?? 0

    if (inconsistencies > 0) parts.push(`${inconsistencies} inconsistencies`)
    if (gaps > 0) parts.push(`${gaps} bridge gaps`)
    if (inflation > 0) parts.push(`${inflation} inflation`)
    if (collapses > 0) parts.push(`${collapses} collapse points`)
    if (denials > 0) parts.push(`${denials} admission denials`)

    return parts.length > 0 ? parts.join(', ') : 'no challenges'
  }

  /**
   * Qualitative 1-line skeptic summary for the journal (human-readable).
   */
  private summarizeSkepticBrief(skeptic: SkepticOutput): string {
    const topVuln = skeptic.top3_collapse_points?.[0]?.falsification_experiment
    const gaps = skeptic.bridge_gaps?.length ?? 0
    const inflation = skeptic.evidence_inflation?.length ?? 0
    const denials = skeptic.admission_denials?.length ?? 0

    const parts: string[] = []
    if (topVuln) parts.push(`Top vulnerability: ${topVuln}`)
    if (gaps > 0) parts.push(`${gaps} bridge gap(s)`)
    if (inflation > 0) parts.push(`${inflation} evidence inflation(s)`)
    if (denials > 0) parts.push(`${denials} admission denial(s)`)

    return parts.length > 0 ? parts.join('; ') : 'No challenges raised.'
  }

  /**
   * Compute claim graph delta for the journal cycle entry.
   */
  private computeClaimDelta(
    claimsAdded: number,
    updateCounts: {
      admitted: number
      demoted: number
      rejected: number
    },
    _reformulationCount: number,
  ): JournalClaimDelta {
    const graph = ClaimGraph.fromJSON(this.state.claimGraph)
    const allClaims = graph.allClaims
    const admittedClaims = allClaims.filter(c => c.phase === 'admitted')

    return {
      added: claimsAdded,
      admitted: updateCounts.admitted,
      demoted: updateCounts.demoted,
      rejected: updateCounts.rejected,
      total_claims: allClaims.length,
      total_admitted: admittedClaims.length,
      convergence_score: this.state.stability.convergenceScore ?? 0,
    }
  }

  /**
   * Build dashboard data from current state for the journal.
   */
  private buildDashboard(): DashboardData {
    const log = this.experimentLog.load()
    const allExperiments = log.experiments
    const succeeded = allExperiments.filter(
      e => e.status === 'completed',
    ).length
    const failed = allExperiments.filter(e => e.status === 'failed').length

    const graph = ClaimGraph.fromJSON(this.state.claimGraph)
    const allClaims = graph.allClaims
    const admittedClaims = allClaims.filter(c => c.phase === 'admitted')

    // Count turning points from trajectory
    const turningPoints = (this.state.trajectory ?? []).filter(t => {
      const delta = t.claim_graph_delta
      return (
        delta &&
        ((delta.claims_demoted ?? 0) > 0 || (delta.claims_rejected ?? 0) > 0)
      )
    }).length

    const convergence = this.state.stability.convergenceScore ?? 0
    let readiness = 'not_ready'
    if (convergence > 0.8) readiness = 'ready'
    else if (convergence > 0.6) readiness = 'nearly_ready'
    else if (convergence > 0.4) readiness = 'needs_work'

    return {
      total_cycles: this.state.orchestrator_cycle_count ?? 0,
      total_experiments: allExperiments.length,
      experiments_succeeded: succeeded,
      experiments_failed: failed,
      claims_total: allClaims.length,
      claims_admitted: admittedClaims.length,
      convergence_score: convergence,
      paper_readiness: readiness,
      budget_spent_usd: this.state.budget.spent_usd ?? 0,
      budget_remaining_usd: this.state.budget.remaining_usd ?? 0,
      turning_points: turningPoints,
      last_updated: new Date().toISOString(),
    }
  }

  // ── End Triple-Role Methods ─────────────────────────────

  // ── SubAgent Context Trimming ─────────────────────────────

  /**
   * Build claim-graph-aware context slice for a SubAgent.
   * Each agent type receives only task-relevant claims from the graph.
   */
  private buildSubAgentContext(
    agentType: string,
    action: OrchestratorDecision['action'],
  ): string {
    const graph = ClaimGraph.fromJSON(this.state.claimGraph)

    let baseContext: string

    switch (agentType) {
      case 'math-reasoner': {
        const sections: string[] = []
        const target = action.targets_claim
          ? graph.getClaim(action.targets_claim)
          : null
        if (target) {
          sections.push(`## Prove: ${target.statement}`)
          // Assumptions = dependencies that are assumption-type
          const deps = graph
            .getDependencies(action.targets_claim!)
            .map(id => graph.getClaim(id))
            .filter(c => c && c.type === 'assumption')
          if (deps.length > 0) {
            sections.push(
              '## Assumptions\n' +
                deps.map(a => `- ${a!.statement}`).join('\n'),
            )
          }
        } else {
          sections.push(`## Task: ${action.type}`)
        }
        // Admitted lemmas
        const lemmas = graph
          .getClaimsByType('theorem')
          .filter(c => c.phase === 'admitted')
        if (lemmas.length > 0) {
          sections.push(
            '## Available Lemmas\n' +
              lemmas
                .slice(0, 10)
                .map(l => `- [${l.id}] ${truncate(l.statement, 60)}`)
                .join('\n'),
          )
        }
        sections.push(
          `## Experimental Context\n${this.briefExperimentalContext()}`,
        )
        baseContext = sections.join('\n\n')
        break
      }

      case 'experiment-runner': {
        const target = action.targets_claim
          ? graph.getClaim(action.targets_claim)
          : null
        const verify = target ? target.statement : action.type
        baseContext = [
          `## Verify: ${verify}`,
          `## Design: ${action.type}`,
          `## Data: ${this.briefDataContext()}`,
        ].join('\n\n')
        break
      }

      case 'investigator': {
        baseContext = [
          `## Question: ${action.type}`,
          `## Local Knowledge\n${this.briefLiteratureContext()}`,
        ].join('\n\n')
        break
      }

      case 'fragment-writer': {
        const relatedIds = action.related_claims ?? []
        const related = relatedIds
          .map(id => graph.getClaim(id))
          .filter(c => c && c.phase === 'admitted')
        const sections = [`## Write: ${action.type}`]
        if (related.length > 0) {
          sections.push(
            '## Admitted claims to reference:\n' +
              related.map(c => `- ${c!.statement}`).join('\n'),
          )
        }
        baseContext = sections.join('\n\n')
        break
      }

      default:
        baseContext = `## Task: ${action.type}\n\n${action.context}`
        break
    }

    // Append domain knowledge pack context if available
    const dkpContext = this.buildDKPContextForAgent(agentType, action)
    if (dkpContext) {
      baseContext += '\n\n' + dkpContext
    }

    return truncateToTokens(baseContext, 4500)
  }

  /** Compact summary of recent experiment results for math context. */
  private briefExperimentalContext(): string {
    const exps = this.state.artifacts.entries.filter(
      a => a.type === 'experiment_result',
    )
    if (exps.length === 0) return 'No experiments run yet.'
    return exps
      .slice(-5)
      .map(e => `- ${e.description}`)
      .join('\n')
  }

  /** Compact summary of known literature for investigator context. */
  private briefLiteratureContext(): string {
    const la = this.state.literature_awareness
    const parts: string[] = []
    if (la.known_results.length > 0) {
      parts.push('Known results:')
      for (const kr of la.known_results.slice(0, 10)) {
        parts.push(`- ${kr.statement} (${kr.source})`)
      }
    }
    if (la.confirmed_gaps.length > 0) {
      parts.push('Confirmed gaps:')
      for (const cg of la.confirmed_gaps) {
        parts.push(`- ${cg.description}`)
      }
    }
    if (la.deeply_read.length > 0) {
      parts.push(
        `${la.deeply_read.length} papers deeply read, ${la.aware_but_unread.length} more aware of.`,
      )
    }
    return parts.length > 0 ? parts.join('\n') : 'No literature indexed yet.'
  }

  /** Compact summary of available data for experiment context. */
  private briefDataContext(): string {
    const data = this.state.artifacts.entries.filter(
      a =>
        a.type === 'table' ||
        a.type === 'figure' ||
        a.type === 'experiment_result',
    )
    if (data.length === 0) return 'No data available yet.'
    return data
      .slice(-5)
      .map(d => `- [${d.type}] ${d.description}`)
      .join('\n')
  }

  // ── Domain Knowledge Pack Integration ──────────────────────

  /**
   * Initialize DKPLoader from state's loaded_knowledge_packs list.
   * Returns null if no packs are configured.
   */
  private initDKPLoader(state: ResearchState): DKPLoader | null {
    const packIds = state.loaded_knowledge_packs ?? []
    if (packIds.length === 0) return null

    const loader = new DKPLoader()
    let loadedAny = false
    for (const packId of packIds) {
      try {
        loader.load(packId)
        loadedAny = true
      } catch {
        // Pack not found on disk — skip silently
      }
    }
    return loadedAny ? loader : null
  }

  /**
   * Build DKP context tailored to a specific SubAgent type.
   * Each agent gets different knowledge: math-reasoner gets related theorems,
   * experiment-runner gets registries, others get compressed overview.
   */
  private buildDKPContextForAgent(
    agentType: string,
    action: OrchestratorDecision['action'],
  ): string {
    if (!this.dkpLoader) return ''
    const packs = this.dkpLoader.getLoadedPacks()
    if (packs.length === 0) return ''

    const sections: string[] = ['## Domain Knowledge']

    switch (agentType) {
      case 'math-reasoner': {
        // Find theorems related to the target claim via full-text index matching
        const graph = ClaimGraph.fromJSON(this.state.claimGraph)
        const targetClaim = action.targets_claim
          ? graph.getClaim(action.targets_claim)
          : null
        const queryText = targetClaim?.statement ?? action.type ?? ''
        const keywords = this.extractKeywords(queryText)

        for (const pack of packs) {
          const matchedIds = this.searchDKPByKeywords(pack, keywords, 5)
          const entries = this.dkpLoader!.getEntries(
            pack.manifest.id,
            matchedIds,
          )
          if (entries.length > 0) {
            sections.push(`### Related from ${pack.manifest.name}`)
            for (const e of entries) {
              sections.push(
                `[${e.id}] ${e.label}: ${truncate(e.statement, 120)}`,
              )
              if (e.proof_technique)
                sections.push(`  Technique: ${e.proof_technique}`)
            }
          }
        }
        break
      }

      case 'experiment-runner': {
        for (const pack of packs) {
          const ds = pack.registries.datasets
          const bm = pack.registries.benchmarks
          const cb = pack.registries.codebases
          if (ds.length > 0) {
            sections.push(
              '### Standard Datasets\n' +
                ds.map(d => `- ${d.name}: ${d.description}`).join('\n'),
            )
          }
          if (bm.length > 0) {
            sections.push(
              '### Standard Benchmarks\n' +
                bm
                  .map(
                    b => `- ${b.name}: metrics=${b.standard_metrics.join(',')}`,
                  )
                  .join('\n'),
            )
          }
          if (cb.length > 0) {
            sections.push(
              '### Reference Implementations\n' +
                cb
                  .map(c => `- ${c.name} (${c.language}): ${c.implements}`)
                  .join('\n'),
            )
          }
        }
        break
      }

      case 'investigator':
      case 'fragment-writer':
      default: {
        for (const pack of packs) {
          const preview = truncate(pack.overview, 400)
          sections.push(`### ${pack.manifest.name}\n${preview}`)
        }
        break
      }
    }

    return truncateToTokens(sections.join('\n'), 1500)
  }

  /** Extract meaningful keywords from text for DKP index search. */
  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      'a',
      'an',
      'the',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
      'from',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'can',
      'not',
      'no',
      'so',
      'if',
      'then',
      'than',
      'that',
      'this',
      'it',
      'its',
      'we',
      'our',
      'they',
      'their',
      'as',
      'prove',
      'show',
      'claim',
    ])
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w))
  }

  /** Search a loaded DKP's full-text index for entries matching keywords. */
  private searchDKPByKeywords(
    pack: {
      indices: { fullText: Record<string, string[]> }
      manifest: { id: string }
    },
    keywords: string[],
    maxResults: number,
  ): string[] {
    const scores = new Map<string, number>()
    for (const kw of keywords) {
      const ids = pack.indices.fullText[kw]
      if (!ids) continue
      for (const id of ids) {
        scores.set(id, (scores.get(id) ?? 0) + 1)
      }
    }
    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxResults)
      .map(([id]) => id)
  }

  // ── End SubAgent Context Trimming ─────────────────────────

  /**
   * Enrich math-reasoner context with proof budget guidance.
   * Consults ProofBudgetController for rigor requirements.
   */
  private enrichMathContext(context: string, taskType: string): string {
    const pbc = new ProofBudgetController()
    const rigorDecision = pbc.decideRigor(
      {
        id: 'current',
        statement: taskType,
        importance: taskType.toLowerCase().includes('core')
          ? 'core'
          : 'supporting',
        dependencies: [],
      },
      this.state,
    )

    // Store decision so runMathReasoningPostProcess can use it
    this.lastProofBudget = rigorDecision

    const guidance = [
      '\n\n## Proof Budget Guidance',
      `Target rigor: ${rigorDecision.target_rigor}`,
      `Assumption tolerance: ${rigorDecision.assumption_tolerance}`,
      `Max deepening rounds: ${rigorDecision.max_depth_rounds}`,
      `Estimated cost: $${rigorDecision.estimated_cost_usd.toFixed(2)}`,
      `Budget remaining: $${this.state.budget.remaining_usd.toFixed(2)}`,
      `Reasoning: ${rigorDecision.reasoning}`,
    ]

    // Include assumption-reality gaps if any
    const gaps = this.state.theory.proofs.flatMap(p =>
      p.assumption_reality_gaps.filter(
        g => g.gap_severity === 'significant' || g.gap_severity === 'critical',
      ),
    )
    if (gaps.length > 0) {
      guidance.push('')
      guidance.push('## Known Assumption-Reality Gaps (address these):')
      for (const g of gaps) {
        guidance.push(
          `- [${g.gap_severity}] Assumed: "${g.assumption}" vs Reality: "${g.experimental_reality}"`,
        )
      }
    }

    return context + guidance.join('\n')
  }

  // reflect() and decide() removed in Step 6 — replaced by builderPhase(), skepticPhase(), arbiterPhase()

  /**
   * Digest: update the cognitive state based on execution results.
   *
   * In Step 6, claims/evidence are handled by the run() loop directly
   * (addBuilderClaimsToGraph, applyClaimUpdates, registerEvidence).
   * Digest now only handles:
   * 1. Spending recording
   * 2. Literature findings (mechanical)
   * 3. LLM synthesis for literature/theory/paper_type
   */
  async digest(result: ExecutionResult): Promise<ResearchState> {
    let state = this.state

    // ── Phase 1: Record spending ──────────────────────────

    if (result.cost_usd > 0) {
      state = recordSpending(state, result.agent, result.cost_usd)
    }

    // ── Phase 1b: Apply literature findings (if any) ──────

    if (result.literature_findings) {
      const lit = result.literature_findings
      let literatureAwareness = { ...state.literature_awareness }

      if (lit.known_results.length > 0) {
        literatureAwareness = {
          ...literatureAwareness,
          known_results: [
            ...literatureAwareness.known_results,
            ...lit.known_results.map(kr => ({
              statement: kr.statement,
              source: kr.source,
              confidence: kr.confidence,
              directly_usable: kr.directly_usable,
            })),
          ],
        }
      }

      if (lit.papers_found.length > 0) {
        literatureAwareness = {
          ...literatureAwareness,
          aware_but_unread: [
            ...literatureAwareness.aware_but_unread,
            ...lit.papers_found.map(p => ({
              paper_id: p.paper_id,
              title: p.title,
              why_relevant:
                p.abstract?.slice(0, 200) ?? 'Found during investigation',
            })),
          ],
        }
        literatureAwareness.last_comprehensive_search = new Date().toISOString()
      }

      state = { ...state, literature_awareness: literatureAwareness }

      // Save citations to bibliography.bib
      if (lit.citations.length > 0) {
        try {
          const bibManager = new BibTeXManager(
            join(this.projectDir, 'bibliography.bib'),
          )
          for (const citation of lit.citations) {
            if (citation.bibtex) {
              bibManager.appendRawEntry(citation.bibtex)
            }
          }
        } catch {
          // Non-critical
        }
      }
    }

    // ── Phase 2: LLM synthesis (literature/theory/paper_type only) ─────

    try {
      const llmUpdates = await this.digestViaLLM(state, result)
      state = this.applyLLMDigest(state, llmUpdates)
    } catch (error: any) {
      this.callbacks.onProgress(
        `Warning: LLM digest failed (${error.message}), continuing with mechanical updates only`,
      )
    }

    return state
  }

  /**
   * Call an LLM to synthesize higher-order cognitive state updates
   * from the execution result. This catches things the mechanical
   * updates miss: literature awareness, theory state, paper type
   * adjustments, and updates to existing state entries.
   */
  private async digestViaLLM(
    state: ResearchState,
    result: ExecutionResult,
  ): Promise<LLMDigestResult> {
    const stateSummary = buildStateContext(state)

    const existingProofs = state.theory.proofs.map(p => ({
      id: p.id,
      theorem_statement: p.theorem_statement,
      proof_status: p.proof_status,
    }))

    const response = await chatCompletion({
      modelSpec: DEFAULT_MODEL_ASSIGNMENTS.quick,
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: `You are the cognitive synthesis engine of a research system. An agent just completed a task. Determine what literature, theory, and paper-type updates are needed.

NOTE: Claim graph updates (admit, demote, reject, new claims) are handled separately by the Arbiter. Do NOT include claim updates here.

## Current Research State
${stateSummary}

## What Just Happened
Agent: ${result.agent}
Success: ${result.success}
Summary: ${result.summary}
Artifacts produced: ${result.artifacts_produced.join(', ') || 'none'}
${
  result.literature_findings
    ? `Papers found: ${result.literature_findings.papers_found.map(p => `${p.title} (${p.paper_id})`).join('; ') || 'none'}
Known results extracted: ${result.literature_findings.known_results.map(kr => kr.statement).join('; ') || 'none'}
New citations: ${result.literature_findings.citations.map(c => c.key).join(', ') || 'none'}`
    : ''
}

Proof records: ${JSON.stringify(existingProofs)}
Current paper_type: ${state.paper_type}

## Instructions
Determine ONLY literature/theory/paper_type updates warranted by the execution result.

Respond with ONLY valid JSON (no markdown fences):
{
  "literature_updates": {
    "new_known_results": [{"statement": "...", "source": "citation_key", "confidence": 0.9, "directly_usable": true}],
    "new_confirmed_gaps": [{"description": "...", "evidence": "search queries used", "last_checked": "ISO date"}],
    "papers_to_deeply_read": [{"paper_id": "...", "key_takeaways": ["..."], "relevance_to_us": "...", "useful_techniques": ["..."], "potential_conflicts": ["..."]}],
    "papers_to_mark_aware": [{"paper_id": "...", "title": "...", "why_relevant": "..."}]
  },
  "theory_updates": {
    "new_proofs": [{"theorem_statement": "...", "proof_status": "sketch", "assumptions": ["..."], "rigor_level": "informal", "fragment_path": null, "assumption_reality_gaps": []}],
    "updated_proofs": [{"id": "existing-proof-id", "proof_status": "draft", "new_assumption_reality_gaps": []}]
  },
  "paper_type_adjustment": null
}`,
        },
      ],
    })

    const jsonMatch = response.text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as LLMDigestResult
      } catch {
        const repaired = repairTruncatedJSON(response.text)
        if (repaired) return repaired as LLMDigestResult
      }
    }
    throw new Error('Failed to parse LLM digest response')
  }

  /**
   * Apply the LLM-generated digest updates to the research state.
   */
  /** Clamp a value to [0, 1] range for confidence fields */
  private clampConfidence(v: unknown): number {
    const n = typeof v === 'number' ? v : 0.5
    return Math.max(0, Math.min(1, n))
  }

  /** Validate enum value against allowed values, return fallback if invalid */
  private validateEnum<T extends string>(
    value: unknown,
    allowed: readonly T[],
    fallback: T,
  ): T {
    if (
      typeof value === 'string' &&
      (allowed as readonly string[]).includes(value)
    ) {
      return value as T
    }
    return fallback
  }

  private applyLLMDigest(
    state: ResearchState,
    updates: LLMDigestResult,
  ): ResearchState {
    // ── Literature awareness updates ───────────────────────

    const litUpdates = updates.literature_updates
    let literatureAwareness = { ...state.literature_awareness }

    if (litUpdates.new_known_results?.length > 0) {
      literatureAwareness = {
        ...literatureAwareness,
        known_results: [
          ...literatureAwareness.known_results,
          ...litUpdates.new_known_results.map(kr => ({
            statement: String(kr.statement ?? ''),
            source: String(kr.source ?? ''),
            confidence: this.clampConfidence(kr.confidence ?? 0.8),
            directly_usable: Boolean(kr.directly_usable ?? false),
          })),
        ],
      }
    }

    if (litUpdates.new_confirmed_gaps?.length > 0) {
      literatureAwareness = {
        ...literatureAwareness,
        confirmed_gaps: [
          ...literatureAwareness.confirmed_gaps,
          ...litUpdates.new_confirmed_gaps.map(g => ({
            description: g.description,
            evidence: g.evidence,
            last_checked: g.last_checked || new Date().toISOString(),
          })),
        ],
      }
    }

    if (litUpdates.papers_to_deeply_read?.length > 0) {
      literatureAwareness = {
        ...literatureAwareness,
        deeply_read: [
          ...literatureAwareness.deeply_read,
          ...litUpdates.papers_to_deeply_read.map(p => ({
            paper_id: p.paper_id,
            key_takeaways: p.key_takeaways ?? [],
            relevance_to_us: p.relevance_to_us ?? '',
            useful_techniques: p.useful_techniques ?? [],
            potential_conflicts: p.potential_conflicts ?? [],
          })),
        ],
      }
    }

    if (litUpdates.papers_to_mark_aware?.length > 0) {
      literatureAwareness = {
        ...literatureAwareness,
        aware_but_unread: [
          ...literatureAwareness.aware_but_unread,
          ...litUpdates.papers_to_mark_aware.map(p => ({
            paper_id: p.paper_id,
            title: p.title,
            why_relevant: p.why_relevant,
          })),
        ],
      }
    }

    state = { ...state, literature_awareness: literatureAwareness }

    // ── Theory state updates ───────────────────────────────

    const theoryUpdates = updates.theory_updates
    let proofs = [...state.theory.proofs]

    if (theoryUpdates.new_proofs?.length > 0) {
      for (const np of theoryUpdates.new_proofs) {
        proofs.push({
          id: randomUUID(),
          theorem_statement: String(np.theorem_statement ?? ''),
          proof_status: this.validateEnum(
            np.proof_status,
            ['not_started', 'sketch', 'draft', 'rigorous', 'verified'] as const,
            'not_started',
          ),
          assumptions: Array.isArray(np.assumptions)
            ? np.assumptions.map(String)
            : [],
          rigor_level: this.validateEnum(
            np.rigor_level,
            ['informal', 'semi_formal', 'formal'] as const,
            'informal',
          ),
          fragment_path: np.fragment_path ? String(np.fragment_path) : null,
          assumption_reality_gaps: (np.assumption_reality_gaps ?? []).map(
            g => ({
              assumption: String(g.assumption ?? ''),
              experimental_reality: String(g.experimental_reality ?? ''),
              gap_severity: this.validateEnum(
                g.gap_severity,
                ['negligible', 'minor', 'significant', 'critical'] as const,
                'minor',
              ),
            }),
          ),
        })
      }
    }

    if (theoryUpdates.updated_proofs?.length > 0) {
      for (const up of theoryUpdates.updated_proofs) {
        const idx = proofs.findIndex(p => p.id === up.id)
        if (idx !== -1) {
          const existing = proofs[idx]
          proofs[idx] = {
            ...existing,
            proof_status: this.validateEnum(
              up.proof_status,
              [
                'not_started',
                'sketch',
                'draft',
                'rigorous',
                'verified',
              ] as const,
              existing.proof_status,
            ),
            assumption_reality_gaps: [
              ...existing.assumption_reality_gaps,
              ...(up.new_assumption_reality_gaps ?? []).map(g => ({
                assumption: String(g.assumption ?? ''),
                experimental_reality: String(g.experimental_reality ?? ''),
                gap_severity: this.validateEnum(
                  g.gap_severity,
                  ['negligible', 'minor', 'significant', 'critical'] as const,
                  'minor',
                ),
              })),
            ],
          }
        }
      }
    }

    state = { ...state, theory: { proofs } }

    // ── Paper type adjustment ──────────────────────────────

    if (updates.paper_type_adjustment) {
      const adj = updates.paper_type_adjustment
      if (
        adj.new_paper_type &&
        ['theoretical', 'empirical', 'mixed'].includes(adj.new_paper_type)
      ) {
        state = { ...state, paper_type: adj.new_paper_type }
      }
    }

    return state
  }

  /**
   * Enrich experiment-runner context with experiment system info and resource estimation.
   */
  private async enrichExperimentContext(
    context: string,
    taskType: string,
    targetsClaim?: string | null,
  ): Promise<string> {
    const sections: string[] = []

    // Verify Claim: inject target claim statement so the agent knows what to test
    if (targetsClaim) {
      try {
        const graph = ClaimGraph.fromJSON(this.state.claimGraph)
        const claim = graph.getClaim(targetsClaim)
        if (claim) {
          sections.push('## Verify Claim', claim.statement)
        }
      } catch {
        // claim graph may not be available
      }
    }

    // Existing experiments (avoid duplication)
    try {
      const summaries = this.experimentResults.getSummary()
      if (summaries.length > 0) {
        sections.push(
          '## Existing Experiments (avoid duplication)',
          ...summaries.map(
            s => `- [${s.id}] ${s.purpose}: ${s.key_result ?? 'no result yet'}`,
          ),
        )
      }
    } catch {
      // experiment log may not exist yet
    }

    // Inject experiment plan details for this specific experiment
    if (this.state.experiment_plan) {
      const plan = this.state.experiment_plan

      // Try to find the matching planned experiment
      const planned = this.planExecutor?.getNextExperiment()
        ?? plan.experiments.find(
          e =>
            e.claim_target &&
            targetsClaim &&
            (e.claim_target.toLowerCase().includes(targetsClaim.toLowerCase()) ||
              taskType.toLowerCase().includes(e.name.toLowerCase())),
        )

      if (planned && this.planExecutor) {
        // Use PlanExecutor for rich context (includes dataset paths, download status, progress)
        sections.push(this.planExecutor.buildExperimentContext(planned))

        // Also provide the generated initial script as a starting point
        sections.push(
          '',
          '## Initial Script (use as starting point, modify as needed)',
          '```python',
          this.planExecutor.generateInitialScript(planned),
          '```',
        )

        // Mark as running
        this.planExecutor.markExperiment(planned.id, 'running')
      } else if (planned) {
        // Fallback: inject plan details without PlanExecutor
        sections.push(
          '## Planned Experiment Design',
          `ID: ${planned.id}`,
          `Name: ${planned.name}`,
          `Type: ${planned.type}`,
          `Description: ${planned.description}`,
          `Metrics: ${planned.metrics_to_collect.join(', ')}`,
          `Success criteria: ${planned.success_criteria}`,
          `Script outline:\n${planned.script_outline}`,
          `Extra packages: ${planned.python_packages.join(', ') || 'none'}`,
        )
        const relatedDatasets = plan.datasets.filter(d =>
          planned.datasets.includes(d.name),
        )
        if (relatedDatasets.length > 0) {
          sections.push(
            '',
            '## Dataset Download Code',
            ...relatedDatasets.map(
              d =>
                `### ${d.name} (${d.source}${d.source_id ? ':' + d.source_id : ''})\n${d.description}\n\`\`\`python\n${d.download_code}\n\`\`\``,
            ),
          )
        }
      } else {
        // No match — provide full plan summary
        sections.push('', summarizeExperimentPlan(plan))
      }
    }

    // Experiment conventions
    sections.push(
      '## Experiment Conventions',
      '- Tier 1 (probe): single-file probe.py, quick validation',
      '- Tier 2 (run): modular src/, must have tests/, must pass audit',
      '- All python commands via `uv run`',
      '- Set seed = 42',
      '- Output results to results/metrics.json',
      '- Shared data in experiments/shared/data/',
    )

    // Available shared libraries
    const sharedLib = join(this.projectDir, 'experiments', 'shared', 'lib')
    if (existsSync(sharedLib)) {
      sections.push(
        '## Available shared libraries',
        `- experiments/shared/lib/ (check contents before using)`,
      )
    }

    // Resource estimation (original logic)
    try {
      const estimator = new ResourceEstimator()
      const estimate = await estimator.estimate(
        {
          description: taskType + '\n' + context,
          dependencies: [],
        },
        this.options.compute ?? undefined,
      )

      sections.push(
        '## Resource Estimation',
        `GPU required: ${estimate.gpu_required ? 'yes' : 'no'}`,
        `Estimated RAM: ${estimate.ram_gb} GB`,
        `Estimated disk: ${estimate.disk_gb} GB`,
        `Estimated wall time: ${estimate.estimated_wall_time_hours} hours`,
        `Feasible: ${estimate.feasible ? 'yes' : 'NO — ' + (estimate.bottleneck ?? 'unknown bottleneck')}`,
      )

      if (estimate.gpu_required) {
        sections.push(`GPU hours: ${estimate.gpu_hours ?? 'N/A'}`)
        sections.push(`Peak VRAM: ${estimate.peak_vram_gb ?? 'N/A'} GB`)
      }

      if (!estimate.feasible) {
        sections.push(
          '',
          '## WARNING: Resource estimation indicates this experiment may not be feasible.',
          `Bottleneck: ${estimate.bottleneck}`,
          'Consider scaling down or using alternative approaches.',
        )
      }
    } catch {
      // Resource estimation unavailable
    }

    // Inject created experiment directory info
    if (this.lastCreatedExperimentDir && this.lastCreatedExperimentId) {
      sections.push(
        '## Your Experiment Directory',
        `ID: ${this.lastCreatedExperimentId}`,
        `Path: ${this.lastCreatedExperimentDir}`,
        '- Write ALL code in this directory',
        '- Output results to results/metrics.json',
        '- Use `uv run` for all Python commands (venv already set up)',
        '- Seed = 42 (already in meta.json)',
      )
    }

    // Clear experiment creation state after context injection
    this.lastCreatedExperimentId = null
    this.lastCreatedExperimentDir = null

    return sections.length > 0
      ? context + '\n\n' + sections.join('\n')
      : context
  }

  /**
   * Process experiment results after agent execution:
   * update experiment-log, read metrics, extract statistical evidence.
   */
  private async processExperimentResult(
    result: ExecutionResult,
    decision: OrchestratorDecision,
    pool: EvidencePoolManager,
    durationSeconds?: number,
    fallbackExperimentId?: string | null,
  ): Promise<void> {
    const experimentId = this.findExperimentId(result, fallbackExperimentId)
    if (!experimentId) return

    // a) Update experiment-log status
    await this.experimentLog.updateStatus(experimentId, {
      status: result.success ? 'completed' : 'failed',
      key_result: this.extractKeyResult(result),
      duration_seconds:
        durationSeconds != null ? Math.round(durationSeconds) : null,
    })

    // a2) Update plan executor state if tracking this experiment
    const matchedSpec = this.findMatchingPlanSpec(experimentId, decision.action.context)
    if (this.planExecutor && matchedSpec) {
      this.planExecutor.markExperiment(
        matchedSpec.id,
        result.success ? 'completed' : 'failed',
      )
      this.callbacks.onProgress(
        `Plan: ${this.planExecutor.getProgressSummary()}`,
      )
    }

    // b) Read metrics.json and convert to evidence via ExperimentEvidenceConverter
    const metrics = this.experimentResults.readMetrics(experimentId)

    if (metrics) {
      const graph = ClaimGraph.fromJSON(this.state.claimGraph)
      const targetClaimId = decision.action.targets_claim || null

      // Convert metrics → evidence + evaluate success criteria + update confidence
      const conversion = this.evidenceConverter.convert(
        metrics,
        experimentId,
        targetClaimId,
        matchedSpec,
        pool,
        graph,
      )

      this.callbacks.onProgress(`Evidence: ${conversion.summary}`)

      // Update state with modified graph + pool
      this.state = {
        ...this.state,
        claimGraph: graph.toJSON(),
        evidencePool: pool.pool,
      }
    }
  }

  /**
   * Find experiment ID from agent execution result.
   * Uses fallback ID (from experiment creation) first, then looks in
   * artifacts_produced paths and summary text.
   */
  private findExperimentId(
    result: ExecutionResult,
    fallbackId?: string | null,
  ): string | null {
    // Prefer the known experiment ID from creation step
    if (fallbackId) return fallbackId
    // Check artifacts for experiment paths
    for (const artifact of result.artifacts_produced) {
      const match = artifact.match(
        /experiments\/(?:probes|runs)\/((?:probe|run)-\d+-[^/]+)/,
      )
      if (match) return match[1]
    }
    // Fallback: extract from summary text
    const summaryMatch = result.summary?.match(/(probe|run)-\d+-[\w-]+/)
    return summaryMatch?.[0] ?? null
  }

  /**
   * Find a completed tier-1 probe targeting a specific claim.
   * Used to decide whether to promote an existing probe vs create a new one.
   */
  private findCompletedProbeForClaim(
    claimId: string,
  ): ExperimentLogEntry | null {
    if (claimId === 'unknown') return null
    const log = this.experimentLog.load()
    return (
      log.experiments.find(
        e =>
          e.tier === 1 &&
          e.status === 'completed' &&
          e.targets_claim === claimId,
      ) ?? null
    )
  }

  /**
   * Derive a slug-safe experiment name from the orchestrator decision.
   */
  private inferExperimentName(decision: OrchestratorDecision): string {
    const raw = decision.action.type.slice(0, 40)
    return (
      raw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'experiment'
    )
  }

  /**
   * Find the ExperimentSpec from the plan that matches a given experiment ID.
   */
  private findMatchingPlanSpec(
    experimentId: string,
    actionContext?: string,
  ): import('./experiments/types').ExperimentSpec | null {
    if (!this.state.experiment_plan) return null
    return (
      this.state.experiment_plan.experiments.find(
        spec =>
          experimentId.includes(spec.id) ||
          spec.id.includes(experimentId) ||
          (actionContext?.includes(spec.id)),
      ) ?? null
    )
  }

  /**
   * Extract a one-line key result from agent execution summary.
   */
  private extractKeyResult(result: ExecutionResult): string | null {
    if (!result.summary) return null
    const lines = result.summary.split('\n').filter(l => l.trim())
    return lines[0]?.slice(0, 200) ?? null
  }

  /**
   * Run static audit on a Tier 2 experiment before execution.
   * If experimentId is provided, audit that specific experiment.
   * Otherwise, find the most recent Tier 2 with status 'created'.
   * Returns an error message if audit fails, null if it passes or no Tier 2 experiment is pending.
   */
  private async preExperimentAudit(
    experimentId?: string,
  ): Promise<string | null> {
    try {
      let pending: ExperimentLogEntry | null = null

      if (experimentId) {
        pending = this.experimentLog.getExperiment(experimentId) ?? null
      } else {
        const log = this.experimentLog.load()
        pending =
          log.experiments
            .filter(e => e.tier === 2 && e.status === 'created')
            .pop() ?? null
      }

      if (!pending || pending.tier !== 2) return null

      const experimentDir = join(this.projectDir, pending.path)
      const audit = await this.experimentAuditor.staticAudit(experimentDir)
      await this.experimentAuditor.saveAudit(experimentDir, audit)

      if (!audit.passed) {
        const failedChecks = audit.checks
          .filter(c => !c.passed)
          .map(c => c.name)
        await this.experimentLog.updateStatus(pending.id, {
          audit_status: 'failed',
        })
        return `Audit failed for ${pending.id}: ${failedChecks.join(', ')}`
      }

      await this.experimentLog.updateStatus(pending.id, {
        audit_status: 'passed',
      })
      return null
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.callbacks.onProgress(`Audit skipped (infrastructure error): ${msg}`)
      return null
    }
  }

  /**
   * Enrich data-scout context with known data source registry info.
   */
  private enrichDataScoutContext(context: string): string {
    try {
      const da = new DataAcquisition()
      const sources = da.getKnownSources()
      const lines = [
        '\n\n## Known Data Source Registry',
        'The following data sources are pre-configured with download instructions:',
        ...sources.map(
          s =>
            `- ${s.id}: ${s.description} (${s.access}${s.auto_downloadable ? ', auto-downloadable' : ''})`,
        ),
        '',
        'Use these source IDs when available. For unknown sources, investigate manually.',
      ]
      return context + lines.join('\n')
    } catch {
      return context
    }
  }

  /**
   * Enrich investigator context with existing literature info so it
   * doesn't re-download papers or duplicate PaperQA searches.
   */
  private enrichInvestigatorContext(context: string): string {
    const litDir = join(this.projectDir, 'literature')
    const papersDir = join(litDir, 'papers')

    const lines = ['\n\n## Existing Literature']

    // Tell the agent about existing PaperQA index
    if (existsSync(litDir)) {
      lines.push(
        `Literature directory: ${litDir}`,
        'A PaperQA index may already exist here from /deep-research.',
        'Use paperqa_query FIRST to check if the local index can answer your question before searching externally.',
      )
    }

    // List already-downloaded papers
    if (existsSync(papersDir)) {
      try {
        const files = require('fs')
          .readdirSync(papersDir)
          .filter((f: string) => f.endsWith('.pdf'))
        if (files.length > 0) {
          lines.push(
            `\nAlready downloaded papers (${files.length}):`,
            ...files.slice(0, 20).map((f: string) => `- ${f}`),
          )
          if (files.length > 20) {
            lines.push(`  ... and ${files.length - 20} more`)
          }
          lines.push(
            '\nDo NOT re-download these papers. Use pdf_extract or read_file to read them.',
          )
        }
      } catch {
        // ignore
      }
    }

    // Include known results from state
    const knownResults = this.state.literature_awareness.known_results
    if (knownResults.length > 0) {
      lines.push('\nAlready-known results from literature:')
      for (const kr of knownResults.slice(0, 15)) {
        lines.push(`- [${kr.source}] ${kr.statement}`)
      }
    }

    // Include confirmed gaps
    const gaps = this.state.literature_awareness.confirmed_gaps
    if (gaps.length > 0) {
      lines.push('\nConfirmed gaps in literature (no existing solution found):')
      for (const g of gaps) {
        lines.push(`- ${g.description}`)
      }
    }

    return context + lines.join('\n')
  }

  /**
   * Post-process math-reasoner results through MathReasoningController
   * to assess assumption-reality gaps and update theory state.
   */
  private async runMathReasoningPostProcess(
    result: ExecutionResult,
    decision: OrchestratorDecision,
  ): Promise<void> {
    try {
      const controller = new MathReasoningController()

      // Build proof context from current state
      const proofContext: ProofContext = {
        experiment_description:
          this.state.artifacts.entries
            .filter(
              a =>
                a.type === 'experiment_result' || a.type === 'experiment_code',
            )
            .map(a => a.description)
            .join('; ') || 'No experiments run yet',
        data_characteristics:
          this.state.artifacts.entries
            .filter(a => a.type === 'experiment_result')
            .map(a => a.description) || [],
        existing_lemmas: this.state.theory.proofs
          .filter(p => p.proof_status !== 'not_started')
          .map(p => ({
            statement: p.theorem_statement,
            id: p.id,
          })),
        known_results: this.state.literature_awareness.known_results
          .filter(kr => kr.directly_usable)
          .map(kr => ({
            statement: kr.statement,
            source: kr.source,
          })),
      }

      // If we have a stored ProofBudgetDecision, run MathReasoningController.prove()
      // for multi-turn proof interaction with budget-controlled deepening
      if (this.lastProofBudget) {
        const budget = this.lastProofBudget
        this.lastProofBudget = null // consumed

        const theorem: TheoremSpec = {
          id: 'current',
          statement: decision.action.type || result.summary.slice(0, 200),
          importance: budget.target_rigor === 'formal' ? 'core' : 'supporting',
          dependencies: [],
        }

        const proofResult = await controller.prove(
          theorem,
          budget,
          proofContext,
        )

        this.callbacks.onProgress(
          `Math proof: ${proofResult.rigor_achieved} rigor in ${proofResult.rounds_used} round(s), ` +
            `${proofResult.gaps.length} assumption gap(s)`,
        )

        // Store proof record in theory state
        this.state.theory.proofs.push(proofResult.record)
        return
      }

      // Fallback: extract assumptions from the agent's proof output and assess gaps
      const assumptions =
        result.summary
          .match(/\[ASSUMPTION:\s*(.+?)\]/g)
          ?.map(m => m.replace(/\[ASSUMPTION:\s*/, '').replace(/\]$/, '')) ?? []

      if (assumptions.length > 0) {
        const gaps = await controller.assessAssumptionGaps(
          assumptions,
          proofContext,
        )

        if (gaps.length > 0) {
          this.callbacks.onProgress(
            `Math reasoning post-process: found ${gaps.length} assumption-reality gap(s)`,
          )
        }
      }
    } catch (err: any) {
      // Non-critical: don't crash orchestrator, but log for debugging
      this.callbacks.onProgress(
        `Warning: math reasoning post-process failed: ${err.message ?? err}`,
      )
    }
  }

  /** Map agent name to a BudgetCategory */
  /**
   * Identify independent "bonus" tasks that can safely run in parallel
   * with the primary agent decision. Returns an empty array if no
   * parallelizable work is found.
   *
   * Rules for parallel eligibility:
   * 1. Only "read-mostly" agents (investigator, data-scout, fragment-writer)
   *    are eligible as bonus tasks — never experiment-runner or math-reasoner.
   * 2. A bonus task must target a DIFFERENT claim than the primary task.
   * 3. The bonus task's estimated cost must fit within remaining budget.
   * 4. Maximum 2 bonus tasks per cycle to limit cost.
   */
  private identifyParallelTasks(
    primaryDecision: OrchestratorDecision,
    graph: ClaimGraph,
  ): Array<{ agentName: string; task: string; context: string }> {
    // Only parallelize when the primary task is "heavy" (experiment/math/compilation)
    const heavyAgents = ['experiment-runner', 'math-reasoner', 'latex-compiler', 'paper-assembler']
    if (!heavyAgents.includes(primaryDecision.action.delegate_to)) {
      return []
    }

    // Don't parallelize in interactive mode — user approved one action only
    if (this.options.mode === 'interactive') {
      return []
    }

    const primaryTargetClaim = primaryDecision.action.targets_claim
    const primaryRelated = new Set(primaryDecision.action.related_claims ?? [])
    if (primaryTargetClaim) primaryRelated.add(primaryTargetClaim)

    const bonusTasks: Array<{ agentName: string; task: string; context: string }> = []
    const MAX_BONUS = 2
    let cumulativeEstCost = 0

    // Look for proposed claims that need investigation (independent of primary target)
    const unresolvedClaims = getUnresolvedClaims(this.state)
    for (const claim of unresolvedClaims) {
      if (bonusTasks.length >= MAX_BONUS) break
      if (primaryRelated.has(claim.id)) continue // skip claims related to primary task
      if (claim.phase !== 'proposed') continue

      // Check budget for a lightweight investigation (~$0.05), accounting for
      // already-planned bonus tasks to avoid over-committing.
      const estCost = 0.05
      if (this.budgetTracker.wouldExceedBudget(cumulativeEstCost + estCost)) break
      cumulativeEstCost += estCost

      // Use a unique notes prefix to avoid filesystem races with other parallel agents
      const notePrefix = `parallel_${claim.id.slice(0, 8)}`
      bonusTasks.push({
        agentName: 'investigator',
        task: `Investigate claim: "${claim.statement}"`,
        context: this.buildSubAgentContext('investigator', {
          type: `Investigate proposed claim`,
          delegate_to: 'investigator',
          context: `Focus on claim: "${claim.statement}" (${claim.type}, ${claim.epistemicLayer} layer). Search for supporting or contradicting evidence in literature.\n\nIMPORTANT: This is a parallel bonus task. Save notes to literature/notes/${notePrefix}_*.md to avoid file conflicts. Do NOT modify shared .bib files directly.`,
          model_preference: 'default',
          estimated_cost_usd: estCost,
          priority: 'low',
          if_this_fails: 'skip',
          targets_claim: claim.id,
        }),
      })
    }

    return bonusTasks
  }

  private agentToCategory(agentName: string): BudgetCategory {
    const map: Record<string, BudgetCategory> = {
      'experiment-runner': 'experiment',
      'data-scout': 'experiment',
      'result-analyzer': 'experiment',
      'math-reasoner': 'proof',
      'fragment-writer': 'writing',
      'paper-assembler': 'writing',
      reviewer: 'review',
      'revision-handler': 'review',
      investigator: 'investigation',
    }
    return map[agentName] ?? 'other'
  }

  /** Infer artifact type from agent name for ResearchState.artifacts */
  private inferArtifactType(agentName: string): ArtifactEntry['type'] {
    const map: Record<string, ArtifactEntry['type']> = {
      'experiment-runner': 'experiment_code',
      'result-analyzer': 'experiment_result',
      'fragment-writer': 'fragment',
      'paper-assembler': 'paper_draft',
      'math-reasoner': 'proof',
      reviewer: 'review',
      'data-scout': 'experiment_result',
      investigator: 'literature_survey',
    }
    return map[agentName] ?? 'fragment'
  }

  /** Get the BudgetTracker instance (for external access, e.g. auto-mode) */
  getBudgetTracker(): BudgetTracker {
    return this.budgetTracker
  }

  /**
   * Determine if the orchestrator should stop.
   */
  private isDone(): boolean {
    // Budget exhausted
    if (this.state.budget.remaining_usd <= 0) return true

    // Main-claim fast-path: all *active* main claims admitted → paper ready
    const graph = ClaimGraph.fromJSON(this.state.claimGraph)
    const activeMainClaims = graph.getActiveMainClaims()
    if (
      activeMainClaims.length > 0 &&
      activeMainClaims.every(c => c.phase === 'admitted')
    ) {
      return true
    }

    // Stability-based completion
    const s = this.state.stability
    if (s.paperReadiness === 'ready') return true
    if (
      this.researchStance === 'exploratory' &&
      s.paperReadiness === 'nearly_ready'
    )
      return true

    // Check if we have a compiled PDF and reviews are positive
    if (this.state.artifacts.compiled_pdf) {
      const reviewArtifacts = this.state.artifacts.entries.filter(
        a => a.type === 'review',
      )
      if (reviewArtifacts.length > 0 && s.paperReadiness === 'nearly_ready') {
        return true
      }
    }

    return false
  }

  /**
   * Scan the fragments/ directory for new .tex files and register them
   * in the FragmentStore index. This ensures the index stays in sync
   * even when agents write fragments directly via write_file.
   */
  private syncFragmentIndex(agentName: string, artifacts: string[]): void {
    try {
      const fragmentDir = join(this.projectDir, 'fragments')
      if (!existsSync(fragmentDir)) return

      const existingPaths = new Set(
        this.fragmentStore.list().map(f => f.file_path),
      )

      const validTypes: FragmentType[] = [
        'proofs',
        'derivations',
        'algorithms',
        'definitions',
        'experiments',
        'related_work',
        'figures',
        'tables',
      ]

      // 1. Check explicitly reported artifact paths
      for (const artifact of artifacts) {
        const normalized = artifact.startsWith('fragments/')
          ? artifact
          : artifact.startsWith(this.projectDir)
            ? artifact.slice(this.projectDir.length + 1)
            : null
        if (!normalized || !normalized.startsWith('fragments/')) continue
        if (existingPaths.has(normalized)) continue
        if (!normalized.endsWith('.tex')) continue

        // Infer type from directory
        const parts = normalized.split('/')
        const typeName = parts[1] as FragmentType | undefined
        if (!typeName || !validTypes.includes(typeName)) continue

        // Read first line as title
        const fullPath = join(this.projectDir, normalized)
        if (!existsSync(fullPath)) continue
        const content = readFileSync(fullPath, 'utf-8')
        const titleMatch = content.match(
          /\\(?:section|subsection|paragraph|begin\{theorem\}|begin\{lemma\})\{?([^}\n]+)/,
        )
        const title =
          titleMatch?.[1]?.trim() ?? parts[parts.length - 1].replace('.tex', '')

        this.fragmentStore.create(typeName, title, content, {
          created_by: agentName,
        })
        existingPaths.add(normalized)
      }

      // 2. Scan fragments/ directory for unindexed .tex files
      for (const typeName of validTypes) {
        const typeDir = join(fragmentDir, typeName)
        if (!existsSync(typeDir)) continue
        let files: string[]
        try {
          files = readdirSync(typeDir).filter(f => f.endsWith('.tex'))
        } catch {
          continue
        }
        for (const file of files) {
          const relPath = join('fragments', typeName, file)
          if (existingPaths.has(relPath)) continue

          const fullPath = join(typeDir, file)
          const content = readFileSync(fullPath, 'utf-8')
          const titleMatch = content.match(
            /\\(?:section|subsection|paragraph|begin\{theorem\}|begin\{lemma\})\{?([^}\n]+)/,
          )
          const title = titleMatch?.[1]?.trim() ?? file.replace('.tex', '')

          this.fragmentStore.create(typeName, title, content, {
            created_by: agentName,
          })
          existingPaths.add(relPath)
        }
      }
    } catch {
      // Non-critical — don't crash the orchestrator
    }
  }

  /**
   * Snapshot files in key project subdirectories for before/after comparison.
   */
  private snapshotProjectFiles(): Set<string> {
    const files = new Set<string>()
    const dirs = ['fragments', 'experiments', 'literature', 'paper', 'data']
    for (const dir of dirs) {
      const fullDir = join(this.projectDir, dir)
      if (!existsSync(fullDir)) continue
      this.walkDir(fullDir, this.projectDir, files)
    }
    return files
  }

  private walkDir(dir: string, base: string, out: Set<string>): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          this.walkDir(full, base, out)
        } else {
          out.add(full.slice(base.length + 1))
        }
      }
    } catch {
      // ignore unreadable dirs
    }
  }

  /**
   * Discover files created during agent execution by comparing snapshots.
   */
  private discoverNewArtifacts(before: Set<string>): string[] {
    const after = this.snapshotProjectFiles()
    return [...after].filter(f => !before.has(f))
  }

  /**
   * Infer artifact type from file path.
   */
  private inferArtifactTypeFromPath(path: string): ArtifactEntry['type'] {
    if (path.startsWith('fragments/')) return 'fragment'
    if (path.startsWith('experiments/')) return 'experiment_code'
    if (path.startsWith('literature/')) return 'literature_survey'
    if (path.startsWith('paper/')) return 'paper_draft'
    if (path.endsWith('.csv') || path.endsWith('.json'))
      return 'experiment_result'
    if (path.endsWith('.tex')) return 'fragment'
    return 'fragment'
  }

  /**
   * Auto-trigger the full writing pipeline when research converges.
   * Uses NarrativePlanner + SectionWriter + LaTeX compilation in one pass.
   */
  private async triggerWritingPipeline(): Promise<void> {
    this.callbacks.onProgress('Auto-triggering writing pipeline...')
    try {
      const pipeline = new WritingPipeline({
        projectDir: this.projectDir,
        state: this.state,
        onProgress: (_phase, msg) =>
          this.callbacks.onProgress(`[Writing] ${msg}`),
      })
      const result = await pipeline.run()
      if (result.success && result.pdfPath) {
        this.state = {
          ...this.state,
          artifacts: {
            ...this.state.artifacts,
            compiled_pdf: result.pdfPath,
          },
        }
        this.state = addArtifact(this.state, {
          type: 'paper_draft',
          path: result.pdfPath,
          created_by: 'writing-pipeline',
          description: 'Auto-generated from convergence trigger',
        })
        this.state = addTrajectoryEntry(this.state, {
          action_type: 'write_paper',
          agent: 'writing-pipeline',
          description: 'Writing pipeline completed',
          outcome: `PDF at ${result.pdfPath}`,
          state_changes: ['artifacts.compiled_pdf'],
        })
      } else {
        const warnSummary = result.warnings.slice(0, 3).join('; ')
        this.callbacks.onProgress(
          `Writing pipeline completed with issues: ${warnSummary}`,
        )
      }
      this.checkpoint()
    } catch (error: any) {
      this.callbacks.onError(error)
    }
  }

  /**
   * Auto-trigger LaTeX compilation after paper-assembler finishes.
   * Dispatches the latex-compiler agent to compile the assembled paper.
   */
  private async triggerCompilation(): Promise<void> {
    this.callbacks.onProgress('Auto-triggering LaTeX compilation...')

    try {
      const result = await this.callbacks.executeAgent(
        'latex-compiler',
        'Compile the assembled paper to PDF',
        `The paper has been assembled from fragments. Compile it using latexmk.
Look for main.tex in the project directory. If compilation fails, diagnose
and fix errors (up to 5 retries). Report the final PDF path.`,
      )

      if (result.success) {
        // Record compilation artifact
        for (const artifact of result.artifacts_produced) {
          if (artifact.endsWith('.pdf')) {
            this.state = {
              ...this.state,
              artifacts: {
                ...this.state.artifacts,
                compiled_pdf: artifact,
              },
            }
          }
          this.state = addArtifact(this.state, {
            type: 'paper_draft',
            path: artifact,
            created_by: 'latex-compiler',
            description: 'Compiled PDF from paper assembly',
          })
        }

        if (result.cost_usd > 0) {
          this.budgetTracker.recordCost(result.cost_usd, 'other')
        }

        this.callbacks.onProgress('LaTeX compilation complete')
      } else {
        this.callbacks.onProgress(
          `LaTeX compilation failed: ${result.summary.slice(0, 100)}`,
        )
      }
    } catch (error: any) {
      this.callbacks.onProgress(`LaTeX compilation error: ${error.message}`)
    }
  }

  /**
   * Save state to disk and sync durable research infrastructure.
   */
  private checkpoint(): void {
    saveResearchState(this.projectDir, this.state)

    // Sync three-layer research plan (P2)
    try {
      syncPlanFromState(this.projectDir, this.state)
    } catch {
      // Non-critical — plan sync failure should not block research
    }

    // Refresh method scoreboard (P4)
    try {
      refreshScoreboard(this.projectDir, this.state)
    } catch {
      // Non-critical
    }
  }

  /**
   * Record a decision artifact for audit trail (P3).
   */
  private recordDecisionArtifact(decision: OrchestratorDecision): void {
    try {
      const artifact = createDecisionArtifact({
        cycle: this.state.orchestrator_cycle_count,
        action: decision.action,
        reasoning: decision.reasoning,
        state: {
          stability: this.state.stability,
          budget: this.state.budget,
        },
      })
      recordDecision(this.projectDir, artifact)
    } catch {
      // Non-critical — decision recording failure should not block research
    }
  }
}
