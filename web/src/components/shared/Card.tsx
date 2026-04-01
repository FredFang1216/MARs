import { type ReactNode } from 'react'

interface CardProps {
  title?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  glow?: boolean
}

export default function Card({ title, action, children, className = '', glow }: CardProps) {
  return (
    <div
      className={`bg-surface-1 border border-gray-800 rounded-lg p-4 ${
        glow ? 'animate-pulse-glow border-accent-cyan/30' : ''
      } ${className}`}
    >
      {(title || action) && (
        <div className="flex items-center justify-between mb-3">
          {title && (
            <h3 className="text-sm font-semibold text-gray-400">{title}</h3>
          )}
          {action}
        </div>
      )}
      {children}
    </div>
  )
}
