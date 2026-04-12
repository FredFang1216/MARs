import { ClaimGraph } from './index'
import { buildL0, buildL1, buildL2 } from './context-views'
import { FocusSelector } from './focus-selector'
import { allocateTokenBudget } from './token-budget'
import {
  BUILDER_SYSTEM_PROMPT,
  SKEPTIC_SYSTEM_PROMPT,
  SKEPTIC_EXPLORATORY_PROMPT,
  ARBITER_SYSTEM_PROMPT,
  ARBITER_EXPLORATORY_PROMPT,
} from './prompt-constants'
import type { BuilderOutput, SkepticOutput } from './triple-role-types'
import { estimateTokens, truncate, truncateToTokens } from './token-utils'
import type { EvidencePoolManager } from '../evidence-pool'
import type { ResearchState } from '../research-state'
import { TrajectoryCompressor } from '../trajectory-compressor'
import { EvidencePoolCompressor } from '../evidence-pool-compressor'
import type { DKPLoader } from '../domain-knowledge/loader'
import type { ResearchStance } from '../types'
import { summarizeExperimentPlan } from '../experiments/plan-generator'
import {
  buildExperimentFeedbackContext,
  type RetreatSignal,
} from '../experiments/experiment-evaluator'

export class PromptAssembler {
  private graph: ClaimGraph
  private pool: EvidencePoolManager
  private state: ResearchState
  private rigorLevel: number
  private focusSelector: FocusSelector
  private trajectoryCompressor: TrajectoryCompressor
  private evidenceCompressor: EvidencePoolCompressor
  private dkpLoader: DKPLoader | null
  private researchStance: ResearchStance

  constructor(
    graph: ClaimGraph,
    pool: EvidencePoolManager,
    state: ResearchState,
    rigorLevel: number = 2,
    dkpLoader?: DKPLoader,
    researchStance?: ResearchStance,
  ) {
    this.graph = graph
    this.pool = pool
    this.state = state
    this.rigorLevel = rigorLevel
    this.dkpLoader = dkpLoader ?? null
    this.researchStance = researchStance ?? 'standard'
    this.focusSelector = new FocusSelector()
    this.trajectoryCompressor = new TrajectoryCompressor()
    this.evidenceCompressor = new EvidencePoolCompressor()
  }

  /** Update references for a new cycle. */
  update(
    graph: ClaimGraph,
    pool: EvidencePoolManager,
    state: ResearchState,
    rigorLevel?: number,
    dkpLoader?: DKPLoader,
    researchStance?: ResearchStance,
  ): void {
    this.graph = graph
    this.pool = pool
    this.state = state
    if (rigorLevel != null) this.rigorLevel = rigorLevel
    if (dkpLoader !== undefined) this.dkpLoader = dkpLoader
    if (researchStance !== undefined) this.researchStance = researchStance
  }

  /** Assemble Builder prompt (~9K-11K tokens input). */
  assembleBuilder(): string {
    const budget = allocateTokenBudget(this.graph.claimCount, false)
    const focusIds = this.focusSelector.selectForBuilder(this.graph)

    // Inject grounding pressure when evidence coverage is critically low
    const groundingPressure = this.buildGroundingPressure()

    return this.enforceTokenLimit(
      [
        BUILDER_SYSTEM_PROMPT,
        this.buildMainClaimContext(),
        groundingPressure,
        buildL0(this.graph, this.pool, this.state.stability),
        buildL1(this.graph),
        buildL2(this.graph, focusIds, this.pool, budget.l2FocusSubgraph),
        this.evidenceCompressor.compress(this.pool, focusIds, budget.evidence),
        this.trajectoryCompressor.compress(
          this.state.trajectory,
          budget.trajectory,
        ),
        this.buildLiteratureContext(budget.literature),
        this.buildDomainKnowledgeContext(800),
        this.buildExperimentPlanContext(),
        this.buildBudgetContext(),
      ]
        .filter(Boolean)
        .join('\n\n'),
    )
  }

  /** Assemble Skeptic prompt — includes Builder output summary. */
  assembleSkeptic(builderOutput: BuilderOutput): string {
    const budget = allocateTokenBudget(this.graph.claimCount, false)
    const focusIds = this.focusSelector.selectForSkeptic(
      this.graph,
      builderOutput,
    )

    const skepticPrompt =
      this.researchStance === 'exploratory'
        ? SKEPTIC_EXPLORATORY_PROMPT
        : SKEPTIC_SYSTEM_PROMPT

    return this.enforceTokenLimit(
      [
        skepticPrompt,
        this.buildMainClaimContext(),
        "## Builder's Proposal\n" + this.summarizeBuilder(builderOutput, 1500),
        buildL0(this.graph, this.pool, this.state.stability),
        buildL1(this.graph),
        buildL2(this.graph, focusIds, this.pool, budget.l2FocusSubgraph),
        this.evidenceCompressor.compress(this.pool, focusIds, budget.evidence),
        this.trajectoryCompressor.compress(this.state.trajectory, 400),
      ]
        .filter(Boolean)
        .join('\n\n'),
    )
  }

  /** Assemble Arbiter prompt — includes Builder + Skeptic summaries. */
  assembleArbiter(
    builderOutput: BuilderOutput,
    skepticOutput: SkepticOutput,
    retreatSignals?: RetreatSignal[],
  ): string {
    const budget = allocateTokenBudget(this.graph.claimCount, false)
    const focusIds = this.focusSelector.selectForArbiter(
      this.graph,
      builderOutput,
      skepticOutput,
    )

    const arbiterPrompt =
      this.researchStance === 'exploratory'
        ? ARBITER_EXPLORATORY_PROMPT
        : ARBITER_SYSTEM_PROMPT

    return this.enforceTokenLimit(
      [
        arbiterPrompt,
        this.buildMainClaimContext(),
        '## Builder Summary\n' + this.summarizeBuilder(builderOutput, 800),
        '## Skeptic Challenges\n' + this.summarizeSkeptic(skepticOutput, 1500),
        buildL0(this.graph, this.pool, this.state.stability),
        buildL2(this.graph, focusIds, this.pool, budget.l2FocusSubgraph),
        this.buildExperimentFeedbackSection(retreatSignals),
        this.buildExperimentPlanContext(),
        this.buildBudgetContext(),
        this.buildConvergenceContext(),
      ]
        .filter(Boolean)
        .join('\n\n'),
    )
  }

  /** Max total tokens per LLM call input (spec Part 3). */
  private static readonly MAX_PROMPT_TOKENS = 12_000

  /**
   * Enforce total prompt token limit. If the assembled prompt exceeds
   * MAX_PROMPT_TOKENS, truncate to fit.
   */
  private enforceTokenLimit(prompt: string): string {
    const tokens = estimateTokens(prompt)
    if (tokens <= PromptAssembler.MAX_PROMPT_TOKENS) return prompt
    const maxChars = PromptAssembler.MAX_PROMPT_TOKENS * 4
    return prompt.slice(0, maxChars)
  }

  // -- Private helpers --

  private summarizeBuilder(output: BuilderOutput, maxTokens: number): string {
    let text = `Narrative: ${output.narrative}\n\nNew claims proposed:\n`
    for (const c of output.new_claims_proposed ?? []) {
      text += `- [${c.type}/${c.epistemicLayer}] ${truncate(c.statement, 60)}\n`
    }
    if ((output.recommended_next_actions?.length ?? 0) > 0) {
      text += `\nTop recommended action: ${output.recommended_next_actions[0].action}`
    }
    if ((output.reformulation_suggestions?.length ?? 0) > 0) {
      text += '\nReformulation suggestions:'
      for (const r of output.reformulation_suggestions!) {
        text += `\n- [${r.claim_id}] ${truncate(r.reason, 40)} -> "${truncate(r.suggested_statement, 60)}"`
      }
    }
    return truncateToTokens(text, maxTokens)
  }

  private summarizeSkeptic(output: SkepticOutput, maxTokens: number): string {
    const sections: string[] = []
    if (output.bridge_gaps?.length) {
      sections.push('Bridge gaps:')
      for (const g of output.bridge_gaps) {
        sections.push(
          `  [${g.severity}] ${g.from_claim} -> ${g.to_claim}: ${truncate(g.description, 50)}`,
        )
      }
    }
    if (output.evidence_inflation?.length) {
      sections.push('Evidence inflation:')
      for (const e of output.evidence_inflation) {
        sections.push(
          `  [${e.claim_id}] claimed "${e.claimed_strength}" actual "${e.actual_strength}"`,
        )
      }
    }
    if (output.top3_collapse_points?.length) {
      sections.push('Collapse points:')
      for (const c of output.top3_collapse_points) {
        sections.push(
          `  [${c.claim_id}] vuln:${c.vulnerability.toFixed(2)} cascade:${c.cascade_size} falsify:"${truncate(c.falsification_experiment, 40)}"`,
        )
      }
    }
    if (output.theorem_overreach?.length) {
      sections.push('Theorem overreach:')
      for (const t of output.theorem_overreach) {
        sections.push(`  [${t.claim_id}] ${truncate(t.issue, 50)}`)
      }
    }
    if (output.admission_denials?.length) {
      sections.push('Admission denials:')
      for (const a of output.admission_denials) {
        sections.push(
          `  [${a.claim_id}] -> ${a.suggested_destination}: ${truncate(a.reason, 40)}`,
        )
      }
    }
    if (output.reformulation_opportunities?.length) {
      sections.push('Reformulation opportunities:')
      for (const r of output.reformulation_opportunities) {
        sections.push(
          `  [${r.claim_id}] evidence suggests: "${truncate(r.suggested_direction, 50)}" (conf: ${r.confidence_in_alternative.toFixed(2)})`,
        )
      }
    }
    return truncateToTokens(sections.join('\n'), maxTokens)
  }

  /** Build main claim status context block. Shows active main claims with reformulation history. */
  private buildMainClaimContext(): string {
    const activeMains = this.graph.getActiveMainClaims()
    if (activeMains.length === 0) return ''
    const admittedCount = activeMains.filter(c => c.phase === 'admitted').length
    const lines = activeMains.map(c => {
      const status = c.phase === 'admitted' ? 'ADMITTED' : c.phase.toUpperCase()
      const reformTag =
        c.reformulated_from && c.reformulation_count
          ? ` [REFORMED v${c.reformulation_count}]`
          : ''
      return `- [${status}]${reformTag} [${c.id}] ${truncate(c.statement, 80)} (conf: ${c.strength.confidence.toFixed(2)})`
    })
    const allAdmitted =
      activeMains.length > 0 && admittedCount === activeMains.length

    // Compact reformulation history
    const reformulated = this.graph
      .getMainClaims()
      .filter(c => c.phase === 'reformulated')
    const historyLines =
      reformulated.length > 0
        ? [
            '\nReformulation history:',
            ...reformulated.map(
              c =>
                `- [SUPERSEDED] "${truncate(c.statement, 60)}" -> [${c.reformulated_into ?? '?'}]`,
            ),
          ]
        : []

    return `## Main Claims (${admittedCount}/${activeMains.length} active admitted) | Depth limit: ${this.rigorLevel}
${lines.join('\n')}${historyLines.length > 0 ? '\n' + historyLines.join('\n') : ''}
${allAdmitted ? '>>> ALL ACTIVE MAIN CLAIMS ADMITTED — consider paper assembly <<<' : ''}`
  }

  /**
   * When evidence coverage is critically low, inject grounding pressure
   * to prevent the Builder from proposing new claims and instead
   * focus on grounding existing ones.
   */
  private buildGroundingPressure(): string {
    const coverage = this.state.stability.evidenceCoverage
    if (coverage >= 0.3) return ''

    // Find ungrounded claims (no grounded and no derived evidence)
    const ungrounded = this.graph.allClaims.filter(
      c =>
        c.phase !== 'rejected' &&
        c.phase !== 'retracted' &&
        c.evidence.grounded.length === 0 &&
        c.evidence.derived.length === 0,
    )
    const top3 = ungrounded.slice(0, 3)
    const claimLines = top3
      .map(c => {
        const action =
          c.epistemicLayer === 'observation' ||
          c.epistemicLayer === 'explanation'
            ? 'Reasoning first; literature only for known results'
            : c.epistemicLayer === 'exploitation'
              ? 'Small experiment (preferred) or reasoning'
              : 'Reasoning/proof'
        return `  - [${c.id}] "${truncateToTokens(c.statement, 30)}"\n    Needs: ${action}`
      })
      .join('\n')

    return `## CRITICAL: GROUNDING REQUIRED
Evidence coverage is only ${(coverage * 100).toFixed(0)}%. You MUST NOT propose new claims.
Instead, recommend actions to GROUND existing ungrounded claims (${ungrounded.length} total):
- Reasoning/proof for claims in the justification layer
- Small experiments or reasoning for exploitation layer claims
- Reasoning first, literature only for known results (observation/explanation layers)

Top ungrounded claims:
${claimLines}`
  }

  private buildLiteratureContext(budgetTokens: number): string {
    const lit = this.state.literature_awareness
    if (!lit) return ''
    const parts: string[] = ['## Literature']

    // Deeply read papers (top 5)
    if (lit.deeply_read.length > 0) {
      parts.push('Deeply read:')
      for (const dr of lit.deeply_read.slice(0, 5)) {
        parts.push(`  ${dr.paper_id}: ${truncate(dr.relevance_to_us, 60)}`)
      }
    }

    // Known results (top 10)
    if (lit.known_results.length > 0) {
      parts.push('Known results:')
      for (const kr of lit.known_results.slice(0, 10)) {
        parts.push(`  ${truncate(kr.statement, 50)} (${kr.source})`)
      }
    }

    // Confirmed gaps
    if (lit.confirmed_gaps.length > 0) {
      parts.push('Confirmed gaps:')
      for (const cg of lit.confirmed_gaps) {
        parts.push(`  ${truncate(cg.description, 60)}`)
      }
    }

    return truncateToTokens(parts.join('\n'), budgetTokens)
  }

  /**
   * Build domain knowledge context from loaded DKP packs.
   * Injects compressed overview + registry summary into Builder prompt.
   */
  private buildDomainKnowledgeContext(budgetTokens: number): string {
    if (!this.dkpLoader) return ''
    const packs = this.dkpLoader.getLoadedPacks()
    if (packs.length === 0) return ''

    const sections: string[] = ['## Domain Knowledge']
    let tokensUsed = 0
    const perPackBudget = Math.floor((budgetTokens * 0.6) / packs.length)

    for (const pack of packs) {
      const compressed = truncateToTokens(pack.overview, perPackBudget)
      sections.push(`### ${pack.manifest.name}\n${compressed}`)
      tokensUsed += estimateTokens(compressed) + 10
      if (tokensUsed > budgetTokens * 0.6) break
    }

    // Registry summary
    const regLines: string[] = []
    for (const pack of packs) {
      const ds = pack.registries.datasets
      const bm = pack.registries.benchmarks
      const cb = pack.registries.codebases
      if (ds.length > 0)
        regLines.push(`Datasets: ${ds.map(d => d.name).join(', ')}`)
      if (bm.length > 0)
        regLines.push(`Benchmarks: ${bm.map(b => b.name).join(', ')}`)
      if (cb.length > 0)
        regLines.push(`Codebases: ${cb.map(c => c.name).join(', ')}`)
    }
    if (regLines.length > 0) {
      sections.push('### Registries\n' + regLines.join('\n'))
    }

    const totalEntries = packs.reduce(
      (s, p) => s + p.manifest.stats.entries_total,
      0,
    )
    sections.push(
      `\n_${totalEntries} knowledge entries available across ${packs.length} pack(s)._`,
    )

    return truncateToTokens(sections.join('\n'), budgetTokens)
  }

  /**
   * Build experiment feedback context for the Arbiter, including recent evaluations,
   * stagnant claims, and any pending retreat signals.
   */
  private buildExperimentFeedbackSection(retreatSignals?: RetreatSignal[]): string {
    const feedback = this.state.experiment_feedback
    const hasEvaluations = feedback && feedback.evaluations.length > 0
    const hasRetreatSignals = retreatSignals && retreatSignals.length > 0
    if (!hasEvaluations && !hasRetreatSignals) return ''

    const parts: string[] = []

    // Core feedback from evaluations
    if (feedback && feedback.evaluations.length > 0) {
      const ctx = buildExperimentFeedbackContext(
        feedback.evaluations,
        feedback.claim_histories,
      )
      if (ctx) parts.push(ctx)
    }

    // Append pending retreat signals as urgent directives
    if (retreatSignals && retreatSignals.length > 0) {
      parts.push('\n### Active Retreat Signals')
      for (const sig of retreatSignals) {
        const action = sig.suggested_action === 'reformulate_or_demote'
          ? 'You SHOULD reformulate or demote this claim. Do NOT schedule another experiment without first modifying it.'
          : 'Consider revising the experimental approach or contracting the claim to a weaker layer.'
        parts.push(
          `- **${sig.signal.toUpperCase()}** [${sig.claim_id.slice(0, 12)}]: ${sig.consecutive_failures} consecutive failures. ${action}\n  Reason: ${sig.reason}`,
        )
      }
    }

    return parts.join('\n')
  }

  private buildExperimentPlanContext(): string {
    const plan = this.state.experiment_plan
    if (!plan) return ''
    return truncateToTokens(summarizeExperimentPlan(plan), 600)
  }

  private buildBudgetContext(): string {
    const b = this.state.budget
    const pct =
      b.total_usd > 0
        ? ((b.remaining_usd / b.total_usd) * 100).toFixed(0)
        : '100'
    return `## Budget\nRemaining: $${b.remaining_usd.toFixed(2)} / $${b.total_usd} (${pct}%)`
  }

  private buildConvergenceContext(): string {
    const s = this.state.stability
    const indicator =
      s.paperReadiness === 'ready'
        ? 'CONVERGED - consider assembling paper'
        : s.paperReadiness === 'nearly_ready'
          ? 'Nearly ready - address weakest bridge'
          : 'Active exploration - more evidence needed'
    return `## Convergence\nScore: ${s.convergenceScore.toFixed(2)} | Readiness: ${s.paperReadiness}\nAdmitted: ${s.admittedClaimCount} | Proposed: ${s.proposedClaimCount}\n${indicator}`
  }
}
