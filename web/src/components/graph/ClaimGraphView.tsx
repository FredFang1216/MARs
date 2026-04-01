import { useState, useMemo, useCallback, useEffect } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type OnNodesChange,
  type OnEdgesChange,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { useUiStore } from '../../stores/uiStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useClaimGraph } from '../../hooks/useClaimGraph'
import ClaimNode from './ClaimNode'
import GraphControls from './GraphControls'
import ClaimDetailDrawer from './ClaimDetailDrawer'

const nodeTypes = { claim: ClaimNode }

export default function ClaimGraphView() {
  const graphViewActive = useUiStore(s => s.graphViewActive)
  const graphFullscreen = useUiStore(s => s.graphFullscreen)
  const selectedClaimId = useUiStore(s => s.selectedClaimId)
  const setSelectedClaimId = useUiStore(s => s.setSelectedClaimId)
  const researchState = useSessionStore(s => s.researchState)

  const claimGraph = researchState?.claimGraph
  const { nodes: initialNodes, edges: initialEdges } = useClaimGraph(claimGraph)

  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [activePhases, setActivePhases] = useState<Set<string>>(new Set())

  // Sync from hook data
  useEffect(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
    // Collect all phases
    const phases = new Set(initialNodes.map(n => (n.data as any).phase as string))
    setActivePhases(phases)
  }, [initialNodes, initialEdges])

  // All unique phases
  const allPhases = useMemo(
    () => [...new Set(initialNodes.map(n => (n.data as any).phase as string))],
    [initialNodes],
  )

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes(nds => applyNodeChanges(changes, nds)),
    [],
  )

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges(eds => applyEdgeChanges(changes, eds)),
    [],
  )

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedClaimId(node.id)
    },
    [setSelectedClaimId],
  )

  const handleTogglePhase = useCallback((phase: string) => {
    setActivePhases(prev => {
      const next = new Set(prev)
      if (next.has(phase)) {
        next.delete(phase)
      } else {
        next.add(phase)
      }
      return next
    })
  }, [])

  const handleResetFilter = useCallback(() => {
    setActivePhases(new Set(allPhases))
  }, [allPhases])

  // Filter nodes/edges by active phases
  const filteredNodes = useMemo(
    () => nodes.filter(n => activePhases.has((n.data as any).phase)),
    [nodes, activePhases],
  )
  const filteredNodeIds = useMemo(
    () => new Set(filteredNodes.map(n => n.id)),
    [filteredNodes],
  )
  const filteredEdges = useMemo(
    () => edges.filter(e => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)),
    [edges, filteredNodeIds],
  )

  // Find selected claim data
  const selectedClaim = useMemo(() => {
    if (!selectedClaimId || !claimGraph) return null
    return claimGraph.claims?.find((c: any) => c.id === selectedClaimId) ?? null
  }, [selectedClaimId, claimGraph])

  if (!graphViewActive) return null

  const containerClass = graphFullscreen
    ? 'fixed inset-0 z-50 bg-surface-0'
    : 'flex-1 min-h-0'

  return (
    <div className={`${containerClass} flex flex-col`}>
      <GraphControls
        phases={allPhases}
        activePhases={activePhases}
        onTogglePhase={handleTogglePhase}
        onResetFilter={handleResetFilter}
      />

      <div className="flex-1 relative">
        <ReactFlow
          nodes={filteredNodes}
          edges={filteredEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.2}
          maxZoom={2}
          defaultEdgeOptions={{
            style: { strokeWidth: 1.5 },
          }}
        >
          <Background color="#222230" gap={20} />
          <Controls />
          <MiniMap
            nodeColor={(n) => (n.data as any).colors?.border ?? '#666'}
            maskColor="rgba(10, 10, 15, 0.7)"
          />
        </ReactFlow>

        <ClaimDetailDrawer claim={selectedClaim} />
      </div>
    </div>
  )
}
