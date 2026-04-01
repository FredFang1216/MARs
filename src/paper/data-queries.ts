/**
 * Pure data extraction functions shared by CLI commands and Web API.
 * No terminal I/O — returns plain JSON-serializable objects.
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  loadResearchState,
  isBudgetLow,
  getUnresolvedClaims,
  getAdmittedClaims,
  type ResearchState,
} from './research-state'
import { ClaimGraph } from './claim-graph/index'
import type {
  ClaimGraphStatistics,
  WeakestBridgeResult,
  LayerSkipResult,
} from './claim-graph/types'
import { ExperimentLogManager } from './experiments/experiment-log'
import type { ExperimentLogEntry, DashboardData } from './experiments/types'

// ── Research Summary ────────────────────────────────────

export interface ResearchSummary {
  title: string
  paper_type: string
  cycle_count: number
  budget: {
    total_usd: number
    spent_usd: number
    remaining_usd: number
    is_low: boolean
  }
  claims: {
    total: number
    admitted: number
    proposed: number
    investigating: number
    unresolved: number
  }
  stability: {
    convergenceScore: number
    paperReadiness: string
    evidenceCoverage: number
    weakestBridge: { claimId: string; vulnerability: number } | null
  }
  evidence: {
    grounded_count: number
    derived_count: number
  }
  literature: {
    deeply_read: number
    known_results: number
    confirmed_gaps: number
  }
  proofs: {
    total: number
    completed: number
  }
  artifacts_count: number
  trajectory_count: number
}

export function getResearchSummary(
  projectDir: string,
): ResearchSummary | null {
  const state = loadResearchState(projectDir)
  if (!state) return null

  const claims = state.claimGraph.claims
  const admitted = getAdmittedClaims(state)
  const proposed = claims.filter(c => c.phase === 'proposed')
  const investigating = claims.filter(c => c.phase === 'under_investigation')
  const unresolved = getUnresolvedClaims(state)

  const completedProofs = state.theory.proofs.filter(
    p => p.proof_status === 'rigorous' || p.proof_status === 'verified',
  ).length

  return {
    title: state.proposal.title,
    paper_type: state.paper_type,
    cycle_count: state.orchestrator_cycle_count,
    budget: {
      total_usd: state.budget.total_usd,
      spent_usd: state.budget.spent_usd,
      remaining_usd: state.budget.remaining_usd,
      is_low: isBudgetLow(state),
    },
    claims: {
      total: claims.length,
      admitted: admitted.length,
      proposed: proposed.length,
      investigating: investigating.length,
      unresolved: unresolved.length,
    },
    stability: {
      convergenceScore: state.stability.convergenceScore,
      paperReadiness: state.stability.paperReadiness,
      evidenceCoverage: state.stability.evidenceCoverage,
      weakestBridge: state.stability.weakestBridge,
    },
    evidence: {
      grounded_count: state.evidencePool.grounded.length,
      derived_count: state.evidencePool.derived.length,
    },
    literature: {
      deeply_read: state.literature_awareness.deeply_read.length,
      known_results: state.literature_awareness.known_results.length,
      confirmed_gaps: state.literature_awareness.confirmed_gaps.length,
    },
    proofs: {
      total: state.theory.proofs.length,
      completed: completedProofs,
    },
    artifacts_count: state.artifacts.entries.length,
    trajectory_count: state.trajectory.length,
  }
}

// ── Claim Graph Summary ─────────────────────────────────

export interface ClaimGraphSummary {
  statistics: ClaimGraphStatistics
  weakestBridges: WeakestBridgeResult[]
  layerSkips: LayerSkipResult[]
}

export function getClaimGraphSummary(
  projectDir: string,
): ClaimGraphSummary | null {
  const state = loadResearchState(projectDir)
  if (!state) return null

  const cg = new ClaimGraph(state.claimGraph)
  return {
    statistics: cg.getStatistics(),
    weakestBridges: cg.findWeakestBridges(),
    layerSkips: cg.detectLayerSkips(),
  }
}

// ── Experiment Dashboard ────────────────────────────────

export function getExperimentDashboard(
  projectDir: string,
): { experiments: ExperimentLogEntry[]; dashboard: DashboardData | null } {
  const logMgr = new ExperimentLogManager(projectDir)
  const log = logMgr.load()
  const state = loadResearchState(projectDir)

  if (!state) {
    return { experiments: log.experiments, dashboard: null }
  }

  const succeeded = log.experiments.filter(e => e.status === 'completed').length
  const failed = log.experiments.filter(e => e.status === 'failed').length

  const dashboard: DashboardData = {
    total_cycles: state.orchestrator_cycle_count,
    total_experiments: log.experiments.length,
    experiments_succeeded: succeeded,
    experiments_failed: failed,
    claims_total: state.claimGraph.claims.length,
    claims_admitted: getAdmittedClaims(state).length,
    convergence_score: state.stability.convergenceScore,
    paper_readiness: state.stability.paperReadiness,
    budget_spent_usd: state.budget.spent_usd,
    budget_remaining_usd: state.budget.remaining_usd,
    turning_points: 0, // computed from journal if available
    last_updated: new Date().toISOString(),
  }

  return { experiments: log.experiments, dashboard }
}
