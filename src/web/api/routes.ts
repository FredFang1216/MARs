import { existsSync, readFileSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import { loadResearchState } from '../../paper/research-state'
import { loadConfig, saveConfig, CONFIG_PATH } from '../../paper/config-io'
import { invalidateCaches as invalidateLLMCaches } from '../../paper/llm-client'
import { ExperimentLogManager } from '../../paper/experiments/experiment-log'
import { loadSessionState } from '../../paper/session-state'
import { listSessions } from '../../paper/session'
import {
  loadAcquiredPapers,
  addPaperToAcquired,
  removePaperFromAcquired,
} from '../../paper/literature-db'

const SESSIONS_DIR_NAME = '.claude-paper-research'

// ── Helpers ─────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status)
}

function getSessionsBaseDir(cwd: string): string {
  return join(cwd, SESSIONS_DIR_NAME)
}

/**
 * Resolve session directory from session ID.
 */
function resolveSessionDir(cwd: string, sessionId: string): string | null {
  const baseDir = getSessionsBaseDir(cwd)
  const sessionDir = resolve(join(baseDir, sessionId))
  // Prevent path traversal — resolved path must be within the base directory
  if (!sessionDir.startsWith(resolve(baseDir) + '/')) return null
  if (existsSync(sessionDir)) return sessionDir
  return null
}

// ── Route Handler ───────────────────────────────────────

export async function handleApiRoute(req: Request, cwd: string): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname
  const method = req.method

  // CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  // ── Sessions ─────────────────────────────────────────

  if (path === '/api/sessions' && method === 'GET') {
    const sessions = listSessions()
    return json(sessions)
  }

  // ── Session-scoped endpoints ─────────────────────────

  const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)\/(.+)$/)
  if (sessionMatch) {
    const [, sessionId, subpath] = sessionMatch
    const sessionDir = resolveSessionDir(cwd, sessionId)
    if (!sessionDir) {
      return error(`Session not found: ${sessionId}`, 404)
    }

    // Session state (conversation mode) — does NOT require research state
    if (subpath === 'session-state' && method === 'GET') {
      const sessionState = loadSessionState(sessionDir)
      if (!sessionState) return error('No session state found', 404)
      return json(sessionState)
    }

    if (subpath === 'messages' && method === 'GET') {
      const sessionState = loadSessionState(sessionDir)
      return json(sessionState?.messages ?? [])
    }

    if (subpath === 'knowledge-pack' && method === 'GET') {
      const sessionState = loadSessionState(sessionDir)
      if (!sessionState?.knowledge_pack_id) {
        return json({ loaded: false })
      }
      const { DKPLoader } = await import('../../paper/domain-knowledge/loader')
      const loader = new DKPLoader()
      try {
        const pack = loader.load(sessionState.knowledge_pack_id)
        return json({ loaded: true, packId: sessionState.knowledge_pack_id, manifest: pack.manifest })
      } catch {
        return json({ loaded: true, packId: sessionState.knowledge_pack_id, error: 'Pack not found on disk' })
      }
    }

    // Literature artifacts (works without .claude-paper/state.json)
    if (subpath === 'literature-artifacts' && method === 'GET') {
      const readJsonFile = (rel: string) => {
        const p = join(sessionDir, rel)
        if (!existsSync(p)) return null
        try { return JSON.parse(readFileSync(p, 'utf-8')) } catch { return null }
      }
      const readTextFile = (rel: string) => {
        const p = join(sessionDir, rel)
        if (!existsSync(p)) return null
        try { return readFileSync(p, 'utf-8') } catch { return null }
      }

      const acquiredPapers = readJsonFile('literature/acquired-papers.json') as any[] | null
      const result: Record<string, unknown> = {
        acquired_papers: acquiredPapers,
        paper_count: Array.isArray(acquiredPapers) ? acquiredPapers.length : 0,
        taxonomy_md: readTextFile('literature/taxonomy.md'),
        survey_md: readTextFile('literature/survey.md'),
        gaps_md: readTextFile('literature/gaps.md'),
        timeline_md: readTextFile('literature/timeline.md'),
        research_plan: readJsonFile('literature/research-plan.json'),
        fragments: readJsonFile('fragments/index.json'),
      }

      const hasData = Object.values(result).some(v => v != null && v !== 0)
      if (!hasData) return error('No literature artifacts found', 404)
      return json(result)
    }

    // ── Literature paper CRUD ────────────────────────────
    if (subpath === 'literature/papers' && method === 'POST') {
      try {
        const body = await req.json()
        if (!body || !body.title || !body.source_id) {
          return error('Missing required fields: title, source_id')
        }
        // Map source to valid DiscoveredPaper.source union
        const VALID_SOURCES = ['arxiv', 'semantic_scholar', 'ssrn', 'other'] as const
        const rawSource = body.source ?? 'other'
        const source = VALID_SOURCES.includes(rawSource) ? rawSource : 'other'
        const VALID_STATUSES = ['downloaded', 'oa_found', 'abstract_only', 'failed'] as const
        const rawStatus = body.status ?? 'abstract_only'
        const status = VALID_STATUSES.includes(rawStatus) ? rawStatus : 'abstract_only'

        const entry: import('../../paper/deep-research/types').AcquisitionResult = {
          paper: {
            title: body.title,
            authors: body.authors ?? [],
            year: body.year ?? 0,
            abstract: body.abstract ?? '',
            source,
            source_id: body.source_id,
            arxiv_id: body.arxiv_id,
            doi: body.doi,
            url: body.url,
            pdf_url: body.pdf_url,
            citation_count: body.citation_count ?? 0,
            relevance_score: body.relevance_score ?? 0.5,
          },
          status,
        }
        addPaperToAcquired(sessionDir, entry)
        return json({ success: true, paper_count: loadAcquiredPapers(sessionDir).length })
      } catch (e: any) {
        return error(`Failed to add paper: ${e?.message}`)
      }
    }

    // DELETE /api/sessions/{id}/literature/papers/{sourceId}
    const paperDeleteMatch = subpath.match(/^literature\/papers\/(.+)$/)
    if (paperDeleteMatch && method === 'DELETE') {
      const sourceId = decodeURIComponent(paperDeleteMatch[1])
      const removed = removePaperFromAcquired(sessionDir, sourceId)
      if (!removed) return error('Paper not found', 404)
      return json({ success: true, paper_count: loadAcquiredPapers(sessionDir).length })
    }

    // POST /api/sessions/{id}/literature/regenerate
    if (subpath === 'literature/regenerate' && method === 'POST') {
      try {
        const acquired = loadAcquiredPapers(sessionDir)
        if (acquired.length === 0) {
          return error('No acquired papers to analyze', 400)
        }
        const papers = acquired.map(a => a.paper)
        const { LiteratureAnalyzer } = await import('../../paper/deep-research/analyzer')
        const { loadModelAssignments } = await import('../../paper/llm-client')
        const { DEFAULT_MODEL_ASSIGNMENTS } = await import('../../paper/types')
        const assignments = loadModelAssignments()
        const modelName = assignments.research || DEFAULT_MODEL_ASSIGNMENTS.research
        const analyzer = new LiteratureAnalyzer(sessionDir, modelName)
        await analyzer.analyzeMapReduce(papers, acquired)
        return json({ success: true, paper_count: acquired.length })
      } catch (e: any) {
        return error(`Regeneration failed: ${e?.message}`, 500)
      }
    }

    // Load research state (used by multiple endpoints below)
    const state = loadResearchState(sessionDir)

    if (subpath === 'state' && method === 'GET') {
      if (!state) return error('No research state found', 404)
      return json(state)
    }

    if (subpath === 'claim-graph' && method === 'GET') {
      if (!state) return error('No research state found', 404)
      return json(state.claimGraph)
    }

    if (subpath === 'evidence' && method === 'GET') {
      if (!state) return error('No research state found', 404)
      return json(state.evidencePool)
    }

    if (subpath === 'trajectory' && method === 'GET') {
      if (!state) return error('No research state found', 404)
      return json(state.trajectory)
    }

    if (subpath === 'stability' && method === 'GET') {
      if (!state) return error('No research state found', 404)
      return json(state.stability)
    }

    if (subpath === 'budget' && method === 'GET') {
      if (!state) return error('No research state found', 404)
      return json(state.budget)
    }

    if (subpath === 'artifacts' && method === 'GET') {
      if (!state) return error('No research state found', 404)
      return json(state.artifacts)
    }

    // ── Experiment endpoints (specific routes before catch-all) ──

    if (subpath === 'experiments/summaries' && method === 'GET') {
      const { ExperimentNotebook } = await import('../../paper/experiments/notebook')
      const notebook = new ExperimentNotebook(sessionDir)
      const logMgr = new ExperimentLogManager(sessionDir)
      const log = logMgr.load()
      const summaries = log.experiments.map(e => notebook.extractSummary(e.id))
      return json(summaries)
    }

    if (subpath === 'experiments/journal' && method === 'GET') {
      const journalPath = join(sessionDir, 'experiments', 'JOURNAL.md')
      if (!existsSync(journalPath)) return error('No journal found', 404)
      const content = readFileSync(journalPath, 'utf-8')
      return json({ content })
    }

    if (subpath === 'experiments/compare' && method === 'GET') {
      const url2 = new URL(req.url)
      const ids = url2.searchParams.get('ids')?.split(',').filter(Boolean) ?? []
      const metric = url2.searchParams.get('metric') ?? ''
      if (ids.length === 0 || !metric) return error('Missing ids or metric query params')
      const logMgr = new ExperimentLogManager(sessionDir)
      const { ExperimentResultsReader } = await import('../../paper/experiments/results-reader')
      const reader = new ExperimentResultsReader(sessionDir, logMgr)
      const results = reader.compareMetric(ids, metric)
      return json(results)
    }

    // GET /api/sessions/{id}/experiments/{expId}/note
    const expNoteMatch = subpath.match(/^experiments\/([^/]+)\/note$/)
    if (expNoteMatch && method === 'GET') {
      const expId = expNoteMatch[1]
      const logMgr = new ExperimentLogManager(sessionDir)
      const entry = logMgr.getExperiment(expId)
      if (!entry) return error('Experiment not found', 404)
      const notePath = join(sessionDir, entry.path, 'NOTE.md')
      if (!existsSync(notePath)) return error('No note found', 404)
      const content = readFileSync(notePath, 'utf-8')
      return json({ content })
    }

    // GET /api/sessions/{id}/experiments/{expId}/figures/{filename}
    const expFigureMatch = subpath.match(/^experiments\/([^/]+)\/figures\/(.+)$/)
    if (expFigureMatch && method === 'GET') {
      const [, expId, filename] = expFigureMatch
      const logMgr = new ExperimentLogManager(sessionDir)
      const entry = logMgr.getExperiment(expId)
      if (!entry) return error('Experiment not found', 404)
      const figurePath = resolve(join(sessionDir, entry.path, 'results', 'figures', filename))
      // Path traversal prevention
      const expDirResolved = resolve(join(sessionDir, entry.path))
      if (!figurePath.startsWith(expDirResolved + '/')) return error('Path escapes experiment directory', 403)
      if (!existsSync(figurePath)) return error('Figure not found', 404)
      const data = readFileSync(figurePath)
      const ext = filename.split('.').pop()?.toLowerCase()
      const contentType = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'
      return new Response(data, {
        headers: { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' },
      })
    }

    // GET /api/sessions/{id}/experiments/{expId}/tables/{filename}
    const expTableMatch = subpath.match(/^experiments\/([^/]+)\/tables\/(.+)$/)
    if (expTableMatch && method === 'GET') {
      const [, expId, filename] = expTableMatch
      const logMgr = new ExperimentLogManager(sessionDir)
      const entry = logMgr.getExperiment(expId)
      if (!entry) return error('Experiment not found', 404)
      const tablePath = resolve(join(sessionDir, entry.path, 'results', 'tables', filename))
      const expDirResolved = resolve(join(sessionDir, entry.path))
      if (!tablePath.startsWith(expDirResolved + '/')) return error('Path escapes experiment directory', 403)
      if (!existsSync(tablePath)) return error('Table not found', 404)
      const content = readFileSync(tablePath, 'utf-8')
      const ext = filename.split('.').pop()?.toLowerCase()
      return new Response(content, {
        headers: {
          'Content-Type': ext === 'csv' ? 'text/csv' : 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      })
    }

    // GET /api/sessions/{id}/experiments/{expId} — single experiment detail
    const expDetailMatch = subpath.match(/^experiments\/([^/]+)$/)
    if (expDetailMatch && expDetailMatch[1] !== 'summaries' && expDetailMatch[1] !== 'journal' && expDetailMatch[1] !== 'compare' && method === 'GET') {
      const expId = expDetailMatch[1]
      const logMgr = new ExperimentLogManager(sessionDir)
      const entry = logMgr.getExperiment(expId)
      if (!entry) return error('Experiment not found', 404)
      const expDir = join(sessionDir, entry.path)

      // Read meta.json
      let meta = null
      try { meta = JSON.parse(readFileSync(join(expDir, 'meta.json'), 'utf-8')) } catch {}

      // Read metrics + audit via ResultsReader
      const { ExperimentResultsReader } = await import('../../paper/experiments/results-reader')
      const reader = new ExperimentResultsReader(sessionDir, logMgr)
      const metrics = reader.readMetrics(expId)
      const audit = reader.readAudit(expId)

      // Scan figures
      let figures: string[] = []
      const figDir = join(expDir, 'results', 'figures')
      if (existsSync(figDir)) {
        try {
          figures = readdirSync(figDir).filter(f => /\.(png|jpg|jpeg|svg|gif)$/i.test(f))
        } catch {}
      }

      // Scan tables
      let tables: string[] = []
      const tabDir = join(expDir, 'results', 'tables')
      if (existsSync(tabDir)) {
        try {
          tables = readdirSync(tabDir).filter(f => /\.(csv|json|tsv)$/i.test(f))
        } catch {}
      }

      return json({
        log_entry: entry,
        meta,
        metrics,
        audit,
        figures,
        tables,
        has_note: existsSync(join(expDir, 'NOTE.md')),
      })
    }

    // Existing catch-all: list all experiments
    if (subpath === 'experiments' && method === 'GET') {
      const logMgr = new ExperimentLogManager(sessionDir)
      const log = logMgr.load()
      return json(log.experiments)
    }

    if (subpath === 'paper/pdf' && method === 'GET') {
      if (!state?.artifacts?.compiled_pdf) {
        return error('No compiled PDF found', 404)
      }
      const pdfPath = state.artifacts.compiled_pdf
      const absolutePath = pdfPath.startsWith('/')
        ? pdfPath
        : join(sessionDir, pdfPath)
      // Prevent path traversal — resolved path must stay within session directory
      const resolvedPath = resolve(absolutePath)
      const resolvedBase = resolve(sessionDir)
      if (!resolvedPath.startsWith(resolvedBase + '/')) {
        return error('PDF path escapes session directory', 403)
      }
      if (!existsSync(resolvedPath)) {
        return error('PDF file not found on disk', 404)
      }
      const pdfData = readFileSync(resolvedPath)
      return new Response(pdfData, {
        headers: {
          'Content-Type': 'application/pdf',
          'Access-Control-Allow-Origin': '*',
        },
      })
    }

    return error(`Unknown session endpoint: ${subpath}`, 404)
  }

  // ── Knowledge Packs (global) ────────────────────────

  if (path === '/api/knowledge-packs' && method === 'GET') {
    const { DKPLoader } = await import('../../paper/domain-knowledge/loader')
    const loader = new DKPLoader()
    return json(loader.listAvailablePacks())
  }

  // ── Config ──────────────────────────────────────────

  if (path === '/api/config' && method === 'GET') {
    const config = loadConfig()
    // Redact sensitive fields — show only last 4 chars
    const safe = { ...config }
    if (safe.api_keys) {
      safe.api_keys = Object.fromEntries(
        Object.entries(safe.api_keys).map(([k, v]) => [
          k,
          typeof v === 'string' && v.length > 8
            ? '***...' + v.slice(-4)
            : v ? '***' : '',
        ]),
      )
    }
    return json(safe)
  }

  if (path === '/api/config' && method === 'PUT') {
    return handleConfigUpdate(req)
  }

  // ── Health ──────────────────────────────────────────

  if (path === '/api/health') {
    return json({ status: 'ok', cwd })
  }

  return error(`Not found: ${path}`, 404)
}

async function handleConfigUpdate(req: Request): Promise<Response> {
  try {
    const body = await req.json()
    if (!body || typeof body !== 'object') {
      return error('Invalid config body')
    }
    const existing = loadConfig()
    // Merge api_keys: keep existing value if the incoming one looks redacted or too short
    if (body.api_keys) {
      const existingKeys = existing.api_keys ?? {}
      for (const [k, v] of Object.entries(body.api_keys as Record<string, string>)) {
        if (typeof v !== 'string' || v.includes('...') || v === '***' || v === '') {
          // Looks redacted or empty — keep existing
          (body as any).api_keys[k] = (existingKeys as any)[k]
        } else if (v.length < 16) {
          // Too short to be a valid API key — keep existing to prevent accidental corruption
          (body as any).api_keys[k] = (existingKeys as any)[k]
        }
      }
    }
    // Deep merge known nested objects to prevent partial overwrites
    const merged: Record<string, any> = { ...existing }
    for (const [key, val] of Object.entries(body as Record<string, any>)) {
      if (val && typeof val === 'object' && !Array.isArray(val) && existing[key] && typeof existing[key] === 'object') {
        merged[key] = { ...existing[key], ...val }
      } else {
        merged[key] = val
      }
    }
    saveConfig(merged)
    // Invalidate cached LLM clients so new credentials take effect immediately
    invalidateLLMCaches()
    return json({ success: true })
  } catch (e) {
    return error(`Failed to update config: ${e}`)
  }
}
