export interface Proposal {
  id: string
  title: string
  abstract: string
  innovation: string[] // bullet points of novel contributions
  methodology: string // high-level approach
  feasibility: {
    data_required: string
    compute_estimate: string
    timeline_weeks: number
    score: number // 0-1
  }
  risk: {
    level: 'low' | 'medium' | 'high'
    description: string
  }
  novelty_score: number // 0-1
  impact_score: number // 0-1
  references: string[] // key papers that support this
  created_at: string
}

const VALID_RISK_LEVELS = ['low', 'medium', 'high'] as const
const MAX_PROPOSAL_JSON_SIZE = 100_000 // 100KB

/**
 * Validate and normalize raw input into a Proposal.
 * Single source of truth for proposal validation across CLI, web backend, and web frontend.
 */
export function validateAndNormalizeProposal(
  raw: unknown,
): { ok: true; proposal: Proposal } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Proposal must be an object' }
  }
  const p = raw as Record<string, unknown>

  // Required string fields
  if (!p.title || typeof p.title !== 'string') return { ok: false, error: 'Missing or invalid "title" (string)' }
  if (!p.abstract || typeof p.abstract !== 'string') return { ok: false, error: 'Missing or invalid "abstract" (string)' }
  if (!p.methodology || typeof p.methodology !== 'string') return { ok: false, error: 'Missing or invalid "methodology" (string)' }

  // Innovation: non-empty array of strings
  if (!Array.isArray(p.innovation) || p.innovation.length === 0) {
    return { ok: false, error: 'Missing or empty "innovation" array' }
  }
  if (!p.innovation.every((i: unknown) => typeof i === 'string')) {
    return { ok: false, error: '"innovation" array must contain only strings' }
  }

  // Feasibility
  if (!p.feasibility || typeof p.feasibility !== 'object') {
    return { ok: false, error: 'Missing "feasibility" object' }
  }

  // Risk
  if (!p.risk || typeof p.risk !== 'object') {
    return { ok: false, error: 'Missing "risk" object' }
  }
  const riskObj = p.risk as Record<string, unknown>
  if (riskObj.level && !VALID_RISK_LEVELS.includes(riskObj.level as any)) {
    return { ok: false, error: `risk.level must be one of: ${VALID_RISK_LEVELS.join(', ')}` }
  }

  const feasObj = p.feasibility as Record<string, unknown>

  const proposal: Proposal = {
    id: typeof p.id === 'string' && p.id ? p.id : `imported-${Date.now()}`,
    title: p.title as string,
    abstract: p.abstract as string,
    innovation: p.innovation as string[],
    methodology: p.methodology as string,
    feasibility: {
      data_required: typeof feasObj.data_required === 'string' ? feasObj.data_required : 'Not specified',
      compute_estimate: typeof feasObj.compute_estimate === 'string' ? feasObj.compute_estimate : 'Not specified',
      timeline_weeks: typeof feasObj.timeline_weeks === 'number' ? feasObj.timeline_weeks : 4,
      score: Math.max(0, Math.min(1, Number(feasObj.score) || 0.5)),
    },
    risk: {
      level: (VALID_RISK_LEVELS.includes(riskObj.level as any) ? riskObj.level : 'medium') as 'low' | 'medium' | 'high',
      description: typeof riskObj.description === 'string' ? riskObj.description : 'Not specified',
    },
    novelty_score: Math.max(0, Math.min(1, Number(p.novelty_score) || 0.5)),
    impact_score: Math.max(0, Math.min(1, Number(p.impact_score) || 0.5)),
    references: Array.isArray(p.references) ? p.references.filter((r: unknown) => typeof r === 'string') : [],
    created_at: typeof p.created_at === 'string' ? p.created_at : new Date().toISOString(),
  }

  return { ok: true, proposal }
}

/**
 * Parse a JSON string into a validated Proposal.
 * Convenience wrapper for CLI and UI inputs.
 */
export function parseProposalJson(
  text: string,
): { ok: true; proposal: Proposal } | { ok: false; error: string } {
  if (text.length > MAX_PROPOSAL_JSON_SIZE) {
    return { ok: false, error: `Proposal JSON too large (max ${MAX_PROPOSAL_JSON_SIZE} bytes)` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Invalid JSON' }
  }
  return validateAndNormalizeProposal(parsed)
}

export interface ProposalGenerationOptions {
  count?: number // default 3
  focus?: string // optional direction constraint
  include_feasibility?: boolean
  include_risk?: boolean
  research_dir?: string // path to .claude-paper-research dir
}
