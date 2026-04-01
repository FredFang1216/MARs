const VARIANTS: Record<string, string> = {
  green: 'bg-accent-green/15 text-accent-green border-accent-green/30',
  cyan: 'bg-accent-cyan/15 text-accent-cyan border-accent-cyan/30',
  yellow: 'bg-accent-yellow/15 text-accent-yellow border-accent-yellow/30',
  red: 'bg-accent-red/15 text-accent-red border-accent-red/30',
  purple: 'bg-accent-purple/15 text-accent-purple border-accent-purple/30',
  gray: 'bg-gray-700/50 text-gray-400 border-gray-600/30',
}

interface BadgeProps {
  variant?: keyof typeof VARIANTS
  children: React.ReactNode
  dot?: boolean
  className?: string
}

export default function Badge({ variant = 'gray', children, dot, className = '' }: BadgeProps) {
  const colors = VARIANTS[variant] ?? VARIANTS.gray
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full border ${colors} ${className}`}
    >
      {dot && (
        <span className="w-1.5 h-1.5 rounded-full bg-current" />
      )}
      {children}
    </span>
  )
}
