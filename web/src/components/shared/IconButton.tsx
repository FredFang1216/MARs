interface IconButtonProps {
  onClick: () => void
  title?: string
  className?: string
  disabled?: boolean
  children: React.ReactNode
}

export default function IconButton({ onClick, title, className = '', disabled, children }: IconButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-surface-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  )
}
