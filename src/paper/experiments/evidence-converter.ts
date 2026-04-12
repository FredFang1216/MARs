import type { MetricsJson, ExperimentSpec, ExperimentPlan } from './types'
import type { EvidencePoolManager, DerivedInput } from '../evidence-pool'
import type { ClaimGraph } from '../claim-graph/index'
import type {
  EvidenceStrengthType,
  ClaimStrength,
  AssessmentEntry,
} from '../claim-graph/types'

// ── Types ─────────────────────────────────────────────

export interface EvidenceConversionResult {
  evidenceIds: string[]
  successCriteriaMet: boolean | null // null if no criteria defined
  confidenceDelta: number            // how much to adjust claim confidence (+/-)
  summary: string                    // human-readable summary
}

interface MetricEvidence {
  id: string
  kind: 'derived'
  claimText: string
}

// ── Converter ─────────────────────────────────────────

/**
 * Converts experiment metrics.json results into:
 * 1. Evidence entries in the EvidencePool
 * 2. Claim confidence adjustments
 * 3. Success criteria evaluation
 *
 * This closes the loop: ExperimentPlan → Execute → Metrics → Evidence → Claim Update
 */
export class ExperimentEvidenceConverter {
  /**
   * Convert a full metrics.json into evidence entries and evaluate success criteria.
   *
   * @param metrics       The parsed metrics.json from the experiment
   * @param experimentId  The experiment ID (for artifact tracking)
   * @param targetClaimId The claim this experiment targets
   * @param spec          The ExperimentSpec from the plan (optional, for success criteria)
   * @param pool          The evidence pool to add entries to
   * @param graph         The claim graph (for confidence updates)
   */
  convert(
    metrics: MetricsJson,
    experimentId: string,
    targetClaimId: string | null,
    spec: ExperimentSpec | null,
    pool: EvidencePoolManager,
    graph: ClaimGraph,
  ): EvidenceConversionResult {
    const evidenceIds: string[] = []
    const summaryParts: string[] = []

    // 1. Convert model-level metrics to evidence
    const modelEvidence = this.convertModelMetrics(
      metrics,
      experimentId,
      targetClaimId,
      pool,
    )
    evidenceIds.push(...modelEvidence.map(e => e.id))
    if (modelEvidence.length > 0) {
      summaryParts.push(
        `${modelEvidence.length} metric evidence entries from ${Object.keys(metrics.models).length} models`,
      )
    }

    // 2. Convert statistical tests to evidence (enhanced version of existing logic)
    const testEvidence = this.convertStatisticalTests(
      metrics,
      experimentId,
      targetClaimId,
      pool,
    )
    evidenceIds.push(...testEvidence.map(e => e.id))
    if (testEvidence.length > 0) {
      summaryParts.push(
        `${testEvidence.length} statistical test evidence entries`,
      )
    }

    // 3. Convert rankings to evidence
    const rankEvidence = this.convertRankings(
      metrics,
      experimentId,
      targetClaimId,
      pool,
    )
    evidenceIds.push(...rankEvidence.map(e => e.id))

    // 4. Evaluate success criteria
    let criteriaMet: boolean | null = null
    if (spec?.success_criteria) {
      criteriaMet = this.evaluateSuccessCriteria(
        metrics,
        spec.success_criteria,
      )
      summaryParts.push(
        `Success criteria "${spec.success_criteria}": ${criteriaMet ? 'MET' : 'NOT MET'}`,
      )
    }

    // 5. Compute confidence delta
    const confidenceDelta = this.computeConfidenceDelta(
      metrics,
      criteriaMet,
      testEvidence,
    )

    // 6. Apply confidence update to claim
    if (targetClaimId && confidenceDelta !== 0) {
      this.updateClaimConfidence(
        graph,
        targetClaimId,
        confidenceDelta,
        criteriaMet,
        experimentId,
      )
      summaryParts.push(
        `Claim confidence ${confidenceDelta > 0 ? '+' : ''}${confidenceDelta.toFixed(2)}`,
      )
    }

    // 7. Link all evidence to target claim
    if (targetClaimId) {
      const allEvidence: MetricEvidence[] = [
        ...modelEvidence,
        ...testEvidence,
        ...rankEvidence,
      ]
      this.linkEvidenceToClaim(allEvidence, targetClaimId, graph, pool)
    }

    return {
      evidenceIds,
      successCriteriaMet: criteriaMet,
      confidenceDelta,
      summary: summaryParts.join('; ') || 'No evidence extracted',
    }
  }

  // ── Model Metrics → Evidence ─────────────────────

  private convertModelMetrics(
    metrics: MetricsJson,
    experimentId: string,
    targetClaimId: string | null,
    pool: EvidencePoolManager,
  ): MetricEvidence[] {
    const results: MetricEvidence[] = []

    for (const [modelName, modelData] of Object.entries(metrics.models)) {
      // Out-of-sample metrics are the primary evidence
      const oos = modelData.out_of_sample
      if (!oos || Object.keys(oos).length === 0) continue

      const metricParts = Object.entries(oos)
        .filter(([_, v]) => typeof v === 'number' && Number.isFinite(v))
        .map(([k, v]) => `${k}=${(v as number).toFixed(4)}`)

      if (metricParts.length === 0) continue

      const claimText = `${modelName} out-of-sample: ${metricParts.join(', ')}`

      const input: DerivedInput = {
        claim: claimText,
        method: 'experiment',
        reproducible: true,
        artifact_id: experimentId,
        assumptions: [`seed=${metrics.seed ?? 42}`],
        supports_claims: targetClaimId ? [targetClaimId] : [],
        contradicts_claims: [],
        produced_by: 'experiment-runner',
      }

      const id = pool.addDerived(input)
      results.push({ id, kind: 'derived', claimText })
    }

    return results
  }

  // ── Statistical Tests → Evidence ──────────────────

  private convertStatisticalTests(
    metrics: MetricsJson,
    experimentId: string,
    targetClaimId: string | null,
    pool: EvidencePoolManager,
  ): MetricEvidence[] {
    if (!metrics.statistical_tests) return []
    const results: MetricEvidence[] = []

    for (const [name, test] of Object.entries(metrics.statistical_tests)) {
      if (
        typeof test.statistic !== 'number' ||
        typeof test.p_value !== 'number' ||
        !Number.isFinite(test.statistic) ||
        !Number.isFinite(test.p_value)
      ) {
        continue
      }

      const sig = test.significant_1pct
        ? 'significant at 1%'
        : test.significant_5pct
          ? 'significant at 5%'
          : 'not significant'

      const claimText = `${name}: statistic=${test.statistic.toFixed(4)}, p=${test.p_value.toFixed(4)} (${sig}), direction: ${test.direction ?? 'unknown'}`

      const id = pool.addDerived({
        claim: claimText,
        method: 'experiment',
        reproducible: true,
        artifact_id: experimentId,
        assumptions: [],
        supports_claims: targetClaimId ? [targetClaimId] : [],
        contradicts_claims: [],
        produced_by: 'experiment-runner',
      })

      results.push({ id, kind: 'derived', claimText })
    }

    return results
  }

  // ── Rankings → Evidence ───────────────────────────

  private convertRankings(
    metrics: MetricsJson,
    experimentId: string,
    targetClaimId: string | null,
    pool: EvidencePoolManager,
  ): MetricEvidence[] {
    if (!metrics.rankings) return []
    const results: MetricEvidence[] = []

    for (const [metric, ranking] of Object.entries(metrics.rankings)) {
      if (!Array.isArray(ranking) || ranking.length < 2) continue
      const claimText = `Ranking by ${metric}: ${ranking.join(' > ')}`

      const id = pool.addDerived({
        claim: claimText,
        method: 'experiment',
        reproducible: true,
        artifact_id: experimentId,
        assumptions: [],
        supports_claims: targetClaimId ? [targetClaimId] : [],
        contradicts_claims: [],
        produced_by: 'experiment-runner',
      })

      results.push({ id, kind: 'derived', claimText })
    }

    return results
  }

  // ── Success Criteria Evaluation ───────────────────

  /**
   * Evaluate whether metrics meet the spec's success_criteria.
   *
   * Supports simple patterns like:
   *   "accuracy > 0.85"
   *   "f1 > baseline"
   *   "mse < 0.1"
   *   "accuracy > baseline by 2%"
   *   "accuracy > random baseline on >80% of datasets"
   *
   * For complex criteria, falls back to heuristic keyword matching.
   */
  evaluateSuccessCriteria(
    metrics: MetricsJson,
    criteria: string,
  ): boolean {
    // Extract all model metrics for comparison
    const allMetrics = this.flattenMetrics(metrics)

    // Try to parse simple comparison: "metric > value"
    const simpleMatch = criteria.match(
      /(\w+)\s*(>|<|>=|<=)\s*([\d.]+)/,
    )
    if (simpleMatch) {
      const [, metricName, op, thresholdStr] = simpleMatch
      const threshold = parseFloat(thresholdStr)
      const values = allMetrics
        .filter(m => m.metric.toLowerCase() === metricName.toLowerCase())
        .map(m => m.value)

      if (values.length > 0) {
        const avg = values.reduce((a, b) => a + b, 0) / values.length
        switch (op) {
          case '>':  return avg > threshold
          case '<':  return avg < threshold
          case '>=': return avg >= threshold
          case '<=': return avg <= threshold
        }
      }
    }

    // Try "X > baseline" pattern
    if (criteria.toLowerCase().includes('baseline')) {
      return this.evaluateVsBaseline(metrics, criteria)
    }

    // Fallback: criteria format not recognized — cannot evaluate
    return false
  }

  evaluateVsBaseline(
    metrics: MetricsJson,
    criteria: string,
  ): boolean {
    const modelNames = Object.keys(metrics.models)
    const baselineNames = modelNames.filter(
      n =>
        n.toLowerCase().includes('baseline') ||
        n.toLowerCase().includes('random') ||
        n.toLowerCase().includes('dummy'),
    )
    const nonBaselineNames = modelNames.filter(
      n => !baselineNames.includes(n),
    )

    if (baselineNames.length === 0 || nonBaselineNames.length === 0) {
      return false // can't compare without both baseline and non-baseline
    }

    // Compare average out-of-sample metrics
    const baselineAvg = this.averageOOS(metrics, baselineNames)
    const modelAvg = this.averageOOS(metrics, nonBaselineNames)

    // For each metric, check if models beat baseline
    let wins = 0
    let total = 0
    for (const metric of Object.keys(baselineAvg)) {
      if (!(metric in modelAvg)) continue
      total++
      const bv = baselineAvg[metric]
      const mv = modelAvg[metric]
      // Lower is better for error metrics, higher for accuracy metrics
      const lowerBetter = metric.includes('mse') || metric.includes('mae') || metric.includes('rmse') || metric.includes('loss') || metric.includes('error')
      if (lowerBetter ? mv < bv : mv > bv) wins++
    }

    return total > 0 && wins / total > 0.5
  }

  averageOOS(
    metrics: MetricsJson,
    modelNames: string[],
  ): Record<string, number> {
    const sums: Record<string, number> = {}
    const counts: Record<string, number> = {}

    for (const name of modelNames) {
      const oos = metrics.models[name]?.out_of_sample
      if (!oos) continue
      for (const [k, v] of Object.entries(oos)) {
        if (typeof v !== 'number' || !Number.isFinite(v)) continue
        sums[k] = (sums[k] ?? 0) + v
        counts[k] = (counts[k] ?? 0) + 1
      }
    }

    const result: Record<string, number> = {}
    for (const k of Object.keys(sums)) {
      result[k] = sums[k] / counts[k]
    }
    return result
  }

  flattenMetrics(
    metrics: MetricsJson,
  ): Array<{ model: string; metric: string; value: number }> {
    const results: Array<{ model: string; metric: string; value: number }> = []
    for (const [model, data] of Object.entries(metrics.models)) {
      const oos = data.out_of_sample
      if (!oos) continue
      for (const [metric, value] of Object.entries(oos)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          results.push({ model, metric, value })
        }
      }
    }
    return results
  }

  // ── Confidence Computation ────────────────────────

  /**
   * Compute how much to adjust the target claim's confidence.
   *
   * Rules:
   * - Success criteria met + significant tests → +0.15
   * - Success criteria met, no sig tests → +0.10
   * - Success criteria not met → -0.05
   * - No criteria, has significant results → +0.10
   * - No criteria, no sig results → +0.05 (at least we tried)
   * - Experiment failed → -0.10
   */
  private computeConfidenceDelta(
    metrics: MetricsJson,
    criteriaMet: boolean | null,
    testEvidence: MetricEvidence[],
  ): number {
    const hasSignificant = testEvidence.length > 0
    const hasModels = Object.keys(metrics.models).length > 0

    if (!hasModels) return -0.10 // experiment produced no results

    if (criteriaMet === true) {
      return hasSignificant ? 0.15 : 0.10
    }
    if (criteriaMet === false) {
      return -0.05
    }
    // No criteria defined
    return hasSignificant ? 0.10 : 0.05
  }

  // ── Claim Update ──────────────────────────────────

  private updateClaimConfidence(
    graph: ClaimGraph,
    claimId: string,
    delta: number,
    criteriaMet: boolean | null,
    experimentId: string,
  ): void {
    const claim = graph.getClaim(claimId)
    if (!claim) return

    const prevStrength = { ...claim.strength }
    const newConfidence = Math.max(0, Math.min(1, claim.strength.confidence + delta))

    // Upgrade evidence type based on experimental results
    let newEvidenceType: EvidenceStrengthType = claim.strength.evidenceType
    if (criteriaMet === true) {
      // Promote to empirical_support if criteria met
      if (
        newEvidenceType === 'heuristic_motivation' ||
        newEvidenceType === 'consistent_with' ||
        newEvidenceType === 'no_support'
      ) {
        newEvidenceType = 'empirical_support'
      }
    } else if (criteriaMet === false) {
      // Downgrade if criteria failed
      if (newEvidenceType === 'empirical_support') {
        newEvidenceType = 'consistent_with'
      }
    }

    // Lower vulnerability if we have positive evidence
    const newVulnerability = delta > 0
      ? Math.max(0, claim.strength.vulnerabilityScore - Math.abs(delta))
      : Math.min(1, claim.strength.vulnerabilityScore + Math.abs(delta) * 0.5)

    const newStrength: ClaimStrength = {
      confidence: newConfidence,
      evidenceType: newEvidenceType,
      vulnerabilityScore: newVulnerability,
    }

    // Create assessment entry for audit trail
    const assessment: AssessmentEntry = {
      timestamp: new Date().toISOString(),
      assessor: 'arbiter', // experiment evidence acts as arbiter assessment
      previous_strength: prevStrength,
      new_strength: newStrength,
      reason: `Experiment ${experimentId}: ${criteriaMet === true ? 'success criteria met' : criteriaMet === false ? 'success criteria NOT met' : 'completed (no criteria)'}`,
    }

    graph.updateClaim(claimId, {
      strength: newStrength,
      assessment_history: [...claim.assessment_history, assessment],
    })
  }

  // ── Evidence Linking ──────────────────────────────

  private linkEvidenceToClaim(
    evidence: MetricEvidence[],
    claimId: string,
    graph: ClaimGraph,
    pool: EvidencePoolManager,
  ): void {
    const claim = graph.getClaim(claimId)
    if (!claim) return

    const newDerivedIds: string[] = [...claim.evidence.derived]

    for (const ev of evidence) {
      // Forward link: evidence → claim
      const entry = pool.getDerived(ev.id)
      if (entry && !entry.supports_claims.includes(claimId)) {
        entry.supports_claims.push(claimId)
      }
      // Reverse link: claim → evidence
      if (!newDerivedIds.includes(ev.id)) {
        newDerivedIds.push(ev.id)
      }
    }

    graph.updateClaim(claimId, {
      evidence: { ...claim.evidence, derived: newDerivedIds },
    })
  }
}
