import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { Proposal } from './proposal/types'
import type { ExperimentPlan } from './experiments/types'
import { chatCompletion } from './llm-client'
import { DEFAULT_MODEL_ASSIGNMENTS } from './types'
import { ClaimGraph, type ClaimInput } from './claim-graph/index'
import type {
  ClaimGraphData,
  ClaimPhase,
  ClaimType,
  EpistemicLayer,
  EvidenceStrengthType,
} from './claim-graph/types'
import { EvidencePoolManager, type EvidencePool } from './evidence-pool'

// ── Stability Metrics ───────────────────────────────────

export interface StabilityMetrics {
  convergenceScore: number // 0-1
  admittedClaimCount: number
  proposedClaimCount: number
  weakestBridge: { claimId: string; vulnerability: number } | null
  paperReadiness: 'not_ready' | 'needs_work' | 'nearly_ready' | 'ready'
  evidenceCoverage: number
  lastArbiterAssessment: string
}

// ── Literature Awareness ─────────────────────────────────

export interface DeepReadPaper {
  paper_id: string
  key_takeaways: string[]
  relevance_to_us: string
  useful_techniques: string[]
  potential_conflicts: string[]
}

export interface KnownResult {
  statement: string
  source: string // citation key
  confidence: number
  directly_usable: boolean // can we cite directly in our proof
}

export interface ConfirmedGap {
  description: string
  evidence: string // what queries we searched
  last_checked: string
}

export interface LiteratureAwareness {
  deeply_read: DeepReadPaper[]
  aware_but_unread: { paper_id: string; title: string; why_relevant: string }[]
  known_results: KnownResult[]
  confirmed_gaps: ConfirmedGap[]
  last_comprehensive_search: string | null
}

// ── Theory State ─────────────────────────────────────────

export interface AssumptionGap {
  assumption: string
  experimental_reality: string
  gap_severity: 'negligible' | 'minor' | 'significant' | 'critical'
}

export interface ProofRecord {
  id: string
  theorem_statement: string
  proof_status: 'not_started' | 'sketch' | 'draft' | 'rigorous' | 'verified'
  assumptions: string[]
  rigor_level: 'informal' | 'semi_formal' | 'formal'
  fragment_path: string | null
  assumption_reality_gaps: AssumptionGap[]
}

export interface TheoryState {
  proofs: ProofRecord[]
}

// ── Resource State ───────────────────────────────────────

export interface BudgetState {
  total_usd: number
  spent_usd: number
  remaining_usd: number
  warn_at_percent: number
  breakdown: { category: string; spent_usd: number }[]
}

export interface TimeState {
  started_at: string
  estimated_completion: string | null
  deadline: string | null
}

// ── Artifact Store ───────────────────────────────────────

export interface ArtifactEntry {
  id: string
  type:
    | 'literature_survey'
    | 'gap_report'
    | 'proposal'
    | 'experiment_code'
    | 'experiment_result'
    | 'figure'
    | 'table'
    | 'proof'
    | 'fragment'
    | 'paper_draft'
    | 'review'
    | 'compiled_pdf'
  path: string
  created_by: string // agent name
  created_at: string
  description: string
}

export interface ArtifactStore {
  entries: ArtifactEntry[]
  literature_db: string | null
  selected_proposal: string | null
  paper_tex: string | null
  compiled_pdf: string | null
}

// ── Trajectory ───────────────────────────────────────────

export interface TrajectoryEntry {
  timestamp: string
  action_type: string
  agent: string
  description: string
  outcome: string
  state_changes: string[] // summary of what changed
  claim_graph_delta?: {
    claims_added: number
    claims_admitted: number
    claims_demoted: number
    claims_rejected: number
    claims_reformulated?: number
    edges_added: number
  }
  // Triple-role fields (Step 6) — optional for backward compat
  cycle?: number
  builder_output_summary?: string
  skeptic_challenges_summary?: string
  arbiter_decision_summary?: string
  // Experiment evaluation (feedback loop)
  experiment_evaluation?: import('./experiments/experiment-evaluator').ExperimentEvaluation
  // Effort controller tracking
  effort_levels?: {
    builder: 'medium' | 'high'
    skeptic: 'medium' | 'high'
    arbiter: 'medium' | 'high'
    escalation_reasons?: string[]
  }
}

// ── System Capabilities ──────────────────────────────────

export interface SystemCapabilities {
  os: string
  cpu_cores: number
  ram_gb: number
  gpu: string | null
  disk_free_gb: number
  python_version: string | null
  has_uv: boolean
  has_docker: boolean
}

// ── Top-Level Research State ─────────────────────────────

export type PaperType = 'theoretical' | 'empirical' | 'mixed'

export interface ResearchState {
  id: string
  proposal: Proposal
  paper_type: PaperType

  // Cognitive layer — ClaimGraph + EvidencePool as single source of truth
  claimGraph: ClaimGraphData
  evidencePool: EvidencePool
  stability: StabilityMetrics

  // Literature awareness
  literature_awareness: LiteratureAwareness

  // Theory layer
  theory: TheoryState

  // Resource layer
  budget: BudgetState
  time: TimeState
  compute: SystemCapabilities | null

  // Artifact layer
  artifacts: ArtifactStore

  // History
  trajectory: TrajectoryEntry[]

  // Domain knowledge packs loaded in this session
  loaded_knowledge_packs: string[]

  // Experiment plan (generated from proposal before orchestration starts)
  experiment_plan?: ExperimentPlan | null

  // Experiment feedback (evaluation history for retreat detection)
  experiment_feedback?: {
    evaluations: import('./experiments/experiment-evaluator').ExperimentEvaluation[]
    claim_histories: Record<string, import('./experiments/experiment-evaluator').ClaimExperimentHistory>
  }

  // Meta
  initialized: boolean
  orchestrator_cycle_count: number
}

// ── Factory Functions ────────────────────────────────────

export function createEmptyLiteratureAwareness(): LiteratureAwareness {
  return {
    deeply_read: [],
    aware_but_unread: [],
    known_results: [],
    confirmed_gaps: [],
    last_comprehensive_search: null,
  }
}

export function createEmptyBudget(totalUsd = 100): BudgetState {
  return {
    total_usd: totalUsd,
    spent_usd: 0,
    remaining_usd: totalUsd,
    warn_at_percent: 20,
    breakdown: [],
  }
}

export function createEmptyArtifactStore(): ArtifactStore {
  return {
    entries: [],
    literature_db: null,
    selected_proposal: null,
    paper_tex: null,
    compiled_pdf: null,
  }
}

export function createEmptyStability(): StabilityMetrics {
  return {
    convergenceScore: 0,
    admittedClaimCount: 0,
    proposedClaimCount: 0,
    weakestBridge: null,
    paperReadiness: 'not_ready',
    evidenceCoverage: 0,
    lastArbiterAssessment: '',
  }
}

/**
 * Compute basic stability metrics from ClaimGraph and EvidencePool.
 * @deprecated Use {@link ConvergenceDetector.compute} for the full 4-component
 * weighted convergence formula. This simplified version is kept only for
 * bootstrap-time use in {@link enrichStateWithLLM} where trajectory data
 * is not yet available.
 */
export function computeBasicStability(
  graph: ClaimGraph,
  pool: EvidencePoolManager,
): StabilityMetrics {
  const stats = graph.getStatistics()
  const total = stats.total || 1
  const admittedRatio = stats.admitted / total
  const proposedRatio = stats.proposed / total

  // Convergence: higher when more claims are admitted, lower when many are proposed
  const convergenceScore = Math.min(
    1,
    admittedRatio * 1.5 - proposedRatio * 0.5,
  )

  // Evidence coverage: what % of admitted claims have evidence
  const admittedClaims = graph.getClaimsByPhase('admitted')
  const admittedIds = admittedClaims.map(c => c.id)
  const claimTypes = new Map(admittedClaims.map(c => [c.id, c.type]))
  const evidenceCoverage = pool.coverageRate(admittedIds, claimTypes)

  // Paper readiness
  let paperReadiness: StabilityMetrics['paperReadiness'] = 'not_ready'
  if (stats.admitted >= 3 && convergenceScore > 0.3) {
    paperReadiness = 'needs_work'
  }
  if (stats.admitted >= 5 && convergenceScore > 0.5 && evidenceCoverage > 0.3) {
    paperReadiness = 'nearly_ready'
  }
  if (stats.admitted >= 5 && convergenceScore > 0.7 && evidenceCoverage > 0.5) {
    paperReadiness = 'ready'
  }

  // Weakest bridge
  const bridges = graph.findWeakestBridges()
  const weakestBridge =
    bridges.length > 0
      ? {
          claimId: bridges[0].claim.id,
          vulnerability: bridges[0].vulnerability,
        }
      : null

  return {
    convergenceScore: Math.max(0, convergenceScore),
    admittedClaimCount: stats.admitted,
    proposedClaimCount: stats.proposed,
    weakestBridge,
    paperReadiness,
    evidenceCoverage,
    lastArbiterAssessment: '',
  }
}

// ── Claim Query Helpers ──────────────────────────────────

export function getClaimsByPhase(
  state: ResearchState,
  phase: ClaimPhase,
): ClaimGraphData['claims'] {
  return state.claimGraph.claims.filter(c => c.phase === phase)
}

export function getUnresolvedClaims(
  state: ResearchState,
): ClaimGraphData['claims'] {
  return state.claimGraph.claims.filter(
    c => c.phase === 'proposed' || c.phase === 'under_investigation',
  )
}

export function getAdmittedClaims(
  state: ResearchState,
): ClaimGraphData['claims'] {
  return state.claimGraph.claims.filter(c => c.phase === 'admitted')
}

// ── Fallback Claim Generation ────────────────────────────

/**
 * Create initial ClaimInput[] from a proposal.
 * Replaces the old generateFallbackBeliefs/Uncertainties/Risks.
 */
export function generateFallbackClaims(proposal: Proposal): ClaimInput[] {
  const claims: ClaimInput[] = []

  // Methodology feasibility → assumption claim
  claims.push({
    type: 'assumption',
    epistemicLayer: 'explanation',
    statement: `The proposed methodology (${proposal.methodology}) is sound and feasible`,
    phase: 'proposed',
    evidence: { grounded: [], derived: [] },
    strength: {
      confidence: proposal.feasibility.score,
      evidenceType: 'heuristic_motivation',
      vulnerabilityScore: 1 - proposal.feasibility.score,
    },
    created_by: 'proposal',
  })

  // Each innovation → hypothesis claim (main claims)
  for (const innovation of proposal.innovation) {
    const text =
      typeof innovation === 'string'
        ? innovation
        : ((innovation as any).description ?? String(innovation))
    claims.push({
      type: 'hypothesis',
      epistemicLayer: 'explanation',
      statement: text,
      phase: 'proposed',
      evidence: { grounded: [], derived: [] },
      strength: {
        confidence: proposal.novelty_score * 0.8,
        evidenceType: 'heuristic_motivation',
        vulnerabilityScore: 0.5,
      },
      created_by: 'proposal',
      is_main: true,
      depth: 0,
    })
  }

  // Risk → limitation claim
  if (proposal.risk) {
    claims.push({
      type: 'limitation',
      epistemicLayer: 'observation',
      statement: proposal.risk.description,
      phase: 'proposed',
      evidence: { grounded: [], derived: [] },
      strength: {
        confidence: 0.5,
        evidenceType: 'heuristic_motivation',
        vulnerabilityScore:
          proposal.risk.level === 'high'
            ? 0.8
            : proposal.risk.level === 'medium'
              ? 0.5
              : 0.3,
      },
      created_by: 'proposal',
    })
  }

  return claims
}

/**
 * Initialize a ResearchState from a selected proposal.
 * Creates initial ClaimGraph, empty EvidencePool, and zero StabilityMetrics.
 * Call enrichStateWithLLM() afterward for context-specific cognitive init.
 */
export function initializeFromProposal(
  proposal: Proposal,
  options?: {
    budget_usd?: number
    paper_type?: PaperType
    compute?: SystemCapabilities | null
    literature_db?: string
  },
): ResearchState {
  const now = new Date().toISOString()

  // Build initial claim graph from proposal
  const graph = new ClaimGraph()
  const fallbackClaims = generateFallbackClaims(proposal)
  for (const claim of fallbackClaims) {
    graph.addClaim(claim)
  }

  const budgetUsd = options?.budget_usd ?? 100
  const artifacts = createEmptyArtifactStore()
  if (options?.literature_db) {
    artifacts.literature_db = options.literature_db
  }

  return {
    id: randomUUID(),
    proposal,
    paper_type: options?.paper_type ?? 'mixed',

    claimGraph: graph.toJSON(),
    evidencePool: { grounded: [], derived: [] },
    stability: createEmptyStability(),

    literature_awareness: createEmptyLiteratureAwareness(),
    theory: { proofs: [] },

    budget: createEmptyBudget(budgetUsd),
    time: {
      started_at: now,
      estimated_completion: null,
      deadline: null,
    },
    compute: options?.compute ?? null,

    artifacts,
    trajectory: [],

    loaded_knowledge_packs: [],

    initialized: true,
    orchestrator_cycle_count: 0,
  }
}

/**
 * Enrich a ResearchState with LLM-derived claims.
 * Replaces template claims with context-specific ones.
 * Safe to skip — the state is usable with template values.
 */
export async function enrichStateWithLLM(
  state: ResearchState,
): Promise<{ state: ResearchState; error?: string }> {
  try {
    const result = await generateCognitiveInit(state.proposal, state.paper_type)
    const graph = new ClaimGraph()
    for (const claim of result.claims) {
      graph.addClaim(claim)
    }
    // Add edges
    for (const edge of result.edges) {
      try {
        graph.addEdge(edge)
      } catch {
        // Skip edges that reference invalid claim IDs
      }
    }

    // Post-tag main claims by matching against proposal innovations
    const innovations = state.proposal.innovation.map(i =>
      (typeof i === 'string'
        ? i
        : ((i as any).description ?? String(i))
      ).toLowerCase(),
    )
    for (const claim of graph.allClaims) {
      const stmt = claim.statement.toLowerCase()
      for (const innov of innovations) {
        const prefix = innov.slice(0, 40)
        if (stmt.includes(prefix) || jaccardSimilarity(stmt, innov) >= 0.5) {
          graph.updateClaim(claim.id, { is_main: true, depth: 0 })
          break
        }
      }
    }
    // Fallback: if LLM diverged and no main claims found, re-add them
    if (graph.getMainClaims().length === 0) {
      for (const fc of generateFallbackClaims(state.proposal).filter(
        c => c.is_main,
      )) {
        graph.addClaim(fc)
      }
    }

    const pool = new EvidencePoolManager(state.evidencePool)
    return {
      state: {
        ...state,
        claimGraph: graph.toJSON(),
        stability: computeBasicStability(graph, pool),
      },
    }
  } catch (err: unknown) {
    // LLM unavailable — keep template values, but surface the reason
    const message = err instanceof Error ? err.message : String(err)
    return { state, error: message }
  }
}

/** LLM-derived cognitive initialization from proposal context */
async function generateCognitiveInit(
  proposal: Proposal,
  paperType: PaperType,
): Promise<{
  claims: ClaimInput[]
  edges: {
    source: string
    target: string
    relation: 'depends_on' | 'supports' | 'contradicts' | 'motivates'
    strength: 'strong' | 'moderate' | 'weak' | 'conjectured'
  }[]
}> {
  const prompt = `You are a research advisor analyzing a research proposal. Generate initial claims for an adaptive research orchestrator's Claim Graph.

PROPOSAL:
- Title: ${proposal.title}
- Methodology: ${proposal.methodology}
- Innovation: ${proposal.innovation.map(i => (typeof i === 'string' ? i : ((i as any).description ?? String(i)))).join('; ')}
- Feasibility score: ${proposal.feasibility.score}
- Data required: ${proposal.feasibility.data_required}
- Paper type: ${paperType}
${proposal.risk ? `- Known risk: ${proposal.risk.description} (${proposal.risk.level})` : ''}

Generate a JSON object with:

1. "claims": Array of 4-7 claims. Each has:
   - "type": "observation" | "assumption" | "hypothesis" | "theorem" | "algorithmic" | "empirical" | "novelty" | "benchmark" | "limitation"
   - "epistemicLayer": "observation" | "explanation" | "exploitation" | "justification"
   - "statement": the claim
   - "confidence": 0-1 initial confidence
   - "evidenceType": "theorem_support" | "empirical_support" | "heuristic_motivation" | "ablation_support" | "consistent_with" | "no_support"
   - "vulnerabilityScore": 0-1, how vulnerable is this claim to being refuted

2. "edges": Array of 0-5 edges between claims. Each has:
   - "source_idx": index into claims array (0-based)
   - "target_idx": index into claims array (0-based)
   - "relation": "depends_on" | "supports" | "contradicts" | "motivates"
   - "strength": "strong" | "moderate" | "weak" | "conjectured"

Be specific to THIS proposal's domain, methodology, and data. Do NOT use generic templates.
Return ONLY valid JSON.`

  const response = await chatCompletion({
    modelSpec: DEFAULT_MODEL_ASSIGNMENTS.quick,
    system:
      'You are a research advisor. Return only valid JSON, no markdown fences.',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 4096,
    temperature: 0.3,
  })

  const text = response.text.trim()
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No JSON in response')

  const parsed = JSON.parse(jsonMatch[0])

  const claims: ClaimInput[] = (parsed.claims ?? []).map(
    (c: {
      type?: string
      epistemicLayer?: string
      statement: string
      confidence?: number
      evidenceType?: string
      vulnerabilityScore?: number
    }) => ({
      type: ([
        'observation',
        'assumption',
        'hypothesis',
        'theorem',
        'algorithmic',
        'empirical',
        'novelty',
        'benchmark',
        'limitation',
      ].includes(c.type ?? '')
        ? c.type
        : 'hypothesis') as ClaimType,
      epistemicLayer: ([
        'observation',
        'explanation',
        'exploitation',
        'justification',
      ].includes(c.epistemicLayer ?? '')
        ? c.epistemicLayer
        : 'explanation') as EpistemicLayer,
      statement: c.statement,
      phase: 'proposed' as ClaimPhase,
      evidence: { grounded: [], derived: [] },
      strength: {
        confidence: Math.max(0, Math.min(1, c.confidence ?? 0.5)),
        evidenceType: ([
          'theorem_support',
          'empirical_support',
          'heuristic_motivation',
          'ablation_support',
          'consistent_with',
          'no_support',
        ].includes(c.evidenceType ?? '')
          ? c.evidenceType
          : 'heuristic_motivation') as EvidenceStrengthType,
        vulnerabilityScore: Math.max(
          0,
          Math.min(1, c.vulnerabilityScore ?? 0.5),
        ),
      },
      created_by: 'proposal',
    }),
  )

  // Build a temporary graph to get claim IDs for edges
  const tempGraph = new ClaimGraph()
  const claimIds: string[] = []
  for (const claim of claims) {
    claimIds.push(tempGraph.addClaim(claim))
  }

  const edges: {
    source: string
    target: string
    relation: 'depends_on' | 'supports' | 'contradicts' | 'motivates'
    strength: 'strong' | 'moderate' | 'weak' | 'conjectured'
  }[] = []
  for (const e of parsed.edges ?? []) {
    const srcIdx = e.source_idx ?? e.source
    const tgtIdx = e.target_idx ?? e.target
    if (
      typeof srcIdx === 'number' &&
      typeof tgtIdx === 'number' &&
      srcIdx < claimIds.length &&
      tgtIdx < claimIds.length
    ) {
      edges.push({
        source: claimIds[srcIdx],
        target: claimIds[tgtIdx],
        relation: ([
          'depends_on',
          'supports',
          'contradicts',
          'motivates',
        ].includes(e.relation)
          ? e.relation
          : 'supports') as any,
        strength: (['strong', 'moderate', 'weak', 'conjectured'].includes(
          e.strength,
        )
          ? e.strength
          : 'moderate') as any,
      })
    }
  }

  // Return claims from the temp graph (which now have IDs assigned)
  // But the caller will create a new graph, so we return ClaimInputs
  return { claims, edges }
}

// ── Mutation Helpers ─────────────────────────────────────

export function addTrajectoryEntry(
  state: ResearchState,
  entry: Omit<TrajectoryEntry, 'timestamp'>,
): ResearchState {
  return {
    ...state,
    trajectory: [
      ...state.trajectory,
      { ...entry, timestamp: new Date().toISOString() },
    ],
    orchestrator_cycle_count: state.orchestrator_cycle_count + 1,
  }
}

export function recordSpending(
  state: ResearchState,
  category: string,
  amount_usd: number,
): ResearchState {
  const existing = state.budget.breakdown.find(b => b.category === category)
  const breakdown = existing
    ? state.budget.breakdown.map(b =>
        b.category === category
          ? { ...b, spent_usd: b.spent_usd + amount_usd }
          : b,
      )
    : [...state.budget.breakdown, { category, spent_usd: amount_usd }]

  const spent = state.budget.spent_usd + amount_usd
  return {
    ...state,
    budget: {
      ...state.budget,
      spent_usd: spent,
      remaining_usd: state.budget.total_usd - spent,
      breakdown,
    },
  }
}

export function addArtifact(
  state: ResearchState,
  artifact: Omit<ArtifactEntry, 'id' | 'created_at'>,
): ResearchState {
  return {
    ...state,
    artifacts: {
      ...state.artifacts,
      entries: [
        ...state.artifacts.entries,
        {
          ...artifact,
          id: randomUUID(),
          created_at: new Date().toISOString(),
        },
      ],
    },
  }
}

// ── Query Helpers ────────────────────────────────────────

export function isBudgetLow(state: ResearchState): boolean {
  const pctRemaining =
    (state.budget.remaining_usd / state.budget.total_usd) * 100
  return pctRemaining <= state.budget.warn_at_percent
}

// ── Serialization ────────────────────────────────────────

export function serializeState(state: ResearchState): string {
  return JSON.stringify(state, null, 2)
}

export function deserializeState(json: string): ResearchState {
  return JSON.parse(json) as ResearchState
}

export function saveResearchState(
  projectDir: string,
  state: ResearchState,
): void {
  const metaDir = join(projectDir, '.claude-paper')
  mkdirSync(metaDir, { recursive: true })
  writeFileSync(join(metaDir, 'state.json'), serializeState(state), 'utf-8')
}

export function loadResearchState(projectDir: string): ResearchState | null {
  const statePath = join(projectDir, '.claude-paper', 'state.json')
  if (!existsSync(statePath)) return null
  const content = readFileSync(statePath, 'utf-8')
  const state = deserializeState(content)

  // Migration: add loaded_knowledge_packs if missing from older state files
  if (!state.loaded_knowledge_packs) {
    state.loaded_knowledge_packs = []
  }

  return state
}

/**
 * Build a compact summary of the research state for LLM prompts.
 * Uses ClaimGraph + EvidencePool instead of old beliefs/uncertainties/risks.
 */
export function buildStateContext(state: ResearchState): string {
  const sections: string[] = []

  sections.push(`## Research: ${state.proposal.title}`)
  sections.push(`Paper type: ${state.paper_type}`)
  sections.push(`Cycle: ${state.orchestrator_cycle_count}`)
  sections.push(
    `Budget: $${state.budget.spent_usd.toFixed(2)} / $${state.budget.total_usd} spent`,
  )

  // Time state
  sections.push(`\n### Timeline`)
  sections.push(`Started: ${state.time.started_at}`)
  if (state.time.deadline) {
    sections.push(`Deadline: ${state.time.deadline}`)
  }
  if (state.time.estimated_completion) {
    sections.push(`Estimated completion: ${state.time.estimated_completion}`)
  }

  // Compute capabilities
  if (state.compute) {
    sections.push(`\n### Compute`)
    sections.push(
      `${state.compute.cpu_cores} cores, ${state.compute.ram_gb}GB RAM, ${state.compute.disk_free_gb}GB disk`,
    )
    if (state.compute.gpu) {
      sections.push(`GPU: ${state.compute.gpu}`)
    }
    sections.push(
      `Python: ${state.compute.python_version ?? 'not available'}, uv: ${state.compute.has_uv}, Docker: ${state.compute.has_docker}`,
    )
  }

  // ── Claim Graph section ──────────────────────────────────
  const claims = state.claimGraph.claims
  const admitted = claims.filter(c => c.phase === 'admitted')
  const proposed = claims.filter(c => c.phase === 'proposed')
  const investigating = claims.filter(c => c.phase === 'under_investigation')

  const stability = state.stability
  sections.push(`\n### Claim Graph (${claims.length} claims)`)
  sections.push(
    `Convergence: ${(stability.convergenceScore * 100).toFixed(0)}% | Coverage: ${(stability.evidenceCoverage * 100).toFixed(0)}% | Readiness: ${stability.paperReadiness}`,
  )
  sections.push(
    `Admitted: ${admitted.length} | Proposed: ${proposed.length} | Investigating: ${investigating.length}`,
  )

  if (admitted.length > 0) {
    sections.push(`\n#### Admitted Claims`)
    for (const c of admitted.slice(0, 10)) {
      sections.push(
        `- [${c.type}] (${(c.strength.confidence * 100).toFixed(0)}%) ${c.statement}`,
      )
    }
    if (admitted.length > 10) {
      sections.push(`  ... and ${admitted.length - 10} more`)
    }
  }

  if (investigating.length > 0) {
    sections.push(`\n#### Under Investigation`)
    for (const c of investigating.slice(0, 5)) {
      sections.push(
        `- [${c.type}] (${(c.strength.confidence * 100).toFixed(0)}%) ${c.statement}`,
      )
    }
  }

  if (proposed.length > 0) {
    sections.push(`\n#### Proposed Claims`)
    for (const c of proposed.slice(0, 5)) {
      sections.push(
        `- [${c.type}] (${(c.strength.confidence * 100).toFixed(0)}%) ${c.statement}`,
      )
    }
    if (proposed.length > 5) {
      sections.push(`  ... and ${proposed.length - 5} more`)
    }
  }

  // Weakest bridges
  if (stability.weakestBridge) {
    const weakClaim = claims.find(
      c => c.id === stability.weakestBridge?.claimId,
    )
    if (weakClaim) {
      sections.push(`\n### Weakest Bridges`)
      sections.push(
        `- [vuln=${stability.weakestBridge.vulnerability.toFixed(2)}] ${weakClaim.statement}`,
      )
    }
  }

  // Evidence pool summary
  const ev = state.evidencePool
  const groundedVerified = ev.grounded.filter(e => e.verified).length
  const derivedReproducible = ev.derived.filter(e => e.reproducible).length
  const contradictions =
    ev.grounded.filter(e => e.contradicts_claims.length > 0).length +
    ev.derived.filter(e => e.contradicts_claims.length > 0).length
  sections.push(`\n### Evidence Pool`)
  sections.push(
    `Grounded: ${ev.grounded.length} (${groundedVerified} verified) | Derived: ${ev.derived.length} (${derivedReproducible} reproducible) | Contradictions: ${contradictions}`,
  )

  // Deeply read papers (top 5 with key takeaways)
  if (state.literature_awareness.deeply_read.length > 0) {
    sections.push('\n### Deeply Read Papers')
    for (const dr of state.literature_awareness.deeply_read.slice(0, 5)) {
      sections.push(`- **${dr.paper_id}**: ${dr.relevance_to_us}`)
      if (dr.key_takeaways.length > 0) {
        sections.push(`  Takeaways: ${dr.key_takeaways.slice(0, 3).join('; ')}`)
      }
      if (dr.potential_conflicts.length > 0) {
        sections.push(`  Conflicts: ${dr.potential_conflicts.join('; ')}`)
      }
    }
    if (state.literature_awareness.deeply_read.length > 5) {
      sections.push(
        `  ... and ${state.literature_awareness.deeply_read.length - 5} more`,
      )
    }
  }

  if (state.literature_awareness.known_results.length > 0) {
    sections.push('\n### Known Results from Literature')
    for (const kr of state.literature_awareness.known_results.slice(0, 10)) {
      sections.push(`- ${kr.statement} (${kr.source})`)
    }
  }

  // Confirmed gaps
  if (state.literature_awareness.confirmed_gaps.length > 0) {
    sections.push('\n### Confirmed Gaps in Literature')
    for (const cg of state.literature_awareness.confirmed_gaps) {
      sections.push(`- ${cg.description} (checked: ${cg.last_checked})`)
    }
  }

  if (state.theory.proofs.length > 0) {
    sections.push('\n### Proofs')
    for (const p of state.theory.proofs) {
      sections.push(`- ${p.theorem_statement}: ${p.proof_status}`)
      // Show assumption-reality gaps if any
      if (p.assumption_reality_gaps.length > 0) {
        for (const gap of p.assumption_reality_gaps) {
          sections.push(
            `  [${gap.gap_severity}] Assumed: "${gap.assumption}" vs Reality: "${gap.experimental_reality}"`,
          )
        }
      }
    }
  }

  // Artifacts: list type and path, not just count
  sections.push(`\n### Artifacts (${state.artifacts.entries.length} items)`)
  if (state.artifacts.entries.length > 0) {
    // Group by type for readability
    const byType = new Map<string, string[]>()
    for (const a of state.artifacts.entries) {
      if (!byType.has(a.type)) byType.set(a.type, [])
      byType.get(a.type)!.push(a.path)
    }
    for (const [type, paths] of byType) {
      sections.push(`- ${type}: ${paths.join(', ')}`)
    }
  }

  // Loaded knowledge packs
  const knowledgePacks = state.loaded_knowledge_packs ?? []
  if (knowledgePacks.length > 0) {
    sections.push(`\n### Loaded Knowledge Packs`)
    for (const packId of knowledgePacks) {
      sections.push(`- ${packId}`)
    }
  }

  // Show recent trajectory entries so the LLM sees what was already done/skipped
  const recentTrajectory = state.trajectory.slice(-10)
  if (recentTrajectory.length > 0) {
    sections.push(
      `\n### Recent Actions (last ${recentTrajectory.length} of ${state.trajectory.length})`,
    )
    for (const t of recentTrajectory) {
      const icon =
        t.action_type === 'user_skip'
          ? '[SKIPPED]'
          : t.action_type === 'budget_skip'
            ? '[BUDGET_SKIP]'
            : t.action_type === 'redesign_failure'
              ? '[FAILED]'
              : '[done]'
      sections.push(`- ${icon} ${t.description}`)
      if (t.outcome && t.action_type === 'user_skip') {
        sections.push(`  → ${t.outcome}`)
      }
    }
  } else {
    sections.push(`\n### Trajectory: no actions taken yet`)
  }

  return sections.join('\n')
}

/** Word-level Jaccard similarity between two strings. */
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/).filter(Boolean))
  const wordsB = new Set(b.split(/\s+/).filter(Boolean))
  if (wordsA.size === 0 && wordsB.size === 0) return 1
  let intersection = 0
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++
  }
  return intersection / (wordsA.size + wordsB.size - intersection)
}
