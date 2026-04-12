/**
 * Persistent Research Plan — three-layer durable todo protocol.
 *
 * Inspired by DeepScientist's plan.md → PLAN.md → CHECKLIST.md system.
 * Ensures research state survives session restarts without relying on
 * conversational context.
 *
 *   plan.md      — Research map: active route, incumbent, all routes tried
 *   PLAN.md      — Current stage objective, success/abandon conditions
 *   CHECKLIST.md — Execution frontier: current step, next, blocked, done
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { ResearchState } from './research-state'

// ── Types ────────────────────────────────────────────────

export interface ResearchRoute {
  id: string
  description: string
  status: 'active' | 'paused' | 'completed' | 'abandoned'
  started_at: string
  updated_at: string
  outcome?: string
}

export interface ResearchMap {
  topic: string
  incumbent: string | null   // description of current best approach
  active_route: string | null // id of active route
  routes: ResearchRoute[]
  last_updated: string
}

export interface StagePlan {
  stage: string
  objective: string
  success_condition: string
  abandon_condition: string
  constraints: string[]
  started_at: string
  last_updated: string
}

export interface ChecklistItem {
  id: string
  description: string
  status: 'pending' | 'in_progress' | 'blocked' | 'completed' | 'skipped'
  blocked_by?: string
  completed_at?: string
}

export interface ExecutionChecklist {
  stage: string
  items: ChecklistItem[]
  last_updated: string
}

// ── Persistence ──────────────────────────────────────────

function planDir(projectDir: string): string {
  return join(projectDir, '.claude-paper')
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
}

// ── Research Map (plan.md) ───────────────────────────────

export function loadResearchMap(projectDir: string): ResearchMap | null {
  const path = join(planDir(projectDir), 'plan.md')
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf-8')
    // Parse frontmatter JSON block
    const match = raw.match(/```json\n([\s\S]*?)\n```/)
    if (!match) return null
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

export function saveResearchMap(projectDir: string, map: ResearchMap): void {
  const dir = planDir(projectDir)
  ensureDir(dir)
  map.last_updated = new Date().toISOString()

  const activeRoute = map.routes.find(r => r.id === map.active_route)
  const completedRoutes = map.routes.filter(r => r.status === 'completed' || r.status === 'abandoned')

  const md = `# Research Map

**Topic:** ${map.topic}
**Incumbent:** ${map.incumbent ?? 'None yet'}
**Active Route:** ${activeRoute ? `${activeRoute.id} — ${activeRoute.description}` : 'None'}
**Last Updated:** ${map.last_updated}

## Routes

${map.routes.map(r => `- **${r.id}** [${r.status}]: ${r.description}${r.outcome ? ` → ${r.outcome}` : ''}`).join('\n')}

${completedRoutes.length > 0 ? `## Completed/Abandoned\n\n${completedRoutes.map(r => `- ${r.id}: ${r.outcome ?? r.status}`).join('\n')}` : ''}

<!-- Machine-readable state -->
\`\`\`json
${JSON.stringify(map, null, 2)}
\`\`\`
`
  writeFileSync(join(dir, 'plan.md'), md, 'utf-8')
}

// ── Stage Plan (PLAN.md) ─────────────────────────────────

export function loadStagePlan(projectDir: string): StagePlan | null {
  const path = join(planDir(projectDir), 'PLAN.md')
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf-8')
    const match = raw.match(/```json\n([\s\S]*?)\n```/)
    if (!match) return null
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

export function saveStagePlan(projectDir: string, plan: StagePlan): void {
  const dir = planDir(projectDir)
  ensureDir(dir)
  plan.last_updated = new Date().toISOString()

  const md = `# Stage Plan: ${plan.stage}

**Objective:** ${plan.objective}

**Success Condition:** ${plan.success_condition}

**Abandon Condition:** ${plan.abandon_condition}

${plan.constraints.length > 0 ? `## Constraints\n\n${plan.constraints.map(c => `- ${c}`).join('\n')}` : ''}

**Started:** ${plan.started_at}
**Updated:** ${plan.last_updated}

\`\`\`json
${JSON.stringify(plan, null, 2)}
\`\`\`
`
  writeFileSync(join(dir, 'PLAN.md'), md, 'utf-8')
}

// ── Execution Checklist (CHECKLIST.md) ───────────────────

export function loadChecklist(projectDir: string): ExecutionChecklist | null {
  const path = join(planDir(projectDir), 'CHECKLIST.md')
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf-8')
    const match = raw.match(/```json\n([\s\S]*?)\n```/)
    if (!match) return null
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

export function saveChecklist(projectDir: string, checklist: ExecutionChecklist): void {
  const dir = planDir(projectDir)
  ensureDir(dir)
  checklist.last_updated = new Date().toISOString()

  const inProgress = checklist.items.filter(i => i.status === 'in_progress')
  const pending = checklist.items.filter(i => i.status === 'pending')
  const blocked = checklist.items.filter(i => i.status === 'blocked')
  const completed = checklist.items.filter(i => i.status === 'completed')
  const skipped = checklist.items.filter(i => i.status === 'skipped')

  const section = (title: string, items: ChecklistItem[], marker: string) =>
    items.length > 0
      ? `### ${title}\n\n${items.map(i => `- ${marker} ${i.description}${i.blocked_by ? ` (blocked by: ${i.blocked_by})` : ''}`).join('\n')}\n`
      : ''

  const md = `# Execution Checklist: ${checklist.stage}

**Updated:** ${checklist.last_updated}

${section('In Progress', inProgress, '🔄')}
${section('Pending', pending, '⬜')}
${section('Blocked', blocked, '🚫')}
${section('Completed', completed, '✅')}
${section('Skipped', skipped, '⏭️')}

\`\`\`json
${JSON.stringify(checklist, null, 2)}
\`\`\`
`
  writeFileSync(join(dir, 'CHECKLIST.md'), md, 'utf-8')
}

// ── Convenience: Update from ResearchState ───────────────

/**
 * Sync the three-layer plan from the current ResearchState.
 * Called by the orchestrator after each cycle to keep durable files up-to-date.
 */
export function syncPlanFromState(
  projectDir: string,
  state: ResearchState,
  currentAction?: { type: string; delegate_to: string; context: string },
): void {
  const now = new Date().toISOString()

  // 1. Research map
  let map = loadResearchMap(projectDir)
  if (!map) {
    map = {
      topic: state.proposal?.title ?? 'Untitled Research',
      incumbent: null,
      active_route: 'main',
      routes: [{
        id: 'main',
        description: state.proposal?.title ?? 'Primary research direction',
        status: 'active',
        started_at: now,
        updated_at: now,
      }],
      last_updated: now,
    }
  }
  // Update incumbent from stability metrics
  if (state.stability.paperReadiness === 'ready' || state.stability.paperReadiness === 'nearly_ready') {
    map.incumbent = state.proposal?.title ?? map.incumbent
  }
  saveResearchMap(projectDir, map)

  // 2. Stage plan — infer stage from trajectory
  const lastAction = state.trajectory[state.trajectory.length - 1]
  const stage = inferStage(state)
  const existingPlan = loadStagePlan(projectDir)
  if (!existingPlan || existingPlan.stage !== stage) {
    saveStagePlan(projectDir, {
      stage,
      objective: stageObjective(stage, state),
      success_condition: stageSuccessCondition(stage),
      abandon_condition: stageAbandonCondition(stage),
      constraints: [],
      started_at: now,
      last_updated: now,
    })
  }

  // 3. Checklist — update current action
  let checklist = loadChecklist(projectDir)
  if (!checklist || checklist.stage !== stage) {
    checklist = {
      stage,
      items: [],
      last_updated: now,
    }
  }
  if (currentAction) {
    // Mark current action as in_progress
    const existing = checklist.items.find(i => i.description === currentAction.context)
    if (!existing) {
      checklist.items.push({
        id: `step-${checklist.items.length + 1}`,
        description: currentAction.context,
        status: 'in_progress',
      })
    }
  }
  // Mark completed actions from last trajectory entry
  if (lastAction && lastAction.outcome) {
    const match = checklist.items.find(
      i => i.status === 'in_progress' && lastAction.description.includes(i.description.slice(0, 30)),
    )
    if (match) {
      match.status = 'completed'
      match.completed_at = now
    }
  }
  saveChecklist(projectDir, checklist)
}

// ── Stage Inference Helpers ──────────────────────────────

function inferStage(state: ResearchState): string {
  const cycle = state.orchestrator_cycle_count
  const readiness = state.stability.paperReadiness
  const hasExperiments = state.artifacts.entries.some(a => a.type === 'experiment_result')
  const hasDraft = state.artifacts.entries.some(a => a.type === 'paper_draft')

  if (hasDraft) return 'writing'
  if (readiness === 'ready' || readiness === 'nearly_ready') return 'finalization'
  if (hasExperiments) return 'experimentation'
  if (cycle > 3) return 'investigation'
  return 'exploration'
}

function stageObjective(stage: string, state: ResearchState): string {
  switch (stage) {
    case 'exploration': return `Establish initial claims and evidence for "${state.proposal?.title}"`
    case 'investigation': return 'Strengthen evidence for admitted claims, address skeptic challenges'
    case 'experimentation': return 'Run experiments to validate hypotheses with empirical evidence'
    case 'finalization': return 'Converge remaining claims, prepare for paper writing'
    case 'writing': return 'Draft and compile the paper from accumulated evidence'
    default: return 'Continue research'
  }
}

function stageSuccessCondition(stage: string): string {
  switch (stage) {
    case 'exploration': return 'At least 3 claims admitted with minimum evidence tier'
    case 'investigation': return 'Core claims at solid evidence tier, no critical bridge gaps'
    case 'experimentation': return 'Key experiments completed with reproducible results'
    case 'finalization': return 'Convergence score > 0.8, all main claims at solid tier'
    case 'writing': return 'Complete paper draft compiled to PDF'
    default: return 'Stage objectives met'
  }
}

function stageAbandonCondition(stage: string): string {
  switch (stage) {
    case 'exploration': return 'No viable claims after 5 cycles'
    case 'investigation': return 'Core hypothesis refuted with strong evidence'
    case 'experimentation': return 'Experiments consistently fail to support claims'
    case 'finalization': return 'New critical gap discovered requiring re-investigation'
    case 'writing': return 'Fundamental flaw discovered during writing'
    default: return 'Budget exhausted or fundamental flaw discovered'
  }
}
