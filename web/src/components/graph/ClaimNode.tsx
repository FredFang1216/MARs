import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'

interface ClaimNodeData {
  label: string
  phase: string
  layer: string
  isMain?: boolean
  confidence?: number
  evidenceCount: number
  colors: { bg: string; border: string; text: string }
  [key: string]: unknown
}

function ClaimNodeComponent({ data, selected }: NodeProps) {
  const d = data as unknown as ClaimNodeData

  return (
    <div
      className={`rounded-lg px-3 py-2 max-w-[220px] border transition-shadow ${
        selected ? 'ring-2 ring-accent-cyan/50' : ''
      } ${d.isMain ? 'shadow-lg shadow-accent-cyan/10' : ''}`}
      style={{
        background: d.colors.bg,
        borderColor: d.colors.border,
      }}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-600 !w-2 !h-2" />

      <div className="flex items-center gap-1.5 mb-1">
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: d.colors.border }}
        />
        <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: d.colors.text }}>
          {d.phase.replace(/_/g, ' ')}
        </span>
        {d.isMain && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-accent-cyan/20 text-accent-cyan">
            main
          </span>
        )}
      </div>

      <p className="text-xs text-gray-200 leading-snug line-clamp-3">
        {d.label}
      </p>

      <div className="flex items-center gap-2 mt-1.5 text-[10px] text-gray-500">
        {d.confidence != null && (
          <span>conf: {(d.confidence * 100).toFixed(0)}%</span>
        )}
        <span>{d.evidenceCount} evidence</span>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-gray-600 !w-2 !h-2" />
    </div>
  )
}

export default memo(ClaimNodeComponent)
