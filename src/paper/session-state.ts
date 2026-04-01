/**
 * Lightweight session state — manages chat messages, collected papers,
 * and capability tracking. Exists alongside (but independent of) ResearchState.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'
import { nanoid } from 'nanoid'

// ── Types ───────────────────────────────────────────────

export type SessionMode = 'conversation' | 'researching'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  metadata?: {
    model?: string
    tokens_used?: number
    cost_usd?: number
    tool_calls?: { name: string; summary: string }[]
  }
}

export interface CollectedPaper {
  paper_id: string
  title: string
  authors: string[]
  abstract: string
  url: string
  source: 'arxiv' | 'semantic_scholar' | 'manual'
  added_at: string
}

export interface SessionState {
  version: 1
  mode: SessionMode
  messages: ChatMessage[]
  collected_papers: CollectedPaper[]
  knowledge_pack_id: string | null
  experiment_ids: string[]
  research_state_initialized: boolean
}

// ── Constants ───────────────────────────────────────────

const SESSION_STATE_FILE = 'session-state.json'

// ── Factory ─────────────────────────────────────────────

export function createEmptySessionState(): SessionState {
  return {
    version: 1,
    mode: 'conversation',
    messages: [],
    collected_papers: [],
    knowledge_pack_id: null,
    experiment_ids: [],
    research_state_initialized: false,
  }
}

// ── Persistence ─────────────────────────────────────────

export function loadSessionState(sessionDir: string): SessionState | null {
  const filePath = join(sessionDir, SESSION_STATE_FILE)
  if (!existsSync(filePath)) return null
  try {
    const raw = readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as SessionState
  } catch {
    return null
  }
}

/**
 * Atomic save: write to temp file then rename to prevent corruption.
 */
export function saveSessionState(sessionDir: string, state: SessionState): void {
  mkdirSync(sessionDir, { recursive: true })
  const filePath = join(sessionDir, SESSION_STATE_FILE)
  const tmpPath = filePath + '.tmp.' + nanoid(6)
  writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n', 'utf-8')
  renameSync(tmpPath, filePath)
}

// ── Helpers ─────────────────────────────────────────────

export function createChatMessage(
  role: 'user' | 'assistant' | 'system',
  content: string,
  metadata?: ChatMessage['metadata'],
): ChatMessage {
  return {
    id: 'msg_' + nanoid(12),
    role,
    content,
    timestamp: new Date().toISOString(),
    metadata,
  }
}

export function addMessage(state: SessionState, msg: ChatMessage): SessionState {
  return {
    ...state,
    messages: [...state.messages, msg],
  }
}

export function addCollectedPaper(state: SessionState, paper: CollectedPaper): SessionState {
  // Deduplicate by paper_id
  if (state.collected_papers.some(p => p.paper_id === paper.paper_id)) {
    return state
  }
  return {
    ...state,
    collected_papers: [...state.collected_papers, paper],
  }
}
