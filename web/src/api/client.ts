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

// ── Templates ────────────────────────────────────────

export interface TemplateEntry {
  id: string
  name: string
  aliases: string[]
  venue_type: string
  field: string
  path: string
}

export function fetchTemplates(): Promise<TemplateEntry[]> {
  return get('/api/templates')
}

export function fetchTemplate(templateId: string): Promise<{
  manifest: Record<string, any>
  constraints: Record<string, any>
}> {
  return get(`/api/templates/${encodeURIComponent(templateId)}`)
}

// ── System Check ─────────────────────────────────────

export interface SystemCapabilities {
  gpu: boolean
  gpu_name?: string
  vram_gb?: number
  python: boolean
  python_version?: string
  conda: boolean
  docker: boolean
  latex: boolean
  r: boolean
}

export function fetchSystemCheck(): Promise<SystemCapabilities> {
  return get('/api/system-check')
}

// ── Unified Status ───────────────────────────────────

export interface UnifiedStatus {
  topic: string
  paper_type: string
  cycle: number
  claims: {
    total: number
    admitted: number
    proposed: number
    investigating: number
    rejected: number
    reformulated: number
  }
  convergence: number
  paper_readiness: string
  evidence: {
    total: number
    grounded: number
    derived: number
  }
  budget: {
    total_usd: number
    remaining_usd: number
    spent_usd: number
  }
  proofs: number
  artifacts: number
  has_pdf: boolean
  experiment_feedback: {
    total_evaluations: number
    stagnant_claims: number
  } | null
}

export function fetchUnifiedStatus(sessionId: string): Promise<UnifiedStatus> {
  return get(`/api/sessions/${sessionId}/status`)
}

// ── Fragments ────────────────────────────────────────

export function fetchFragments(sessionId: string): Promise<any[]> {
  return get(`/api/sessions/${sessionId}/fragments`)
}

export function fetchFragment(sessionId: string, fragmentId: string): Promise<any> {
  return get(`/api/sessions/${sessionId}/fragments/${encodeURIComponent(fragmentId)}`)
}

// ── Experiment Promote ───────────────────────────────

export function promoteExperiment(sessionId: string, probeId: string): Promise<any> {
  return post(`/api/sessions/${sessionId}/experiments/${encodeURIComponent(probeId)}/promote`)
}

// ── Research Plan & Decision Artifacts ───────────────

export function fetchResearchPlan(sessionId: string): Promise<any> {
  return get(`/api/sessions/${sessionId}/research-plan`)
}

export function fetchDecisions(sessionId: string, count = 10): Promise<any[]> {
  return get(`/api/sessions/${sessionId}/decisions?count=${count}`)
}

export function fetchMethodScoreboard(sessionId: string): Promise<any> {
  return get(`/api/sessions/${sessionId}/method-scoreboard`)
}

export function fetchArtifacts(sessionId: string): Promise<any> {
  return get(`/api/sessions/${sessionId}/artifacts`)
}

// ── Paper PDF ────────────────────────────────────────

export function getPaperPdfUrl(sessionId: string): string {
  return `/api/sessions/${sessionId}/paper/pdf`
}

// ── Health ────────────────────────────────────────────

export function fetchHealth(): Promise<{ status: string; cwd: string }> {
  return get('/api/health')
}
