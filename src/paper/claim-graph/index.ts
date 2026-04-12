import { randomUUID } from 'crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import type {
  Claim,
  ClaimEdge,
  ClaimGraphData,
  ClaimType,
  ClaimPhase,
  EpistemicLayer,
  ClaimRelation,
  WeakestBridgeResult,
  LayerSkipResult,
  ContradictionResult,
  RecentChangeResult,
  ClaimGraphStatistics,
} from './types'
import { EPISTEMIC_LAYER_ORDER, computeEvidenceTier, meetsAdmissionRequirement } from './types'

export { EPISTEMIC_LAYER_ORDER, computeEvidenceTier, meetsAdmissionRequirement } from './types'
export type { EvidenceTier } from './types'
export type {
  Claim,
  ClaimEdge,
  ClaimGraphData,
  ClaimType,
  ClaimPhase,
  EpistemicLayer,
  ClaimRelation,
  ClaimStrength,
  EvidenceStrengthType,
  AssessmentEntry,
  WeakestBridgeResult,
  LayerSkipResult,
  ContradictionResult,
  RecentChangeResult,
  ClaimGraphStatistics,
} from './types'

export type ClaimInput = Omit<
  Claim,
  'id' | 'created_at' | 'last_assessed_at' | 'assessment_history'
>
export type EdgeInput = Omit<ClaimEdge, 'id'>

export class ClaimGraph {
  private claims: Map<string, Claim> = new Map()
  private edges: Map<string, ClaimEdge> = new Map()

  constructor(data?: ClaimGraphData) {
    if (data) {
      for (const c of data.claims) this.claims.set(c.id, c)
      for (const e of data.edges) this.edges.set(e.id, e)
    }
  }

  // ── CRUD ────────────────────────────────────────────

  addClaim(input: ClaimInput): string {
    const id = randomUUID()
    const now = new Date().toISOString()
    const claim: Claim = {
      ...input,
      id,
      created_at: now,
      last_assessed_at: now,
      assessment_history: [],
    }
    // Compute evidence tier on creation
    claim.strength = {
      ...claim.strength,
      evidenceTier: computeEvidenceTier(claim),
    }
    this.claims.set(id, claim)
    return id
  }

  /**
   * Update a claim. If transitioning to 'admitted', the evidence ladder
   * gate is checked — theorem/novelty claims require 'solid' tier.
   * Returns { admitted: boolean, gap?: string } for callers to act on.
   */
  updateClaim(claimId: string, updates: Partial<Omit<Claim, 'id'>>): { admitted: boolean; gap?: string } {
    const existing = this.claims.get(claimId)
    if (!existing) throw new Error(`Claim not found: ${claimId}`)

    const merged: Claim = {
      ...existing,
      ...updates,
      id: claimId,
      last_assessed_at: new Date().toISOString(),
    }

    // Recompute evidence tier
    merged.strength = {
      ...merged.strength,
      evidenceTier: computeEvidenceTier(merged),
    }

    // Evidence ladder gate: block admission if tier insufficient
    const isAdmitting = updates.phase === 'admitted' && existing.phase !== 'admitted'
    if (isAdmitting) {
      const check = meetsAdmissionRequirement(merged)
      if (!check.meets) {
        // Downgrade to under_investigation instead of admitting
        merged.phase = 'under_investigation'
        this.claims.set(claimId, merged)
        return { admitted: false, gap: check.gap ?? undefined }
      }
    }

    this.claims.set(claimId, merged)
    return { admitted: isAdmitting ? true : false }
  }

  removeClaim(claimId: string): void {
    this.claims.delete(claimId)
    // cascade-delete edges referencing this claim
    for (const [edgeId, edge] of this.edges) {
      if (edge.source === claimId || edge.target === claimId) {
        this.edges.delete(edgeId)
      }
    }
  }

  getClaim(claimId: string): Claim | undefined {
    return this.claims.get(claimId)
  }

  addEdge(input: EdgeInput): string {
    if (!this.claims.has(input.source))
      throw new Error(`Source claim not found: ${input.source}`)
    if (!this.claims.has(input.target))
      throw new Error(`Target claim not found: ${input.target}`)
    const id = randomUUID()
    const edge: ClaimEdge = { ...input, id }
    this.edges.set(id, edge)
    return id
  }

  removeEdge(edgeId: string): void {
    this.edges.delete(edgeId)
  }

  // ── Query ───────────────────────────────────────────

  getClaimsByPhase(phase: ClaimPhase): Claim[] {
    return [...this.claims.values()].filter(c => c.phase === phase)
  }

  getClaimsByType(type: ClaimType): Claim[] {
    return [...this.claims.values()].filter(c => c.type === type)
  }

  getClaimsByLayer(layer: EpistemicLayer): Claim[] {
    return [...this.claims.values()].filter(c => c.epistemicLayer === layer)
  }

  getDependencies(claimId: string): string[] {
    return [...this.edges.values()]
      .filter(e => e.source === claimId && e.relation === 'depends_on')
      .map(e => e.target)
  }

  getEdgesOf(claimId: string): ClaimEdge[] {
    return [...this.edges.values()].filter(
      e => e.source === claimId || e.target === claimId,
    )
  }

  getEdgesWithin(claimIds: string[]): ClaimEdge[] {
    const idSet = new Set(claimIds)
    return [...this.edges.values()].filter(
      e => idSet.has(e.source) && idSet.has(e.target),
    )
  }

  // ── Analysis ────────────────────────────────────────

  /**
   * BFS on reverse depends_on adjacency.
   * Edge A→B means "A depends on B".
   * Returns all claim IDs that transitively depend on claimId.
   */
  cascadeAnalysis(claimId: string): string[] {
    // Build reverse map: B → [A, ...] (who depends on B)
    const dependedUponBy = new Map<string, string[]>()
    for (const edge of this.edges.values()) {
      if (edge.relation !== 'depends_on') continue
      const list = dependedUponBy.get(edge.target) || []
      list.push(edge.source)
      dependedUponBy.set(edge.target, list)
    }

    const visited = new Set<string>()
    const queue = [claimId]
    visited.add(claimId)

    while (queue.length > 0) {
      const current = queue.shift()!
      const dependents = dependedUponBy.get(current) || []
      for (const dep of dependents) {
        if (!visited.has(dep)) {
          visited.add(dep)
          queue.push(dep)
        }
      }
    }

    visited.delete(claimId) // exclude self
    return [...visited]
  }

  findWeakestBridges(): WeakestBridgeResult[] {
    const results: WeakestBridgeResult[] = []

    for (const claim of this.claims.values()) {
      const evidenceCount =
        claim.evidence.grounded.length + claim.evidence.derived.length
      const rawVuln =
        (1 - claim.strength.confidence) * 0.4 +
        claim.strength.vulnerabilityScore * 0.3 +
        (1 / Math.max(1, evidenceCount)) * 0.3
      const cascadeSize = this.cascadeAnalysis(claim.id).length
      const vulnerability = rawVuln * Math.log2(cascadeSize + 2)

      results.push({ claim, vulnerability, cascadeSize })
    }

    return results.sort((a, b) => b.vulnerability - a.vulnerability)
  }

  findContradictions(): ContradictionResult[] {
    const resultMap = new Map<string, ContradictionResult>()

    for (const edge of this.edges.values()) {
      if (edge.relation !== 'contradicts') continue

      for (const id of [edge.source, edge.target]) {
        const claim = this.claims.get(id)
        if (!claim) continue
        const existing = resultMap.get(id)
        if (existing) {
          existing.contradicting_edges.push(edge)
        } else {
          const hasConflicting =
            claim.evidence.grounded.length > 0 &&
            claim.evidence.derived.length > 0
          resultMap.set(id, {
            claim,
            contradicting_edges: [edge],
            conflicting_evidence: hasConflicting,
          })
        }
      }
    }

    return [...resultMap.values()]
  }

  detectLayerSkips(): LayerSkipResult[] {
    const results: LayerSkipResult[] = []

    for (const edge of this.edges.values()) {
      if (edge.relation !== 'depends_on' && edge.relation !== 'supports')
        continue

      const sourceClaim = this.claims.get(edge.source)
      const targetClaim = this.claims.get(edge.target)
      if (!sourceClaim || !targetClaim) continue

      const sourceOrder = EPISTEMIC_LAYER_ORDER[sourceClaim.epistemicLayer]
      const targetOrder = EPISTEMIC_LAYER_ORDER[targetClaim.epistemicLayer]

      if (Math.abs(sourceOrder - targetOrder) > 1) {
        results.push({
          edge,
          description:
            `Layer skip: "${sourceClaim.epistemicLayer}" (${sourceClaim.id}) ` +
            `→ "${targetClaim.epistemicLayer}" (${targetClaim.id}) ` +
            `via ${edge.relation} edge`,
        })
      }
    }

    return results
  }

  detectLayerSkipsFor(claimId: string): LayerSkipResult[] {
    return this.detectLayerSkips().filter(
      r => r.edge.source === claimId || r.edge.target === claimId,
    )
  }

  getStatistics(): ClaimGraphStatistics {
    const stats: ClaimGraphStatistics = {
      total: 0,
      admitted: 0,
      proposed: 0,
      investigating: 0,
      demoted: 0,
      rejected: 0,
      retracted: 0,
      reformulated: 0,
      observations: 0,
      explanations: 0,
      exploitations: 0,
      justifications: 0,
      totalEdges: 0,
      dependsOn: 0,
      supports: 0,
      contradicts: 0,
      motivates: 0,
      refines: 0,
      generalizes: 0,
      bridges: 0,
      supersedes: 0,
    }

    for (const c of this.claims.values()) {
      stats.total++
      if (c.phase === 'admitted') stats.admitted++
      else if (c.phase === 'proposed') stats.proposed++
      else if (c.phase === 'under_investigation') stats.investigating++
      else if (c.phase === 'demoted') stats.demoted++
      else if (c.phase === 'rejected') stats.rejected++
      else if (c.phase === 'retracted') stats.retracted++
      else if (c.phase === 'reformulated') stats.reformulated++

      if (c.epistemicLayer === 'observation') stats.observations++
      else if (c.epistemicLayer === 'explanation') stats.explanations++
      else if (c.epistemicLayer === 'exploitation') stats.exploitations++
      else if (c.epistemicLayer === 'justification') stats.justifications++
    }

    for (const e of this.edges.values()) {
      stats.totalEdges++
      if (e.relation === 'depends_on') stats.dependsOn++
      else if (e.relation === 'supports') stats.supports++
      else if (e.relation === 'contradicts') stats.contradicts++
      else if (e.relation === 'motivates') stats.motivates++
      else if (e.relation === 'refines') stats.refines++
      else if (e.relation === 'generalizes') stats.generalizes++
      else if (e.relation === 'bridges') stats.bridges++
      else if (e.relation === 'supersedes') stats.supersedes++
    }

    return stats
  }

  getRecentlyChanged(hours: number): RecentChangeResult[] {
    const cutoff = Date.now() - hours * 3600 * 1000
    const results: RecentChangeResult[] = []

    for (const claim of this.claims.values()) {
      const assessedAt = new Date(claim.last_assessed_at).getTime()
      if (isNaN(assessedAt) || assessedAt < cutoff) continue

      let change = `phase: ${claim.phase}`
      const history = claim.assessment_history
      if (history.length > 0) {
        const last = history[history.length - 1]
        change = `strength ${last.previous_strength.confidence.toFixed(2)} → ${last.new_strength.confidence.toFixed(2)} by ${last.assessor}: ${last.reason}`
      }

      results.push({ claim, change })
    }

    return results
  }

  // ── Main Claim Queries ─────────────────────────────

  /** Get all main claims (proposal innovations). */
  getMainClaims(): Claim[] {
    return [...this.claims.values()].filter(c => c.is_main === true)
  }

  /** Compute depth from nearest main claim via depends_on edges. */
  getDepthFromMain(claimId: string): number | null {
    const claim = this.claims.get(claimId)
    if (!claim) return null
    if (claim.is_main) return 0
    if (claim.depth != null) return claim.depth
    // BFS up depends_on edges to find nearest main claim
    const visited = new Set<string>([claimId])
    const queue: { id: string; dist: number }[] = [{ id: claimId, dist: 0 }]
    while (queue.length > 0) {
      const { id, dist } = queue.shift()!
      for (const depId of this.getDependencies(id)) {
        if (visited.has(depId)) continue
        visited.add(depId)
        const dep = this.claims.get(depId)
        if (!dep) continue
        if (dep.is_main) return dist + 1
        queue.push({ id: depId, dist: dist + 1 })
      }
    }
    return null // not connected to any main claim
  }

  /** Get active main claims (excludes reformulated/rejected/retracted). */
  getActiveMainClaims(): Claim[] {
    return this.getMainClaims().filter(
      c =>
        c.phase !== 'reformulated' &&
        c.phase !== 'rejected' &&
        c.phase !== 'retracted',
    )
  }

  /**
   * Walk the reformulation lineage for a claim.
   * Returns ordered list from earliest ancestor to latest descendant.
   */
  getReformulationLineage(claimId: string): Claim[] {
    const lineage: Claim[] = []

    // Walk backward via reformulated_from
    let current = this.claims.get(claimId)
    const backwardIds: string[] = []
    while (current?.reformulated_from) {
      const prev = this.claims.get(current.reformulated_from)
      if (!prev) break
      backwardIds.unshift(prev.id)
      current = prev
    }

    // Collect backward claims
    for (const id of backwardIds) {
      const c = this.claims.get(id)
      if (c) lineage.push(c)
    }

    // Add the queried claim itself
    const self = this.claims.get(claimId)
    if (self) lineage.push(self)

    // Walk forward via reformulated_into
    current = self
    while (current?.reformulated_into) {
      const next = this.claims.get(current.reformulated_into)
      if (!next) break
      lineage.push(next)
      current = next
    }

    return lineage
  }

  // ── Convenience ─────────────────────────────────────

  get claimCount(): number {
    return this.claims.size
  }

  get edgeCount(): number {
    return this.edges.size
  }

  get allClaims(): Claim[] {
    return [...this.claims.values()]
  }

  get allEdges(): ClaimEdge[] {
    return [...this.edges.values()]
  }

  // ── Serialization ───────────────────────────────────

  toJSON(): ClaimGraphData {
    return {
      claims: [...this.claims.values()],
      edges: [...this.edges.values()],
    }
  }

  static fromJSON(data: ClaimGraphData): ClaimGraph {
    return new ClaimGraph(data)
  }

  save(projectDir: string): void {
    const metaDir = join(projectDir, '.claude-paper')
    if (!existsSync(metaDir)) {
      mkdirSync(metaDir, { recursive: true })
    }
    const filePath = join(metaDir, 'claim-graph.json')
    writeFileSync(filePath, JSON.stringify(this.toJSON(), null, 2), 'utf-8')
  }

  static load(projectDir: string): ClaimGraph | null {
    const filePath = join(projectDir, '.claude-paper', 'claim-graph.json')
    if (!existsSync(filePath)) return null
    try {
      const raw = readFileSync(filePath, 'utf-8')
      return ClaimGraph.fromJSON(JSON.parse(raw))
    } catch {
      return null
    }
  }
}
