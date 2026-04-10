import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  statSync,
} from 'fs'
import { join } from 'path'
import { getCwd } from '@utils/state'
import { nanoid } from 'nanoid'
import type { SessionMode } from './session-state'

const SESSIONS_DIR_NAME = '.claude-paper-research'
const SESSION_META = 'session.json'

/** Markers that indicate a directory contains research data. */
const RESEARCH_MARKERS = ['literature', 'fragments', '.claude-paper', 'discovered-papers.json']

export interface SessionMeta {
  id: string
  topic: string
  created_at: string
  last_active: string
  mode?: SessionMode // 'conversation' | 'researching'; defaults to 'conversation'
}

function sanitizeTopic(topic: string): string {
  let slug = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)

  // Fallback for non-ASCII topics (e.g. Chinese) that produce an empty slug
  if (!slug) {
    slug = `session-${Date.now().toString(36)}-${nanoid(4)}`
  }
  return slug
}

/**
 * Get the current research session directory.
 * Structure: {cwd}/.claude-paper-research/{session-slug}/
 *
 * If a session already exists (only one), returns it.
 * If multiple exist, returns the most recently active one.
 * If none exist, returns the base dir (for backward compat).
 */
export function getSessionDir(topic?: string): string {
  const cwd = getCwd()
  const baseDir = join(cwd, SESSIONS_DIR_NAME)

  // If a topic is provided, create/find a session for it
  if (topic) {
    const slug = sanitizeTopic(topic)
    const sessionDir = join(baseDir, slug)
    mkdirSync(sessionDir, { recursive: true })

    // Write/update session meta
    const metaPath = join(sessionDir, SESSION_META)
    let meta: SessionMeta
    if (existsSync(metaPath)) {
      meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      meta.last_active = new Date().toISOString()
    } else {
      meta = {
        id: slug,
        topic,
        created_at: new Date().toISOString(),
        last_active: new Date().toISOString(),
      }
    }
    writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf-8')
    return sessionDir
  }

  // No topic: find existing session
  if (!existsSync(baseDir)) return baseDir

  try {
    const entries = readdirSync(baseDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => {
        const metaPath = join(baseDir, e.name, SESSION_META)
        if (existsSync(metaPath)) {
          try {
            const meta: SessionMeta = JSON.parse(
              readFileSync(metaPath, 'utf-8'),
            )
            return { dir: join(baseDir, e.name), meta }
          } catch {
            return null
          }
        }
        return null
      })
      .filter(Boolean) as Array<{ dir: string; meta: SessionMeta }>

    if (entries.length === 0) {
      // Backward compat: check if baseDir itself has research files
      if (
        existsSync(join(baseDir, 'literature')) ||
        existsSync(join(baseDir, 'discovered-papers.json'))
      ) {
        return baseDir
      }
      return baseDir
    }

    // Return most recently active session
    entries.sort(
      (a, b) =>
        new Date(b.meta.last_active).getTime() -
        new Date(a.meta.last_active).getTime(),
    )
    return entries[0].dir
  } catch {
    return baseDir
  }
}

/**
 * List all research sessions.
 * Also auto-detects legacy research directories that lack session.json
 * and migrates root-level orphan session files into a proper subdirectory.
 */
/**
 * Resolve a session directory by its ID (which IS the directory name).
 * Unlike getSessionDir(topic), this does NOT re-derive a slug — it uses the
 * ID directly, avoiding truncation mismatches.
 * Updates last_active timestamp if the session exists.
 */
export function getSessionDirById(sessionId: string): string {
  const cwd = getCwd()
  const sessionDir = join(cwd, SESSIONS_DIR_NAME, sessionId)

  // Update last_active if session.json exists
  const metaPath = join(sessionDir, SESSION_META)
  if (existsSync(metaPath)) {
    try {
      const meta: SessionMeta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      meta.last_active = new Date().toISOString()
      writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf-8')
    } catch {
      // Ignore — non-critical
    }
  }

  return sessionDir
}

export function listSessions(): SessionMeta[] {
  const cwd = getCwd()
  const baseDir = join(cwd, SESSIONS_DIR_NAME)
  if (!existsSync(baseDir)) return []

  // Migrate root-level orphan session.json into a subdirectory
  migrateRootOrphan(baseDir)

  try {
    return readdirSync(baseDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => {
        const dirPath = join(baseDir, e.name)
        const metaPath = join(dirPath, SESSION_META)
        if (existsSync(metaPath)) {
          try {
            return JSON.parse(readFileSync(metaPath, 'utf-8')) as SessionMeta
          } catch {
            return null
          }
        }
        // Auto-detect legacy research directory without session.json
        return adoptLegacyDir(dirPath, e.name)
      })
      .filter(Boolean) as SessionMeta[]
  } catch {
    return []
  }
}

/**
 * If a directory has research markers but no session.json,
 * create one so it appears in the session list.
 */
function adoptLegacyDir(dirPath: string, dirName: string): SessionMeta | null {
  const hasResearch = RESEARCH_MARKERS.some(m => existsSync(join(dirPath, m)))
  if (!hasResearch) return null

  const now = new Date().toISOString()
  // Derive a human-readable topic from the directory name
  const topic = dirName.replace(/-/g, ' ')
  const meta: SessionMeta = {
    id: dirName,
    topic,
    created_at: now,
    last_active: now,
    mode: 'researching',
  }

  try {
    // Try to get actual dates from the directory's filesystem timestamps
    const stat = statSync(dirPath)
    meta.created_at = stat.birthtime.toISOString()
    meta.last_active = stat.mtime.toISOString()
  } catch {
    // Ignore — use defaults
  }

  // Persist the generated session.json so this only happens once
  try {
    writeFileSync(
      join(dirPath, SESSION_META),
      JSON.stringify(meta, null, 2) + '\n',
      'utf-8',
    )
  } catch {
    // Read-only filesystem or permission issue — return the meta anyway
  }

  return meta
}

/**
 * Move root-level session.json / session-state.json into a proper subdirectory.
 * This happens when sanitizeTopic produced an empty slug (e.g. non-ASCII topic).
 */
function migrateRootOrphan(baseDir: string): void {
  const rootMeta = join(baseDir, SESSION_META)
  if (!existsSync(rootMeta)) return

  try {
    const meta: SessionMeta = JSON.parse(readFileSync(rootMeta, 'utf-8'))
    // Generate a proper slug for this orphan
    const slug = sanitizeTopic(meta.topic || 'unnamed-session')
    const targetDir = join(baseDir, slug)

    // Don't overwrite an existing session directory — backup the orphan data
    if (existsSync(join(targetDir, SESSION_META))) {
      const ts = Date.now()
      renameSync(rootMeta, `${rootMeta}.bak-${ts}`)
      const rootState = join(baseDir, 'session-state.json')
      if (existsSync(rootState)) {
        renameSync(rootState, `${rootState}.bak-${ts}`)
      }
      return
    }

    mkdirSync(targetDir, { recursive: true })

    // Fix the id field to match the slug
    meta.id = slug
    writeFileSync(
      join(targetDir, SESSION_META),
      JSON.stringify(meta, null, 2) + '\n',
      'utf-8',
    )
    unlinkSync(rootMeta)

    // Also move session-state.json if it exists
    const rootState = join(baseDir, 'session-state.json')
    if (existsSync(rootState)) {
      renameSync(rootState, join(targetDir, 'session-state.json'))
    }
  } catch {
    // Migration failed — leave files in place
  }
}
