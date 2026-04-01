import { useMemo } from 'react'
import type { Node, Edge } from '@xyflow/react'

interface ClaimData {
  id: string
  statement: string
  phase: string
  epistemicLayer: string
  is_main?: boolean
  confidence?: number
  evidence_ids?: string[]
}

interface ClaimEdgeData {
  source: string
  target: string
  relation: string
  strength?: string
}

interface ClaimGraphData {
  claims: ClaimData[]
  edges: ClaimEdgeData[]
}

// Phase → node color
const PHASE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  admitted: { bg: '#4ade8020', border: '#4ade80', text: '#4ade80' },
  proposed: { bg: '#a78bfa20', border: '#a78bfa', text: '#a78bfa' },
  under_investigation: { bg: '#facc1520', border: '#facc15', text: '#facc15' },
  refuted: { bg: '#f8717120', border: '#f87171', text: '#f87171' },
  reformulated: { bg: '#22d3ee20', border: '#22d3ee', text: '#22d3ee' },
  suspended: { bg: '#6b728020', border: '#6b7280', text: '#6b7280' },
  demoted: { bg: '#4b556320', border: '#4b5563', text: '#4b5563' },
  rejected: { bg: '#f8717120', border: '#f87171', text: '#f87171' },
  retracted: { bg: '#37415120', border: '#374151', text: '#374151' },
}

// Relation → edge style
const RELATION_STYLES: Record<string, { stroke: string; strokeDasharray?: string; strokeWidth: number }> = {
  supports: { stroke: '#4ade80', strokeWidth: 2 },
  depends_on: { stroke: '#22d3ee', strokeDasharray: '5,5', strokeWidth: 1.5 },
  contradicts: { stroke: '#f87171', strokeWidth: 2 },
  motivates: { stroke: '#a78bfa', strokeDasharray: '2,4', strokeWidth: 1.5 },
  bridges: { stroke: '#facc15', strokeWidth: 3 },
  supersedes: { stroke: '#6b7280', strokeWidth: 1.5 },
}

const STRENGTH_OPACITY: Record<string, number> = {
  strong: 1.0,
  moderate: 0.7,
  weak: 0.4,
  conjectured: 0.25,
}

// Epistemic layer → vertical level
const LAYER_Y: Record<string, number> = {
  observation: 0,
  explanation: 1,
  exploitation: 2,
  justification: 3,
}

export function useClaimGraph(data: ClaimGraphData | null | undefined) {
  return useMemo(() => {
    if (!data || !data.claims?.length) {
      return { nodes: [] as Node[], edges: [] as Edge[] }
    }

    // Group by layer for layout
    const layerGroups: Record<string, ClaimData[]> = {}
    for (const claim of data.claims) {
      const layer = claim.epistemicLayer || 'observation'
      if (!layerGroups[layer]) layerGroups[layer] = []
      layerGroups[layer].push(claim)
    }

    const nodes: Node[] = []
    const X_SPACING = 280
    const Y_SPACING = 160

    for (const [layer, claims] of Object.entries(layerGroups)) {
      const yBase = (LAYER_Y[layer] ?? 0) * Y_SPACING
      const totalWidth = claims.length * X_SPACING
      const startX = -totalWidth / 2

      claims.forEach((claim, i) => {
        const colors = PHASE_COLORS[claim.phase] ?? PHASE_COLORS.proposed
        nodes.push({
          id: claim.id,
          position: { x: startX + i * X_SPACING, y: yBase },
          type: 'claim',
          data: {
            label: claim.statement,
            phase: claim.phase,
            layer: claim.epistemicLayer,
            isMain: claim.is_main,
            confidence: claim.confidence,
            evidenceCount: claim.evidence_ids?.length ?? 0,
            colors,
          },
        })
      })
    }

    const edges: Edge[] = data.edges.map((e, i) => {
      const style = RELATION_STYLES[e.relation] ?? RELATION_STYLES.supports
      const opacity = STRENGTH_OPACITY[e.strength ?? 'moderate']
      return {
        id: `e-${i}`,
        source: e.source,
        target: e.target,
        type: 'default',
        animated: e.relation === 'bridges',
        style: {
          ...style,
          opacity,
        },
        label: e.relation,
        labelStyle: { fill: '#6b7280', fontSize: 10 },
        labelBgStyle: { fill: '#0a0a0f', fillOpacity: 0.8 },
      }
    })

    return { nodes, edges }
  }, [data])
}
