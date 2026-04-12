/**
 * Layered Research Memory — global vs project scope with promotion.
 *
 * Inspired by DeepScientist's memory system with global/quest scope,
 * tagged cards, and promotion mechanism for cross-project reuse.
 *
 * Global memory:  ~/.claude-paper/memory/
 * Project memory:  {projectDir}/.claude-paper/memory/
 */

import {
  writeFileSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  copyFileSync,
} from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'

// ── Types ────────────────────────────────────────────────

export type MemoryScope = 'global' | 'project'

export type MemoryKind =
  | 'papers'      // paper insights and findings
  | 'ideas'       // hypotheses and research ideas
  | 'decisions'   // why we chose this route
  | 'episodes'    // debugging sessions, failed attempts, lessons
  | 'knowledge'   // domain facts, techniques learned
  | 'templates'   // reusable patterns and boilerplate

export interface MemoryCard {
  id: string
  kind: MemoryKind
  title: string
  body: string
  tags: string[]
  scope: MemoryScope
  source_project?: string  // set when promoted from project → global
  created_at: string
  updated_at: string
}

// ── Directory Resolution ─────────────────────────────────

function globalMemoryDir(): string {
  return join(homedir(), '.claude-paper', 'memory')
}

function projectMemoryDir(projectDir: string): string {
  return join(projectDir, '.claude-paper', 'memory')
}

function memoryDir(scope: MemoryScope, projectDir?: string): string {
  if (scope === 'global') return globalMemoryDir()
  if (!projectDir) throw new Error('projectDir required for project scope')
  return projectMemoryDir(projectDir)
}

// ── CRUD ─────────────────────────────────────────────────

function cardPath(dir: string, id: string): string {
  return join(dir, `${id}.json`)
}

/**
 * Write a memory card.
 */
export function writeCard(
  scope: MemoryScope,
  card: Omit<MemoryCard, 'scope'>,
  projectDir?: string,
): MemoryCard {
  const dir = memoryDir(scope, projectDir)
  mkdirSync(dir, { recursive: true })

  const full: MemoryCard = { ...card, scope }
  writeFileSync(cardPath(dir, card.id), JSON.stringify(full, null, 2), 'utf-8')
  return full
}

/**
 * Read a memory card by ID. Searches project first, then global.
 */
export function readCard(id: string, projectDir?: string): MemoryCard | null {
  // Project scope first
  if (projectDir) {
    const projPath = cardPath(projectMemoryDir(projectDir), id)
    if (existsSync(projPath)) {
      try { return JSON.parse(readFileSync(projPath, 'utf-8')) } catch { /* skip */ }
    }
  }
  // Global scope
  const globalPath = cardPath(globalMemoryDir(), id)
  if (existsSync(globalPath)) {
    try { return JSON.parse(readFileSync(globalPath, 'utf-8')) } catch { /* skip */ }
  }
  return null
}

/**
 * Delete a memory card.
 */
export function deleteCard(id: string, scope: MemoryScope, projectDir?: string): boolean {
  const dir = memoryDir(scope, projectDir)
  const path = cardPath(dir, id)
  if (existsSync(path)) {
    unlinkSync(path)
    return true
  }
  return false
}

/**
 * List cards, optionally filtered by kind and tags.
 */
export function listCards(
  scope: MemoryScope | 'both',
  options?: {
    kind?: MemoryKind
    tags?: string[]
    projectDir?: string
    limit?: number
  },
): MemoryCard[] {
  const results: MemoryCard[] = []

  const dirs: string[] = []
  if (scope === 'project' || scope === 'both') {
    if (options?.projectDir) dirs.push(projectMemoryDir(options.projectDir))
  }
  if (scope === 'global' || scope === 'both') {
    dirs.push(globalMemoryDir())
  }

  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    const files = readdirSync(dir).filter(f => f.endsWith('.json'))
    for (const file of files) {
      try {
        const card: MemoryCard = JSON.parse(readFileSync(join(dir, file), 'utf-8'))
        // Apply filters
        if (options?.kind && card.kind !== options.kind) continue
        if (options?.tags && options.tags.length > 0) {
          const hasAllTags = options.tags.every(t => card.tags.includes(t))
          if (!hasAllTags) continue
        }
        results.push(card)
      } catch { /* skip corrupted */ }
    }
  }

  // Sort by updated_at descending
  results.sort((a, b) => b.updated_at.localeCompare(a.updated_at))

  return options?.limit ? results.slice(0, options.limit) : results
}

/**
 * Search cards by text query (matches title and body).
 */
export function searchCards(
  query: string,
  scope: MemoryScope | 'both',
  projectDir?: string,
): MemoryCard[] {
  const all = listCards(scope, { projectDir })
  const lower = query.toLowerCase()
  return all.filter(
    c => c.title.toLowerCase().includes(lower) || c.body.toLowerCase().includes(lower),
  )
}

// ── Promotion ────────────────────────────────────────────

/**
 * Promote a project-scoped card to global scope.
 * The original project card is preserved; a copy is created in global memory
 * with source_project set.
 */
export function promoteToGlobal(cardId: string, projectDir: string): MemoryCard | null {
  const projDir = projectMemoryDir(projectDir)
  const projPath = cardPath(projDir, cardId)
  if (!existsSync(projPath)) return null

  try {
    const card: MemoryCard = JSON.parse(readFileSync(projPath, 'utf-8'))

    // Create in global scope
    const globalCard: MemoryCard = {
      ...card,
      scope: 'global',
      source_project: projectDir,
      updated_at: new Date().toISOString(),
    }

    const gDir = globalMemoryDir()
    mkdirSync(gDir, { recursive: true })
    writeFileSync(cardPath(gDir, cardId), JSON.stringify(globalCard, null, 2), 'utf-8')

    return globalCard
  } catch {
    return null
  }
}

// ── Factory ──────────────────────────────────────────────

/**
 * Create a new memory card with auto-generated ID.
 */
export function createCard(params: {
  kind: MemoryKind
  title: string
  body: string
  tags?: string[]
  scope: MemoryScope
  projectDir?: string
}): MemoryCard {
  const now = new Date().toISOString()
  const id = `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

  return writeCard(params.scope, {
    id,
    kind: params.kind,
    title: params.title,
    body: params.body,
    tags: params.tags ?? [],
    created_at: now,
    updated_at: now,
  }, params.projectDir)
}

// ── Context Builder ──────────────────────────────────────

/**
 * Build a memory context string for LLM prompt injection.
 * Includes recent project + global cards.
 */
export function buildMemoryContext(projectDir: string, maxCards = 10): string {
  const cards = listCards('both', { projectDir, limit: maxCards })
  if (cards.length === 0) return ''

  const lines: string[] = ['## Research Memory']

  for (const card of cards) {
    const scope = card.scope === 'global' ? '🌐' : '📁'
    const tags = card.tags.length > 0 ? ` [${card.tags.join(', ')}]` : ''
    lines.push(`\n### ${scope} ${card.title}${tags}`)
    lines.push(card.body.length > 300 ? card.body.slice(0, 300) + '...' : card.body)
  }

  return lines.join('\n')
}
