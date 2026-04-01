interface ProgressBarProps {
  value: number
  max?: number
  color?: 'cyan' | 'green' | 'yellow' | 'red' | 'purple'
  size?: 'sm' | 'md'
  label?: string
  sublabel?: string
}

const COLOR_MAP = {
  cyan: 'bg-accent-cyan',
  green: 'bg-accent-green',
  yellow: 'bg-accent-yellow',
  red: 'bg-accent-red',
  purple: 'bg-accent-purple',
}

export default function ProgressBar({
  value,
  max = 100,
  color = 'cyan',
  size = 'sm',
  label,
  sublabel,
}: ProgressBarProps) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0

  return (
    <div>
      {(label || sublabel) && (
        <div className="flex justify-between mb-1 text-xs">
          {label && <span className="text-gray-400">{label}</span>}
          {sublabel && <span className="text-gray-500">{sublabel}</span>}
        </div>
      )}
      <div className={`w-full bg-surface-3 rounded-full overflow-hidden ${size === 'sm' ? 'h-1.5' : 'h-2.5'}`}>
        <div
          className={`h-full rounded-full transition-all duration-500 ${COLOR_MAP[color]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
