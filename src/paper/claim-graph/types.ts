// ── Claim Types ─────────────────────────────────────────

export type ClaimType =
  | 'observation'
  | 'assumption'
  | 'hypothesis'
  | 'theorem'
  | 'algorithmic'
  | 'empirical'
  | 'novelty'
  | 'benchmark'
  | 'limitation'

export type EpistemicLayer =
  | 'observation'
  | 'explanation'
  | 'exploitation'
  | 'justification'

export type ClaimPhase =
  | 'proposed'
  | 'under_investigation'
  | 'admitted'
  | 'demoted'
  | 'rejected'
  | 'retracted'
  | 'reformulated'

export type EvidenceStrengthType =
  | 'theorem_support'
  | 'empirical_support'
  | 'heuristic_motivation'
  | 'ablation_support'
  | 'consistent_with'
  | 'no_support'

// ── Evidence Ladder (inspired by DeepScientist) ─────────
// Tiered acceptance criteria preventing weak evidence from supporting strong claims.

export type EvidenceTier = 'minimum' | 'solid' | 'maximum'

/**
 * Requirements for each evidence tier.
 *
 * minimum  — executable, comparable setup, direction not obviously broken
 * solid    — main comparison credible, baseline fair, results stable, significance tested
 * maximum  — main claim already credible, additional analysis broadens confidence/scope
 */
export const EVIDENCE_TIER_THRESHOLDS: Record<EvidenceTier, {
  minConfidence: number
  requiredEvidenceTypes: EvidenceStrengthType[]
  minEvidenceCount: number
  description: string
}> = {
  minimum: {
    minConfidence: 0.3,
    requiredEvidenceTypes: ['heuristic_motivation', 'consistent_with', 'empirical_support', 'theorem_support', 'ablation_support'],
    minEvidenceCount: 1,
    description: 'Basic executable result, direction not obviously broken',
  },
  solid: {
    minConfidence: 0.6,
    requiredEvidenceTypes: ['empirical_support', 'theorem_support', 'ablation_support'],
    minEvidenceCount: 2,
    description: 'Main comparison credible, baseline fair, results stable',
  },
  maximum: {
    minConfidence: 0.8,
    requiredEvidenceTypes: ['empirical_support', 'theorem_support'],
    minEvidenceCount: 3,
    description: 'Main claim credible, analysis broadens confidence and scope',
  },
}

/**
 * Determine the highest evidence tier a claim currently meets.
 */
export function computeEvidenceTier(claim: Claim): EvidenceTier {
  const { confidence, evidenceType } = claim.strength
  const evidenceCount = claim.evidence.grounded.length + claim.evidence.derived.length

  // Check from highest to lowest
  for (const tier of ['maximum', 'solid', 'minimum'] as EvidenceTier[]) {
    const req = EVIDENCE_TIER_THRESHOLDS[tier]
    if (
      confidence >= req.minConfidence &&
      req.requiredEvidenceTypes.includes(evidenceType) &&
      evidenceCount >= req.minEvidenceCount
    ) {
      return tier
    }
  }
  return 'minimum'
}

/**
 * Check whether a claim meets the required tier for admission.
 * Theorem/novelty claims require 'solid'; others require 'minimum'.
 */
export function meetsAdmissionRequirement(claim: Claim): {
  meets: boolean
  currentTier: EvidenceTier
  requiredTier: EvidenceTier
  gap: string | null
} {
  const currentTier = computeEvidenceTier(claim)
  const requiredTier: EvidenceTier =
    claim.type === 'theorem' || claim.type === 'novelty' ? 'solid' : 'minimum'

  const tierOrder: Record<EvidenceTier, number> = { minimum: 0, solid: 1, maximum: 2 }
  const meets = tierOrder[currentTier] >= tierOrder[requiredTier]

  return {
    meets,
    currentTier,
    requiredTier,
    gap: meets ? null : `Requires ${requiredTier} (${EVIDENCE_TIER_THRESHOLDS[requiredTier].description}), currently at ${currentTier}`,
  }
}

export interface ClaimStrength {
  confidence: number // 0-1
  evidenceType: EvidenceStrengthType
  vulnerabilityScore: number // 0-1, higher = more vulnerable
  /** Computed evidence tier — set automatically by claim graph operations. */
  evidenceTier?: EvidenceTier
}

export interface AssessmentEntry {
  timestamp: string
  assessor: 'builder' | 'skeptic' | 'arbiter'
  previous_strength: ClaimStrength
  new_strength: ClaimStrength
  reason: string
}

export interface Claim {
  id: string
  type: ClaimType
  epistemicLayer: EpistemicLayer
  statement: string
  phase: ClaimPhase
  evidence: { grounded: string[]; derived: string[] }
  strength: ClaimStrength
  created_at: string
  created_by: string
  last_assessed_at: string
  assessment_history: AssessmentEntry[]
  /** True for claims derived from proposal innovations. */
  is_main?: boolean
  /** Depth in the claim tree. Main claims = 0, their sub-claims = 1, etc. */
  depth?: number
  /** ID of the root main claim this sub-claim supports. */
  root_main_id?: string
  /** ID of the successor claim this was reformulated into. */
  reformulated_into?: string
  /** ID of the predecessor claim this was reformulated from. */
  reformulated_from?: string
  /** Number of times this claim lineage has been reformulated (0 = original). */
  reformulation_count?: number
}

// ── Edge Types ──────────────────────────────────────────

export type ClaimRelation =
  | 'supports'
  | 'depends_on'
  | 'contradicts'
  | 'motivates'
  | 'refines'
  | 'generalizes'
  | 'bridges'
  | 'supersedes'

export interface ClaimEdge {
  id: string
  source: string // claim ID
  target: string // claim ID
  relation: ClaimRelation
  strength: 'strong' | 'moderate' | 'weak' | 'conjectured'
  note?: string
}

// ── Serializable Data ───────────────────────────────────

export interface ClaimGraphData {
  claims: Claim[]
  edges: ClaimEdge[]
}

// ── Analysis Result Types ───────────────────────────────

export interface WeakestBridgeResult {
  claim: Claim
  vulnerability: number
  cascadeSize: number
}

export interface LayerSkipResult {
  edge: ClaimEdge
  description: string
}

export interface ContradictionResult {
  claim: Claim
  contradicting_edges: ClaimEdge[]
  conflicting_evidence: boolean
}

export interface RecentChangeResult {
  claim: Claim
  change: string
}

export interface ClaimGraphStatistics {
  total: number
  admitted: number
  proposed: number
  investigating: number
  demoted: number
  rejected: number
  retracted: number
  reformulated: number
  // by layer
  observations: number
  explanations: number
  exploitations: number
  justifications: number
  // edges
  totalEdges: number
  dependsOn: number
  supports: number
  contradicts: number
  motivates: number
  refines: number
  generalizes: number
  bridges: number
  supersedes: number
}

// ── Constants ───────────────────────────────────────────

export const EPISTEMIC_LAYER_ORDER: Record<EpistemicLayer, number> = {
  observation: 0,
  explanation: 1,
  exploitation: 2,
  justification: 3,
}
