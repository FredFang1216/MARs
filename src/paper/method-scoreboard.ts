/**
 * Method Scoreboard — tracks competing research lines and identifies
 * incumbent, frontier, and fusion candidates.
 *
 * Inspired by DeepScientist's get_method_scoreboard() and
 * get_optimization_frontier(). Aggregates from trajectory, experiments,
 * and claim graph to give the orchestrator a portfolio view.
 *
 * Stored in: {projectDir}/.claude-paper/scoreboard.json
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import type { ResearchState, TrajectoryEntry } from './research-state'

// ── Types ────────────────────────────────────────────────

export type MethodStatus =
  | 'candidate'          // proposed, not yet tested
  | 'in_progress'        // actively being investigated
  | 'main_verified'      // has experiment results
  | 'incumbent'          // current best
  | 'abandoned'          // dropped
  | 'superseded'         // replaced by a better variant

export interface MethodEntry {
  id: string
  name: string
  description: string
  status: MethodStatus

  /** Claim IDs this method supports. */
  supporting_claims: string[]

  /** Key metrics from experiments. */
  metrics: Record<string, number>

  /** Number of experiment runs. */
  run_count: number

  /** Best experiment result summary. */
  best_result?: string

  /** When this method was first proposed. */
  created_at: string
  updated_at: string

  /** Orchestrator cycle when last updated. */
  last_cycle: number
}

export interface Scoreboard {
  /** The current best method. */
  incumbent: MethodEntry | null

  /** Top 2-3 alternatives being explored. */
  frontier: MethodEntry[]

  /** Methods that could be merged with the incumbent for improvement. */
  fusion_candidates: Array<{
    method_a: string
    method_b: string
    rationale: string
  }>

  /** All methods ever tracked. */
  all_methods: MethodEntry[]

  /** Recommended next action for the portfolio. */
  recommended_action: 'explore' | 'exploit' | 'fusion' | 'stop'

  last_updated: string
}

// ── Persistence ──────────────────────────────────────────

function scoreboardPath(projectDir: string): string {
  return join(projectDir, '.claude-paper', 'scoreboard.json')
}

export function loadScoreboard(projectDir: string): Scoreboard | null {
  const path = scoreboardPath(projectDir)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

export function saveScoreboard(projectDir: string, scoreboard: Scoreboard): void {
  const dir = join(projectDir, '.claude-paper')
  mkdirSync(dir, { recursive: true })
  scoreboard.last_updated = new Date().toISOString()
  writeFileSync(scoreboardPath(projectDir), JSON.stringify(scoreboard, null, 2), 'utf-8')
}

// ── Scoreboard Refresh ───────────────────────────────────

/**
 * Refresh the scoreboard from current research state.
 * Extracts methods from claims, trajectory, and experiments.
 */
export function refreshScoreboard(projectDir: string, state: ResearchState): Scoreboard {
  const existing = loadScoreboard(projectDir)
  const methods = existing?.all_methods ? [...existing.all_methods] : []
  const now = new Date().toISOString()
  const cycle = state.orchestrator_cycle_count

  // Extract methods from main claims (proposal innovations)
  const claims = state.claimGraph.claims.filter(c => c.is_main || c.type === 'novelty' || c.type === 'algorithmic')
  for (const claim of claims) {
    const existingMethod = methods.find(m => m.supporting_claims.includes(claim.id))
    if (!existingMethod) {
      methods.push({
        id: `method-${claim.id.slice(0, 8)}`,
        name: claim.statement.slice(0, 80),
        description: claim.statement,
        status: claim.phase === 'admitted' ? 'main_verified' : 'candidate',
        supporting_claims: [claim.id],
        metrics: {},
        run_count: 0,
        created_at: claim.created_at,
        updated_at: now,
        last_cycle: cycle,
      })
    } else {
      // Update status from claim phase
      existingMethod.status =
        claim.phase === 'admitted' ? 'main_verified'
        : claim.phase === 'rejected' || claim.phase === 'retracted' ? 'abandoned'
        : existingMethod.status
      existingMethod.updated_at = now
      existingMethod.last_cycle = cycle
    }
  }

  // Count experiment runs per method from trajectory
  for (const entry of state.trajectory) {
    if (entry.action_type.includes('experiment') && entry.outcome) {
      for (const method of methods) {
        if (method.supporting_claims.some(cid => entry.description.includes(cid))) {
          method.run_count++
          if (!method.best_result) {
            method.best_result = entry.outcome.slice(0, 200)
          }
        }
      }
    }
  }

  // Determine incumbent: highest-scoring main_verified method
  const verified = methods.filter(m => m.status === 'main_verified')
  const incumbent = verified.length > 0
    ? verified.reduce((best, m) => m.run_count > best.run_count ? m : best, verified[0])
    : null

  if (incumbent) {
    // Reset old incumbent
    for (const m of methods) {
      if (m.status === 'incumbent') m.status = 'main_verified'
    }
    incumbent.status = 'incumbent'
  }

  // Frontier: top 3 non-incumbent active methods
  const frontier = methods
    .filter(m => m.status !== 'incumbent' && m.status !== 'abandoned' && m.status !== 'superseded')
    .sort((a, b) => b.run_count - a.run_count)
    .slice(0, 3)

  // Fusion candidates: pairs of methods with complementary claims
  const fusionCandidates: Scoreboard['fusion_candidates'] = []
  if (incumbent && frontier.length > 0) {
    for (const alt of frontier) {
      const incumbentClaims = new Set(incumbent.supporting_claims)
      const hasOverlap = alt.supporting_claims.some(c => incumbentClaims.has(c))
      if (!hasOverlap && alt.status === 'main_verified') {
        fusionCandidates.push({
          method_a: incumbent.id,
          method_b: alt.id,
          rationale: `${incumbent.name.slice(0, 40)} + ${alt.name.slice(0, 40)} address different claims`,
        })
      }
    }
  }

  // Recommended action
  const recommended: Scoreboard['recommended_action'] =
    fusionCandidates.length > 0 ? 'fusion'
    : frontier.length === 0 ? 'stop'
    : incumbent && incumbent.run_count > 3 ? 'exploit'
    : 'explore'

  const scoreboard: Scoreboard = {
    incumbent,
    frontier,
    fusion_candidates: fusionCandidates,
    all_methods: methods,
    recommended_action: recommended,
    last_updated: now,
  }

  saveScoreboard(projectDir, scoreboard)
  return scoreboard
}

/**
 * Build a scoreboard summary for LLM context injection.
 */
export function buildScoreboardContext(projectDir: string): string {
  const sb = loadScoreboard(projectDir)
  if (!sb) return ''

  const lines: string[] = ['## Method Scoreboard']

  if (sb.incumbent) {
    lines.push(`\n**Incumbent:** ${sb.incumbent.name} [${sb.incumbent.run_count} runs]`)
  }

  if (sb.frontier.length > 0) {
    lines.push('\n**Frontier:**')
    for (const m of sb.frontier) {
      lines.push(`- ${m.name} [${m.status}, ${m.run_count} runs]`)
    }
  }

  if (sb.fusion_candidates.length > 0) {
    lines.push('\n**Fusion Opportunities:**')
    for (const f of sb.fusion_candidates) {
      lines.push(`- ${f.rationale}`)
    }
  }

  lines.push(`\n**Recommended:** ${sb.recommended_action}`)

  return lines.join('\n')
}
