// Frontend types mirroring backend experiment structures

export interface ExperimentLogEntry {
  id: string
  tier: 1 | 2
  status: string
  purpose: string
  targets_claim: string
  key_result: string | null
  created_at: string
  duration_seconds: number | null
  path: string
  audit_status?: string | null
  tests_passed?: boolean | null
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

export interface MetricsJson {
  experiment_id: string
  timestamp: string
  seed: number
  models: Record<string, {
    in_sample?: Record<string, number>
    out_of_sample: Record<string, number>
    parameters?: Record<string, any>
    convergence?: boolean
  }>
  rankings?: Record<string, string[]>
  statistical_tests?: Record<string, {
    statistic: number
    p_value: number
    significant_5pct: boolean
    significant_1pct: boolean
    direction: string
  }>
}

export interface AuditCheck {
  name: string
  passed: boolean
  details: string
}

export interface FullAuditResult {
  experiment_id: string
  audit_timestamp: string
  static_audit: {
    passed: boolean
    checks: AuditCheck[]
    timestamp: string
  }
  semantic_audit?: {
    overall_assessment: string
    issues: Array<{
      severity: string
      category: string
      description: string
      suggestion: string
    }>
    positive_notes: string[]
  }
}

export interface ExperimentDetail {
  log_entry: ExperimentLogEntry
  meta: {
    id: string
    tier: 1 | 2
    purpose: string
    targets_claim: string
    created_at: string
    created_by: string
    status: string
    duration_seconds?: number
    seed: number
    promoted_to_run?: string | null
  } | null
  metrics: MetricsJson | null
  audit: FullAuditResult | null
  figures: string[]
  tables: string[]
  has_note: boolean
}

export interface ComparisonResult {
  experiment_id: string
  model: string
  value: number
}
