/**
 * Experiment Evaluator — structured assessment of experiment results.
 *
 * Inspired by DeepScientist's delivery policy and retreat mechanism.
 * After each experiment, produces an ExperimentEvaluation that tells
 * the orchestrator whether the experiment beat baseline, what the
 * failure mode is, and what route to take next (continue / revise / stop).
 *
 * Key principle: the evaluator only produces SIGNALS and RECOMMENDATIONS.
 * It never directly modifies claims — that's the Arbiter's job.
 */

import type { MetricsJson, ExperimentLogEntry } from './types'
import type { EvidenceConversionResult } from './evidence-converter'
import { ExperimentEvidenceConverter } from './evidence-converter'

// ── Types ────────────────────────────────────────────────

export type BaselineRelation = 'better' | 'worse' | 'mixed' | 'not_comparable'
export type BreakthroughLevel = 'major' | 'minor' | 'none'
export type FailureMode = 'none' | 'implementation' | 'evaluation' | 'direction'
export type ClaimUpdateSignal = 'strengthens' | 'weakens' | 'narrows' | 'neutral'
export type RecommendedRoute = 'continue' | 'revise_claim' | 'branch_alternative' | 'write' | 'stop'

export interface ExperimentEvaluation {
  experiment_id: string
  target_claim_id: string | null

  /** Did the experiment beat the baseline? */
  beats_baseline: boolean | null
  /** How significant is the improvement? */
  breakthrough_level: BreakthroughLevel
  /** Why did the experiment fail (if it did)? */
  failure_mode: FailureMode
  /** What does this mean for the target claim? */
  claim_update_signal: ClaimUpdateSignal
  /** What should the orchestrator do next? */
  recommended_route: RecommendedRoute
  /** Human-readable explanation of the evaluation. */
  reason: string

  /** Key metrics extracted from the experiment. */
  metrics_summary: Record<string, number>
  /** Whether the experiment's success criteria were met. */
  success_criteria_met: boolean | null
  /** Confidence delta applied to the target claim. */
  confidence_delta: number
}

export interface ClaimExperimentHistory {
  claim_id: string
  total_experiments: number
  /** Number of consecutive experiments where beats_baseline=false. */
  consecutive_failures: number
  last_evaluation: ExperimentEvaluation | null
  /** True if consecutive_failures >= STAGNATION_THRESHOLD. */
  stagnant: boolean
}

/** Retreat signal injected into the next Arbiter prompt. */
export interface RetreatSignal {
  claim_id: string
  signal: 'experiment_weakened' | 'stagnant_retreat'
  consecutive_failures: number
  reason: string
  suggested_action: 'revise_approach' | 'reformulate_or_demote'
}

// ── Constants ────────────────────────────────────────────

/** After this many consecutive baseline-failing experiments, mark as stagnant. */
const STAGNATION_THRESHOLD = 2

/** Confidence delta threshold for "major" breakthrough. */
const MAJOR_BREAKTHROUGH_DELTA = 0.10

// ── Core Evaluation ──────────────────────────────────────

// Shared converter instance for baseline comparison
const converter = new ExperimentEvidenceConverter()

/**
 * Evaluate an experiment result and produce a structured assessment.
 */
export function evaluateExperiment(params: {
  experimentId: string
  targetClaimId: string | null
  metrics: MetricsJson | null
  conversion: EvidenceConversionResult
  experimentFailed: boolean
}): ExperimentEvaluation {
  const { experimentId, targetClaimId, metrics, conversion, experimentFailed } = params

  // 1. Determine beats_baseline
  let beatsBaseline: boolean | null = null
  if (experimentFailed || !metrics) {
    beatsBaseline = null
  } else {
    const modelNames = Object.keys(metrics.models)
    if (modelNames.length > 0) {
      // Reuse the converter's baseline evaluation logic
      beatsBaseline = converter.evaluateVsBaseline(metrics, 'model > baseline')
      // If no baseline models found, the evaluator returns false — treat as not_comparable
      const hasBaseline = modelNames.some(
        n => n.toLowerCase().includes('baseline') || n.toLowerCase().includes('random') || n.toLowerCase().includes('dummy'),
      )
      if (!hasBaseline) beatsBaseline = null
    }
  }

  // 2. Determine breakthrough level
  let breakthroughLevel: BreakthroughLevel = 'none'
  if (beatsBaseline === true) {
    breakthroughLevel = conversion.confidenceDelta > MAJOR_BREAKTHROUGH_DELTA ? 'major' : 'minor'
  }

  // 3. Determine failure mode
  let failureMode: FailureMode = 'none'
  if (experimentFailed) {
    failureMode = 'implementation'
  } else if (metrics && beatsBaseline === null) {
    failureMode = 'evaluation' // metrics exist but can't compare
  } else if (beatsBaseline === false) {
    failureMode = 'direction'
  }

  // 4. Determine claim update signal
  let claimUpdateSignal: ClaimUpdateSignal = 'neutral'
  if (conversion.successCriteriaMet === true && beatsBaseline === true) {
    claimUpdateSignal = 'strengthens'
  } else if (beatsBaseline === false) {
    claimUpdateSignal = 'weakens'
  } else if (conversion.successCriteriaMet === true && beatsBaseline === null) {
    claimUpdateSignal = 'narrows'
  }

  // 5. Determine recommended route
  let recommendedRoute: RecommendedRoute = 'continue'
  if (beatsBaseline === true && breakthroughLevel === 'major') {
    recommendedRoute = 'write'
  } else if (beatsBaseline === true) {
    recommendedRoute = 'continue'
  } else if (beatsBaseline === false) {
    recommendedRoute = 'revise_claim'
  }
  // If experiment failed entirely, still recommend continue (fix implementation first)
  if (experimentFailed) {
    recommendedRoute = 'continue'
  }

  // 6. Build reason string
  const reason = buildReasonString(beatsBaseline, breakthroughLevel, failureMode, conversion)

  // 7. Extract metrics summary
  const metricsSummary: Record<string, number> = {}
  if (metrics) {
    for (const [modelName, data] of Object.entries(metrics.models)) {
      const oos = data.out_of_sample
      if (!oos) continue
      for (const [k, v] of Object.entries(oos)) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          metricsSummary[`${modelName}.${k}`] = v
        }
      }
    }
  }

  return {
    experiment_id: experimentId,
    target_claim_id: targetClaimId,
    beats_baseline: beatsBaseline,
    breakthrough_level: breakthroughLevel,
    failure_mode: failureMode,
    claim_update_signal: claimUpdateSignal,
    recommended_route: recommendedRoute,
    reason,
    metrics_summary: metricsSummary,
    success_criteria_met: conversion.successCriteriaMet,
    confidence_delta: conversion.confidenceDelta,
  }
}

// ── Claim History ────────────────────────────────────────

/**
 * Build per-claim experiment history from stored evaluations.
 */
export function buildClaimExperimentHistory(
  claimId: string,
  evaluations: ExperimentEvaluation[],
): ClaimExperimentHistory {
  const claimEvals = evaluations.filter(e => e.target_claim_id === claimId)

  // Count consecutive failures from the end
  let consecutiveFailures = 0
  for (let i = claimEvals.length - 1; i >= 0; i--) {
    if (claimEvals[i].beats_baseline === false) {
      consecutiveFailures++
    } else {
      break
    }
  }

  return {
    claim_id: claimId,
    total_experiments: claimEvals.length,
    consecutive_failures: consecutiveFailures,
    last_evaluation: claimEvals.length > 0 ? claimEvals[claimEvals.length - 1] : null,
    stagnant: consecutiveFailures >= STAGNATION_THRESHOLD,
  }
}

// ── Context Builder ──────────────────────────────────────

/**
 * Build a feedback context string for injection into the Arbiter prompt.
 * Shows recent evaluations, stagnant claims, and healthy claims.
 */
export function buildExperimentFeedbackContext(
  evaluations: ExperimentEvaluation[],
  claimHistories: Record<string, ClaimExperimentHistory>,
): string {
  if (evaluations.length === 0) return ''

  const lines: string[] = ['## Experiment Feedback']

  // Recent evaluations (last 5)
  const recent = evaluations.slice(-5)
  if (recent.length > 0) {
    lines.push('\n### Recent Evaluations')
    for (const ev of recent) {
      const target = ev.target_claim_id ? ` -> ${ev.target_claim_id.slice(0, 12)}` : ''
      const baseline = ev.beats_baseline === true ? 'TRUE' : ev.beats_baseline === false ? 'FALSE' : 'N/A'
      lines.push(
        `- ${ev.experiment_id}${target}: beats_baseline=${baseline}, failure_mode=${ev.failure_mode}`,
      )
      lines.push(`  Route: ${ev.recommended_route}. "${ev.reason}"`)
    }
  }

  // Stagnant claims (RETREAT)
  const stagnant = Object.values(claimHistories).filter(h => h.stagnant)
  if (stagnant.length > 0) {
    lines.push('\n### Stagnant Claims (RETREAT RECOMMENDED)')
    for (const h of stagnant) {
      lines.push(
        `- ${h.claim_id.slice(0, 12)}: ${h.consecutive_failures} consecutive failures. STRONGLY RECOMMEND reformulation or demotion.`,
      )
    }
  }

  // Healthy claims
  const healthy = Object.values(claimHistories).filter(
    h => h.total_experiments > 0 && !h.stagnant && h.last_evaluation?.beats_baseline === true,
  )
  if (healthy.length > 0) {
    lines.push('\n### Healthy Claims')
    for (const h of healthy) {
      lines.push(
        `- ${h.claim_id.slice(0, 12)}: ${h.total_experiments} experiments, on track.`,
      )
    }
  }

  return lines.join('\n')
}

// ── Helpers ──────────────────────────────────────────────

function buildReasonString(
  beatsBaseline: boolean | null,
  breakthrough: BreakthroughLevel,
  failureMode: FailureMode,
  conversion: EvidenceConversionResult,
): string {
  if (failureMode === 'implementation') {
    return 'Experiment execution failed (implementation error). Fix and retry.'
  }
  if (failureMode === 'evaluation') {
    return 'Experiment produced results but no baseline comparison possible.'
  }
  if (beatsBaseline === false) {
    return `Experiment does not beat baseline. ${conversion.summary}`
  }
  if (breakthrough === 'major') {
    return `Major breakthrough: beats baseline with strong improvement. ${conversion.summary}`
  }
  if (beatsBaseline === true) {
    return `Beats baseline (minor improvement). ${conversion.summary}`
  }
  return `Experiment completed. ${conversion.summary}`
}
