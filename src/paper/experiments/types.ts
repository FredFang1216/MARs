// -- Experiment Meta (meta.json per experiment directory) -----

export interface ExperimentMeta {
  id: string // probe-001-garch-sanity or run-001-baseline
  tier: 1 | 2
  purpose: string
  targets_claim: string // Claim Graph claim ID
  created_at: string
  created_by: string
  status: 'created' | 'running' | 'completed' | 'failed' | 'aborted'
  duration_seconds?: number
  exit_code?: number
  seed: number
  promoted_to_run?: string | null // probe promoted to run
}

// -- Experiment Log (experiment-log.json) -----

export interface ExperimentLogEntry {
  id: string
  tier: 1 | 2
  status: string
  purpose: string
  targets_claim: string
  key_result: string | null
  created_at: string
  duration_seconds: number | null
  path: string // relative to project root
  audit_status?: 'passed' | 'warning' | 'failed' | null
  tests_passed?: boolean | null
}

export interface ExperimentLog {
  experiments: ExperimentLogEntry[]
}

// -- Structured Results (results/metrics.json) -----

export interface MetricsJson {
  experiment_id: string
  timestamp: string
  seed: number
  models: Record<
    string,
    {
      in_sample?: Record<string, number>
      out_of_sample: Record<string, number>
      parameters?: Record<string, any>
      convergence?: boolean
    }
  >
  rankings?: Record<string, string[]>
  statistical_tests?: Record<
    string,
    {
      statistic: number
      p_value: number
      significant_5pct: boolean
      significant_1pct: boolean
      direction: string
    }
  >
}

// -- Audit Types -----

export interface AuditCheck {
  name: string
  passed: boolean
  details: string
}

export interface AuditResult {
  passed: boolean
  checks: AuditCheck[]
  timestamp: string
}

export interface SemanticAuditResult {
  overall_assessment: 'pass' | 'warning' | 'fail'
  issues: Array<{
    severity: 'critical' | 'major' | 'minor'
    category: string
    description: string
    suggestion: string
  }>
  positive_notes: string[]
}

export interface FullAuditResult {
  experiment_id: string
  audit_timestamp: string
  static_audit: AuditResult
  semantic_audit?: SemanticAuditResult
}

// -- Experiment Summary (compact, for Orchestrator context) -----

export interface ExperimentSummary {
  id: string
  tier: 1 | 2
  purpose: string
  targets_claim: string
  key_result: string | null
  created_at: string
}

// -- Lab Journal Types -----

export interface NoteData {
  arbiterDecision: {
    reasoning: string
    action: {
      type: string
      delegate_to: string
      targets_claim?: string
      [key: string]: any
    }
  }
  builderNarrative: string
  skepticChallenge: string | null
  executionResult: {
    success: boolean
    summary: string
    agent: string
    artifacts_produced: string[]
    cost_usd: number
  }
  metricsJson: MetricsJson | null
  auditResult: FullAuditResult | null
  claimImpacts: Array<{
    claim_id: string
    action: string
    new_confidence?: number
    reason: string
  }>
}

export interface ExperimentNoteSummary {
  id: string
  purpose: string
  targets_claim: string
  success: boolean
  key_metrics: string[]
  audit_status: string
  arbiter_action: string
  one_liner: string
}

export interface CycleEntry {
  cycle: number
  timestamp: string
  action: string
  builder_summary: string
  skeptic_summary: string
  arbiter_decision: string
  result_summary: string
  claim_delta: ClaimDelta
  experiment_notes: ExperimentNoteSummary[]
  is_turning_point: boolean
}

export interface ClaimDelta {
  added: number
  admitted: number
  demoted: number
  rejected: number
  total_claims: number
  total_admitted: number
  convergence_score: number
}

export interface DashboardData {
  total_cycles: number
  total_experiments: number
  experiments_succeeded: number
  experiments_failed: number
  claims_total: number
  claims_admitted: number
  convergence_score: number
  paper_readiness: string
  budget_spent_usd: number
  budget_remaining_usd: number
  turning_points: number
  last_updated: string
}

// -- Experiment Plan (proposal → experiment design) -----

export interface DatasetSpec {
  name: string
  source: 'openml' | 'sklearn' | 'huggingface' | 'url' | 'generate' | 'api'
  source_id?: string       // OpenML data_id, sklearn dataset name, HF dataset path, etc.
  download_code: string    // Python snippet to download/load this dataset
  size_estimate: string    // e.g. "~10K rows, 20 features"
  description: string
}

export interface ExperimentSpec {
  id: string
  name: string
  claim_target: string        // Which proposal claim this validates
  description: string         // What this experiment tests
  type: 'probe' | 'full'     // Tier 1 or Tier 2
  datasets: string[]          // References to DatasetSpec.name
  script_outline: string      // High-level pseudocode / approach
  metrics_to_collect: string[] // e.g. ["accuracy", "f1", "training_time_sec"]
  success_criteria: string    // e.g. "accuracy > baseline by 2% on majority of datasets"
  dependencies: string[]      // Other ExperimentSpec.id this depends on
  estimated_duration: string  // e.g. "5 minutes"
  python_packages: string[]   // Extra pip packages needed beyond defaults
}

export interface ExperimentPlan {
  id: string
  proposal_id: string
  created_at: string
  datasets: DatasetSpec[]
  experiments: ExperimentSpec[]
  execution_order: string[]       // Topologically sorted experiment IDs
  total_compute_estimate: string
  requires_gpu: boolean
  data_acquisition_strategy: string  // Human-readable summary of how to get all data
}
