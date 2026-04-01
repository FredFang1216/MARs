import type { Proposal } from '../../stores/creationStore'

const RISK_COLORS: Record<string, string> = {
  low: 'bg-green-900/30 text-green-400 border-green-800',
  medium: 'bg-yellow-900/30 text-yellow-400 border-yellow-800',
  high: 'bg-red-900/30 text-red-400 border-red-800',
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 w-20">{label}</span>
      <div className="flex-1 h-1.5 bg-surface-2 rounded-full overflow-hidden">
        <div
          className="h-full bg-accent-cyan rounded-full transition-all"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className="text-xs text-gray-400 w-8 text-right">
        {Math.round(value * 100)}%
      </span>
    </div>
  )
}

interface Props {
  proposal: Proposal
  selected: boolean
  onClick: () => void
}

export default function ProposalCard({ proposal, selected, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-surface-1 border rounded-lg p-4 transition-colors ${
        selected
          ? 'border-accent-cyan shadow-lg shadow-accent-cyan/10'
          : 'border-gray-800 hover:border-gray-600'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="font-semibold text-white text-sm leading-tight">
          {proposal.title}
        </h4>
        <span
          className={`text-xs px-2 py-0.5 rounded border shrink-0 ${
            RISK_COLORS[proposal.risk.level] ?? 'bg-gray-800 text-gray-400 border-gray-700'
          }`}
        >
          {proposal.risk.level} risk
        </span>
      </div>

      <p className="text-xs text-gray-400 mb-3 line-clamp-3">
        {proposal.abstract}
      </p>

      {proposal.innovation.length > 0 && (
        <div className="mb-3">
          <span className="text-xs text-gray-500">Key innovations:</span>
          <ul className="mt-1 space-y-0.5">
            {proposal.innovation.slice(0, 3).map((item, i) => (
              <li key={i} className="text-xs text-gray-300 pl-3 relative">
                <span className="absolute left-0 text-accent-cyan">-</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-1.5">
        <ScoreBar label="Novelty" value={proposal.novelty_score} />
        <ScoreBar label="Impact" value={proposal.impact_score} />
        <ScoreBar label="Feasibility" value={proposal.feasibility.score} />
      </div>

      <div className="flex items-center gap-3 mt-3 text-xs text-gray-500">
        <span>{proposal.feasibility.timeline_weeks}w timeline</span>
        <span>{proposal.references.length} refs</span>
      </div>
    </button>
  )
}
