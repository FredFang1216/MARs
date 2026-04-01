interface EmptyStateProps {
  icon?: string
  title: string
  description?: string
  action?: React.ReactNode
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon && (
        <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center mb-3 text-xl text-gray-500">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-medium text-gray-400 mb-1">{title}</h3>
      {description && (
        <p className="text-xs text-gray-600 max-w-xs">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
