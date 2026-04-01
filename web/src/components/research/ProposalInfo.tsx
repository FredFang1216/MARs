import { useState } from 'react'
import Card from '../shared/Card'
import Badge from '../shared/Badge'
import ProgressBar from '../shared/ProgressBar'

interface Props {
  proposal: {
    title: string
    abstract: string
    innovation?: string[]
    methodology?: string
    novelty_score?: number
    impact_score?: number
    risk?: { level: string; description: string }
    feasibility?: { timeline_weeks: number; score: number; data_required?: string; compute_estimate?: string }
    references?: string[]
  }
  paperType?: string
  cycle?: number
}

const RISK_VARIANT: Record<string, 'green' | 'yellow' | 'red'> = {
  low: 'green',
  medium: 'yellow',
  high: 'red',
}

export default function ProposalInfo({ proposal, paperType, cycle }: Props) {
  const [expanded, setExpanded] = useState(false)

  return (
    <Card title="Research Proposal">
      <h4 className="text-base font-semibold text-white mb-2 leading-snug">
        {proposal.title}
      </h4>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {paperType && <Badge variant="cyan">{paperType}</Badge>}
        {proposal.risk && (
          <Badge variant={RISK_VARIANT[proposal.risk.level] ?? 'gray'} dot>
            {proposal.risk.level} risk
          </Badge>
        )}
        {cycle != null && (
          <Badge variant="gray">Cycle {cycle}</Badge>
        )}
        {proposal.feasibility?.timeline_weeks && (
          <Badge variant="gray">{proposal.feasibility.timeline_weeks}w timeline</Badge>
        )}
      </div>

      {/* Abstract */}
      <p className={`text-sm text-gray-400 leading-relaxed mb-3 ${expanded ? '' : 'line-clamp-4'}`}>
        {proposal.abstract}
      </p>
      {proposal.abstract.length > 200 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-accent-cyan hover:text-accent-cyan/80 mb-3 transition-colors"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}

      {/* Innovation points */}
      {proposal.innovation && proposal.innovation.length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-medium text-gray-500 mb-1.5">Key Innovations</div>
          <div className="space-y-1">
            {proposal.innovation.map((item, i) => (
              <div key={i} className="flex gap-2 text-sm">
                <span className="text-accent-cyan mt-0.5 flex-shrink-0">&#x2022;</span>
                <span className="text-gray-300">{item}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Methodology */}
      {proposal.methodology && (
        <div className="mb-3">
          <div className="text-xs font-medium text-gray-500 mb-1">Methodology</div>
          <p className="text-sm text-gray-400 leading-relaxed">{proposal.methodology}</p>
        </div>
      )}

      {/* Scores */}
      {(proposal.novelty_score != null || proposal.impact_score != null || proposal.feasibility?.score != null) && (
        <div className="space-y-2 pt-3 border-t border-gray-800">
          {proposal.novelty_score != null && (
            <ProgressBar
              value={proposal.novelty_score * 10}
              color="purple"
              size="sm"
              label="Novelty"
              sublabel={`${proposal.novelty_score}/10`}
            />
          )}
          {proposal.impact_score != null && (
            <ProgressBar
              value={proposal.impact_score * 10}
              color="cyan"
              size="sm"
              label="Impact"
              sublabel={`${proposal.impact_score}/10`}
            />
          )}
          {proposal.feasibility?.score != null && (
            <ProgressBar
              value={proposal.feasibility.score * 10}
              color="green"
              size="sm"
              label="Feasibility"
              sublabel={`${proposal.feasibility.score}/10`}
            />
          )}
        </div>
      )}

      {/* Risk description */}
      {proposal.risk?.description && (
        <div className="mt-3 pt-3 border-t border-gray-800">
          <div className="text-xs font-medium text-gray-500 mb-1">Risk Assessment</div>
          <p className="text-xs text-gray-400 leading-relaxed">{proposal.risk.description}</p>
        </div>
      )}

      {/* Feasibility details */}
      {(proposal.feasibility?.data_required || proposal.feasibility?.compute_estimate) && (
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
          {proposal.feasibility.data_required && (
            <div className="bg-surface-2 rounded px-2.5 py-2">
              <div className="text-gray-600 mb-0.5">Data Required</div>
              <div className="text-gray-300">{proposal.feasibility.data_required}</div>
            </div>
          )}
          {proposal.feasibility.compute_estimate && (
            <div className="bg-surface-2 rounded px-2.5 py-2">
              <div className="text-gray-600 mb-0.5">Compute</div>
              <div className="text-gray-300">{proposal.feasibility.compute_estimate}</div>
            </div>
          )}
        </div>
      )}

      {/* References count */}
      {proposal.references && proposal.references.length > 0 && (
        <div className="mt-2 text-xs text-gray-600">
          {proposal.references.length} references
        </div>
      )}
    </Card>
  )
}
