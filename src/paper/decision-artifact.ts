/**
 * Decision Artifacts — durable records of orchestrator routing decisions.
 *
 * Inspired by DeepScientist's decision skill. Every time the orchestrator
 * makes a routing decision (which agent to run, which claim to target),
 * it's recorded as a structured artifact on disk for audit trail.
 *
 * Stored in: {projectDir}/.claude-paper/decisions/{timestamp}-{id}.json
 */

import { writeFileSync, readFileSync, readdirSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

// ── Types ────────────────────────────────────────────────

export type DecisionVerdict = 'good' | 'bad' | 'neutral' | 'blocked'

export type DecisionAction =
  | 'continue'
  | 'launch_experiment'
  | 'investigate_claim'
  | 'run_literature_search'
  | 'write_section'
  | 'iterate'
  | 'branch'
  | 'stop'
  | 'request_user_input'
  | 'other'

export interface DecisionArtifact {
  id: string
  timestamp: string
  cycle: number

  /** Verdict on the current state. */
  verdict: DecisionVerdict

  /** Action chosen. */
  action: DecisionAction

  /** Agent delegated to. */
  delegate_to: string

  /** Context / task description given to the agent. */
  context: string

  /** Evidence-backed reasoning for this decision. */
  reason: string

  /** File paths or artifact IDs that back this decision. */
  evidence_paths: string[]

  /** What to do if this action fails. */
  fallback: string

  /** Claims targeted by this action. */
  target_claims: string[]

  /** Stability metrics at decision time. */
  stability_snapshot: {
    convergenceScore: number
    admittedClaims: number
    proposedClaims: number
    paperReadiness: string
  }

  /** Budget state at decision time. */
  budget_snapshot: {
    spent_usd: number
    remaining_usd: number
  }
}

// ── Persistence ──────────────────────────────────────────

function decisionsDir(projectDir: string): string {
  return join(projectDir, '.claude-paper', 'decisions')
}

/**
 * Record a decision artifact to disk.
 */
export function recordDecision(projectDir: string, decision: DecisionArtifact): string {
  const dir = decisionsDir(projectDir)
  mkdirSync(dir, { recursive: true })

  const filename = `${decision.timestamp.replace(/[:.]/g, '-')}-${decision.id.slice(0, 8)}.json`
  const path = join(dir, filename)
  writeFileSync(path, JSON.stringify(decision, null, 2), 'utf-8')

  return path
}

/**
 * Load all decision artifacts for a project, sorted by timestamp.
 */
export function loadDecisions(projectDir: string): DecisionArtifact[] {
  const dir = decisionsDir(projectDir)
  if (!existsSync(dir)) return []

  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort()
  const decisions: DecisionArtifact[] = []

  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), 'utf-8')
      decisions.push(JSON.parse(raw))
    } catch {
      // Skip corrupted files
    }
  }

  return decisions
}

/**
 * Load the most recent N decisions.
 */
export function loadRecentDecisions(projectDir: string, count = 5): DecisionArtifact[] {
  const all = loadDecisions(projectDir)
  return all.slice(-count)
}

/**
 * Build a decision summary for LLM context injection.
 */
export function buildDecisionContext(projectDir: string, count = 3): string {
  const recent = loadRecentDecisions(projectDir, count)
  if (recent.length === 0) return ''

  const lines = recent.map(d =>
    `- Cycle ${d.cycle} [${d.verdict}]: ${d.action} → ${d.delegate_to} | ${d.reason.slice(0, 100)}`
  )

  return `## Recent Decisions\n\n${lines.join('\n')}`
}

// ── Factory ──────────────────────────────────────────────

/**
 * Create a DecisionArtifact from orchestrator state.
 */
export function createDecisionArtifact(params: {
  cycle: number
  action: {
    type: string
    delegate_to: string
    context: string
    if_this_fails: string
    targets_claim?: string
    related_claims?: string[]
  }
  reasoning: string
  state: {
    stability: { convergenceScore: number; admittedClaimCount: number; proposedClaimCount: number; paperReadiness: string }
    budget: { spent_usd: number; remaining_usd: number }
  }
}): DecisionArtifact {
  const { cycle, action, reasoning, state } = params

  // Infer verdict from stability
  const verdict: DecisionVerdict =
    state.stability.paperReadiness === 'ready' ? 'good'
    : state.stability.paperReadiness === 'nearly_ready' ? 'good'
    : state.stability.convergenceScore > 0.5 ? 'neutral'
    : 'bad'

  // Infer action type
  const actionType: DecisionAction =
    action.type.includes('experiment') ? 'launch_experiment'
    : action.type.includes('search') || action.type.includes('literature') ? 'run_literature_search'
    : action.type.includes('write') ? 'write_section'
    : action.type.includes('investigate') ? 'investigate_claim'
    : 'continue'

  return {
    id: `dec-${cycle}-${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
    cycle,
    verdict,
    action: actionType,
    delegate_to: action.delegate_to,
    context: action.context,
    reason: reasoning,
    evidence_paths: [],
    fallback: action.if_this_fails,
    target_claims: [
      ...(action.targets_claim ? [action.targets_claim] : []),
      ...(action.related_claims ?? []),
    ],
    stability_snapshot: {
      convergenceScore: state.stability.convergenceScore,
      admittedClaims: state.stability.admittedClaimCount,
      proposedClaims: state.stability.proposedClaimCount,
      paperReadiness: state.stability.paperReadiness,
    },
    budget_snapshot: {
      spent_usd: state.budget.spent_usd,
      remaining_usd: state.budget.remaining_usd,
    },
  }
}
