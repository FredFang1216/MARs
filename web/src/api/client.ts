/**
 * REST API client for Claude Paper web frontend.
 */

const BASE = ''  // Same origin; Vite proxies /api to backend in dev

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as any).error || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as any).error || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as any).error || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as any).error || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

// ── Session endpoints ─────────────────────────────────

export interface SessionMeta {
  id: string
  topic: string
  created_at: string
  last_active: string
}

export function fetchSessions(): Promise<SessionMeta[]> {
  return get('/api/sessions')
}

export function fetchSessionState(sessionId: string): Promise<any> {
  return get(`/api/sessions/${sessionId}/state`)
}

export function fetchClaimGraph(sessionId: string): Promise<any> {
  return get(`/api/sessions/${sessionId}/claim-graph`)
}

export function fetchEvidence(sessionId: string): Promise<any> {
  return get(`/api/sessions/${sessionId}/evidence`)
}

export function fetchTrajectory(sessionId: string): Promise<any[]> {
  return get(`/api/sessions/${sessionId}/trajectory`)
}

export function fetchExperiments(sessionId: string): Promise<any[]> {
  return get(`/api/sessions/${sessionId}/experiments`)
}

export function fetchBudget(sessionId: string): Promise<any> {
  return get(`/api/sessions/${sessionId}/budget`)
}

export function fetchStability(sessionId: string): Promise<any> {
  return get(`/api/sessions/${sessionId}/stability`)
}

// ── Session State (conversation mode) ────────────────

export function fetchSessionConversationState(sessionId: string): Promise<any> {
  return get(`/api/sessions/${sessionId}/session-state`)
}

export function fetchMessages(sessionId: string): Promise<any[]> {
  return get(`/api/sessions/${sessionId}/messages`)
}

// ── Knowledge Pack endpoints ─────────────────────────

export function fetchAvailableKnowledgePacks(): Promise<any[]> {
  return get('/api/knowledge-packs')
}

export function fetchLiteratureArtifacts(sessionId: string): Promise<any> {
  return get(`/api/sessions/${sessionId}/literature-artifacts`)
}

export function addPaper(sessionId: string, paper: Record<string, any>): Promise<any> {
  return post(`/api/sessions/${sessionId}/literature/papers`, paper)
}

export function removePaper(sessionId: string, sourceId: string): Promise<any> {
  return del(`/api/sessions/${sessionId}/literature/papers/${encodeURIComponent(sourceId)}`)
}

export function regenerateLiteratureArtifacts(sessionId: string): Promise<any> {
  return post(`/api/sessions/${sessionId}/literature/regenerate`)
}

export function fetchSessionKnowledgePack(sessionId: string): Promise<{
  loaded: boolean
  packId?: string
  manifest?: any
  error?: string
}> {
  return get(`/api/sessions/${sessionId}/knowledge-pack`)
}

// ── Experiment endpoints ─────────────────────────────

export function fetchExperimentDetail(sessionId: string, experimentId: string): Promise<any> {
  return get(`/api/sessions/${sessionId}/experiments/${experimentId}`)
}

export function fetchExperimentNote(sessionId: string, experimentId: string): Promise<{ content: string }> {
  return get(`/api/sessions/${sessionId}/experiments/${experimentId}/note`)
}

export function fetchExperimentSummaries(sessionId: string): Promise<any[]> {
  return get(`/api/sessions/${sessionId}/experiments/summaries`)
}

export function fetchExperimentJournal(sessionId: string): Promise<{ content: string }> {
  return get(`/api/sessions/${sessionId}/experiments/journal`)
}

export function fetchMetricComparison(sessionId: string, ids: string[], metricPath: string): Promise<any[]> {
  return get(`/api/sessions/${sessionId}/experiments/compare?ids=${ids.join(',')}&metric=${encodeURIComponent(metricPath)}`)
}

export function getExperimentFigureUrl(sessionId: string, experimentId: string, filename: string): string {
  return `/api/sessions/${sessionId}/experiments/${experimentId}/figures/${encodeURIComponent(filename)}`
}

// ── Config endpoints ──────────────────────────────────

export function fetchConfig(): Promise<Record<string, any>> {
  return get('/api/config')
}

export function updateConfig(config: Record<string, any>): Promise<any> {
  return put('/api/config', config)
}

// ── Health ────────────────────────────────────────────

export function fetchHealth(): Promise<{ status: string; cwd: string }> {
  return get('/api/health')
}
