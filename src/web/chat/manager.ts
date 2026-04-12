/**
 * ChatManager — core conversational engine for general sessions.
 *
 * Handles user messages by building context from the session's accumulated
 * knowledge (collected papers, knowledge base, research state), calling
 * chatCompletion(), optionally executing tool calls, and persisting messages.
 *
 * Sends progress via WebSocket JSON-RPC notifications.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { nanoid } from 'nanoid'

import type { JsonRpcPeer } from '../../acp/jsonrpc'
import {
  chatCompletion,
  loadModelAssignments,
  type UnifiedMessage,
  type UnifiedChatResult,
} from '../../paper/llm-client'
import { DEFAULT_MODEL_ASSIGNMENTS } from '../../paper/types'
import {
  executeTool,
  setActiveWorkingDir,
  executionContext,
  type ExecutionContext,
  RESEARCH_TOOLS,
  DK_TOOLS,
  BASE_TOOLS,
  WEB_TOOLS,
  GITHUB_TOOLS,
  MATH_TOOLS,
  HF_TOOLS,
  ACADEMIC_TOOLS,
  CITATION_TOOLS,
  DATA_TOOLS,
  INFRA_TOOLS,
  initDKPForSession,
  getActiveDKPLoader,
  type ToolDefinition,
} from '../../paper/agent-dispatch'
import { DKPLoader } from '../../paper/domain-knowledge/loader'
import {
  loadSessionState,
  saveSessionState,
  createEmptySessionState,
  createChatMessage,
  addMessage,
  type SessionState,
  type ChatMessage,
} from '../../paper/session-state'
import { loadResearchState, buildStateContext } from '../../paper/research-state'
import { addPaperToAcquired } from '../../paper/literature-db'

// Maximum number of history messages to include in LLM context
const MAX_CONTEXT_MESSAGES = 40

// Maximum number of tool call rounds per user message
const MAX_TOOL_ROUNDS = 15
// Maximum truncation recovery retries
const MAX_TRUNCATION_RETRIES = 3
// Keep only the last N rounds of tool results in full context
const KEEP_RECENT_TOOL_ROUNDS = 3
const TOOL_RESULT_RE = /^\[Tool result for .+\]: /

/**
 * Microcompaction: replace old tool-result messages with a short marker.
 * Keeps the most recent `keep` tool-result user messages intact.
 */
function microcompactMessages(messages: { role: string; content: string }[], keep: number): void {
  const indices: number[] = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user' && TOOL_RESULT_RE.test(messages[i].content)) {
      indices.push(i)
    }
  }
  const toClear = indices.slice(0, -keep || indices.length)
  for (const idx of toClear) {
    messages[idx] = {
      role: 'user',
      content: '[Tool result cleared to save context]',
    }
  }
}

export class ChatManager {
  private processing = false
  private abortController: AbortController | null = null

  constructor(
    private readonly sessionDir: string,
    private readonly sessionId: string,
    private readonly peer: JsonRpcPeer,
  ) {}

  /**
   * Cancel the currently processing message. Safe to call when idle.
   */
  cancel(): void {
    this.abortController?.abort()
  }

  /**
   * Process a user message: persist it, call LLM, handle tool calls, persist response.
   * Rejects concurrent calls to prevent message loss from state race conditions.
   */
  async processMessage(userMessage: string): Promise<void> {
    if (this.processing) {
      throw new Error('A message is already being processed. Please wait.')
    }
    this.processing = true
    try {
      await this._processMessage(userMessage)
    } finally {
      this.processing = false
    }
  }

  private async _processMessage(userMessage: string): Promise<void> {
    let state = this.loadOrCreateState()

    // 1. Persist user message
    const userMsg = createChatMessage('user', userMessage)
    state = addMessage(state, userMsg)
    saveSessionState(this.sessionDir, state)

    // Notify frontend: message received
    this.peer.sendNotification('chat/message_start', {
      messageId: 'pending',
      sessionId: this.sessionId,
    })

    // Create scoped execution context — provides isolated workingDir and dkpLoader
    // via AsyncLocalStorage, safe even when multiple sessions process concurrently.
    let dkpLoader: DKPLoader | null = null
    if (state.knowledge_pack_id) {
      try {
        const loader = new DKPLoader()
        loader.load(state.knowledge_pack_id)
        dkpLoader = loader
      } catch {
        // Pack not found — leave null
      }
    }
    const ctx: ExecutionContext = { workingDir: this.sessionDir, dkpLoader }

    this.abortController = new AbortController()
    const signal = this.abortController.signal

    return executionContext.run(ctx, async () => {

    // Set legacy globals INSIDE the run block so they are only written
    // when this specific async context is executing (not racing with others).
    setActiveWorkingDir(this.sessionDir)
    initDKPForSession(state.knowledge_pack_id)

    try {
      // 2. Build context and call LLM
      const system = this.buildSystemPrompt(state)
      const messages = this.buildMessages(state)
      const tools = this.getAvailableTools(state)

      let result = await chatCompletion({
        modelSpec: this.getModelSpec(),
        system,
        messages,
        max_tokens: 16384,
        tools: tools.length > 0 ? tools : undefined,
        signal,
      })

      // 3. Handle tool calls + truncation recovery in a loop
      let rounds = 0
      let truncationRetries = 0
      let allToolSummaries: { name: string; summary: string }[] = []
      let runningMessages = [...messages]

      while (rounds < MAX_TOOL_ROUNDS) {
        if (signal.aborted) break

        // ── Truncation recovery ──────────────────────────
        // If the model was cut off by max_tokens, inject a continuation
        // prompt and retry (up to MAX_TRUNCATION_RETRIES times).
        if (result.stop_reason === 'max_tokens' || result.stop_reason === 'length') {
          if (truncationRetries < MAX_TRUNCATION_RETRIES) {
            truncationRetries++
            runningMessages = [
              ...runningMessages,
              { role: 'assistant' as const, content: result.text || '' },
              { role: 'user' as const, content: 'Your response was truncated. Resume directly from where you left off — no recap. If you were about to call tools, call them now.' },
            ]
            result = await chatCompletion({
              modelSpec: this.getModelSpec(),
              system,
              messages: runningMessages,
              max_tokens: 16384,
              tools: tools.length > 0 ? tools : undefined,
              signal,
            })
            continue
          }
          break // exhausted truncation retries
        }

        // ── No tool calls — check for dangling intent ────
        if (!result.tool_calls || result.tool_calls.length === 0) {
          // Detect "dangling intent": model narrates what it wants to do
          // next but stops without actually calling tools. Common patterns:
          // ends with ":", "Let me...", "I'll now...", "checking...", etc.
          const text = (result.text || '').trimEnd()
          const danglingIntent = truncationRetries < MAX_TRUNCATION_RETRIES && text.length > 0 && (
            /[:：]\s*$/.test(text) ||
            /(?:let me|i'll|i will|now (?:let|check|look|search|read|fetch|download))\b[^.!?]*$/i.test(text)
          )
          if (danglingIntent) {
            truncationRetries++
            runningMessages = [
              ...runningMessages,
              { role: 'assistant' as const, content: text },
              { role: 'user' as const, content: 'You stopped mid-thought. Continue — call the tools you were about to use.' },
            ]
            result = await chatCompletion({
              modelSpec: this.getModelSpec(),
              system,
              messages: runningMessages,
              max_tokens: 16384,
              tools: tools.length > 0 ? tools : undefined,
              signal,
            })
            continue
          }
          break
        }

        // Reset truncation counter on successful tool-use
        truncationRetries = 0
        rounds++

        const toolResults: { id: string; content: string }[] = []

        for (const tc of result.tool_calls) {
          if (signal.aborted) break

          // Notify frontend about tool call
          this.peer.sendNotification('chat/tool_call', {
            sessionId: this.sessionId,
            toolName: tc.name,
            toolInput: tc.input,
          })

          const toolResult = await executeTool(tc.name, tc.input)
          toolResults.push({ id: tc.id, content: toolResult })

          // Auto-persist papers found via search or download tools
          if (tc.name === 'paper_download' || tc.name === 'arxiv_search' || tc.name === 'semantic_scholar_search') {
            this.tryPersistPaperFromTool(tc.name, tc.input, toolResult)
          }

          allToolSummaries.push({
            name: tc.name,
            summary: truncate(toolResult, 200),
          })

          this.peer.sendNotification('chat/tool_result', {
            sessionId: this.sessionId,
            toolName: tc.name,
            result: truncate(toolResult, 500),
          })
        }

        if (signal.aborted) break

        // Apply aggregate budget — cap total tool result size per round
        const rawEntries = toolResults.map(tr => ({
          toolName: tr.id,
          result: tr.content,
        }))
        const totalSize = rawEntries.reduce((s, e) => s + e.result.length, 0)
        const MAX_AGGREGATE = 200_000
        let budgetedResults = toolResults.map(tr => tr.content)
        if (totalSize > MAX_AGGREGATE) {
          // Sort by size descending, truncate largest first
          const indexed = rawEntries.map((e, i) => ({ i, size: e.result.length }))
          indexed.sort((a, b) => b.size - a.size)
          budgetedResults = [...budgetedResults]
          let remaining = totalSize
          for (const { i, size } of indexed) {
            if (remaining <= MAX_AGGREGATE) break
            budgetedResults[i] = truncate(toolResults[i].content, 2000) + `\n\n... [truncated — full output was ${size} chars]`
            remaining -= size - budgetedResults[i].length
          }
        }

        // Accumulate assistant response + tool results for next round
        runningMessages = [
          ...runningMessages,
          { role: 'assistant' as const, content: result.text || '' },
          ...budgetedResults.map((content, i) => ({
            role: 'user' as const,
            content: `[Tool result for ${toolResults[i].id}]: ${content}`,
          })),
        ]

        // Microcompact: clear old tool results before next LLM call
        microcompactMessages(runningMessages, KEEP_RECENT_TOOL_ROUNDS)

        result = await chatCompletion({
          modelSpec: this.getModelSpec(),
          system,
          messages: runningMessages,
          max_tokens: 16384,
          tools: tools.length > 0 ? tools : undefined,
          signal,
        })
      }

      // 4. Persist assistant response (even partial if aborted)
      const assistantMsg = createChatMessage('assistant', result.text || (signal.aborted ? '(cancelled)' : ''), {
        model: this.getModelSpec(),
        tokens_used: result.input_tokens + result.output_tokens,
        cost_usd: result.cost_usd,
        tool_calls: allToolSummaries.length > 0 ? allToolSummaries : undefined,
      })

      state = this.loadOrCreateState() // Reload in case of concurrent writes
      state = addMessage(state, assistantMsg)
      saveSessionState(this.sessionDir, state)

      // 5. Notify frontend
      this.peer.sendNotification(signal.aborted ? 'chat/message_cancelled' : 'chat/message_complete', {
        messageId: assistantMsg.id,
        sessionId: this.sessionId,
        message: assistantMsg,
      })
    } catch (err: any) {
      // AbortError from cancelled LLM calls — notify frontend
      if (signal.aborted) {
        this.peer.sendNotification('chat/message_cancelled', {
          sessionId: this.sessionId,
        })
        return
      }

      const errorMsg = createChatMessage(
        'system',
        `Error: ${err?.message ?? 'Unknown error'}`,
      )
      state = this.loadOrCreateState()
      state = addMessage(state, errorMsg)
      saveSessionState(this.sessionDir, state)

      this.peer.sendNotification('chat/message_complete', {
        messageId: errorMsg.id,
        sessionId: this.sessionId,
        message: errorMsg,
      })
    } finally {
      this.abortController = null
    }

    }) // end executionContext.run()
  }

  /**
   * Load full chat history from persisted state.
   */
  loadHistory(): ChatMessage[] {
    const state = loadSessionState(this.sessionDir)
    return state?.messages ?? []
  }

  /**
   * Load a knowledge pack into this session. Persists to session state
   * and initializes the DKP loader for immediate tool use.
   */
  loadKnowledgePack(packId: string): { success: boolean; error?: string } {
    // Validate packId to prevent path traversal
    if (!packId || packId.includes('/') || packId.includes('\\') || packId.startsWith('.')) {
      return { success: false, error: 'Invalid pack ID' }
    }
    const loader = new DKPLoader()
    const available = loader.listAvailablePacks()
    if (!available.some(m => m.id === packId)) {
      return { success: false, error: `Pack "${packId}" not found` }
    }
    let state = this.loadOrCreateState()
    state = { ...state, knowledge_pack_id: packId }
    saveSessionState(this.sessionDir, state)
    initDKPForSession(packId)
    return { success: true }
  }

  /**
   * Unload the knowledge pack from this session.
   */
  unloadKnowledgePack(): void {
    let state = this.loadOrCreateState()
    state = { ...state, knowledge_pack_id: null }
    saveSessionState(this.sessionDir, state)
    initDKPForSession(null)
  }

  // ── Private Helpers ─────────────────────────────────────

  /**
   * After a paper tool call, try to persist the result to acquired-papers.json
   * so the Literature panel picks it up via polling.
   */
  private tryPersistPaperFromTool(toolName: string, input: any, result: string): void {
    try {
      if (toolName === 'paper_download') {
        // paper_download input has: arxiv_id or url, output contains download status
        const downloaded = result.toLowerCase().includes('downloaded') || result.toLowerCase().includes('saved')
        const arxivId = input?.arxiv_id || input?.paper_id || ''
        const title = input?.title || arxivId || 'Unknown'
        if (arxivId) {
          const source: 'arxiv' | 'semantic_scholar' | 'ssrn' | 'other' =
            arxivId.match(/^\d{4}\.\d+/) ? 'arxiv' : 'other'
          addPaperToAcquired(this.sessionDir, {
            paper: {
              title,
              authors: [],
              year: 0,
              abstract: '',
              source,
              source_id: arxivId,
              arxiv_id: source === 'arxiv' ? arxivId : undefined,
              citation_count: 0,
              relevance_score: 0.5,
            },
            status: downloaded ? 'downloaded' : 'abstract_only',
          })
        }
      }
    } catch {
      // Non-critical — silently ignore persistence failures
    }
  }

  private loadOrCreateState(): SessionState {
    return loadSessionState(this.sessionDir) ?? createEmptySessionState()
  }

  private getModelSpec(): string {
    const assignments = loadModelAssignments()
    // Use the 'research' model for chat; fall back to default
    return assignments.research || DEFAULT_MODEL_ASSIGNMENTS.research
  }

  private buildSystemPrompt(state: SessionState): string {
    const parts: string[] = []

    parts.push(`You are a helpful AI research assistant. You can have general conversations, help with literature search, organize knowledge, and assist with research tasks.`)
    parts.push(`\nCurrent session topic: "${this.sessionId}"`)

    // Include collected papers context
    if (state.collected_papers.length > 0) {
      parts.push(`\n## Collected Papers (${state.collected_papers.length})`)
      for (const paper of state.collected_papers.slice(-20)) {
        parts.push(`- "${paper.title}" by ${paper.authors.slice(0, 3).join(', ')} [${paper.source}]`)
      }
    }

    // Include knowledge pack context if loaded (DKP already initialized in _processMessage)
    if (state.knowledge_pack_id) {
      const loader = getActiveDKPLoader()
      if (loader) {
        const packs = loader.getLoadedPacks()
        if (packs.length > 0) {
          const pack = packs[0]
          parts.push(`\n## Loaded Knowledge Pack: ${pack.manifest.name}`)
          parts.push(`Domain: ${pack.manifest.description}`)
          parts.push(`Entries: ${pack.manifest.stats.entries_total} total`)
          parts.push(`  Theorems: ${pack.manifest.stats.theorems}, Definitions: ${pack.manifest.stats.definitions}, Algorithms: ${pack.manifest.stats.algorithms}, Results: ${pack.manifest.stats.results}`)
          if (pack.overview) {
            const snippet = pack.overview.length > 800 ? pack.overview.slice(0, 800) + '...' : pack.overview
            parts.push(`\nDomain Overview:\n${snippet}`)
          }
          parts.push('\nYou have dk_search, dk_expand, dk_navigate, and dk_find_technique tools to query this knowledge base.')
        }
      }
    }

    // Include research state context if available
    if (state.research_state_initialized) {
      const researchState = loadResearchState(this.sessionDir)
      if (researchState) {
        parts.push('\n## Active Research Context')
        parts.push(buildStateContext(researchState))
      }
    }

    // Knowledge Pack availability hint (when no pack is loaded)
    if (!state.knowledge_pack_id) {
      parts.push(`\n## Knowledge Base
This system has a built-in **Knowledge Pack** feature. Users can load a Domain Knowledge Pack (DKP) to give you access to a structured knowledge base of theorems, definitions, algorithms, and results for a specific research domain. Once loaded, you gain dk_search, dk_expand, dk_navigate, and dk_find_technique tools for querying it.
- If the user asks about building or using a knowledge base, explain this feature and suggest loading an available pack from the right panel.
- Knowledge Packs can be loaded via the "Knowledge Pack" card in the right sidebar.`)
    }

    // Include local files context (Issue 4: local literature awareness)
    const localFiles = this.buildLocalFilesContext()
    if (localFiles) {
      parts.push(`\n## Local Files\n${localFiles}`)
      parts.push('\n**IMPORTANT**: Always check local literature and files BEFORE searching external sources. Many papers you need may already be downloaded.')
    }

    parts.push(`\n## Guidelines
- **LOCAL FIRST**: Before searching external sources, ALWAYS check local files using list_files, read_file, and grep_content. Use list_files("literature/papers/*.pdf") to discover downloaded papers. Use read_file to read paper metadata, taxonomy files, or LaTeX fragments. Use grep_content to search across local files for specific topics.
- Be concise and informative.
- When asked about papers or literature, first check local files, then use arxiv_search, semantic_scholar_search, openalex_search, or dblp_search for papers not available locally.
- Use web_search and web_fetch for non-academic information (blogs, docs, leaderboards).
- Use github_search to find paper implementations and open-source tools.
- Use wolfram_alpha or sympy_eval for mathematical computation and symbolic algebra.
- Use hf_search_models and hf_search_datasets to find HuggingFace models and datasets.
- Use bibtex_lookup and bibtex_manage for citation management; latex_compile and latex_check for LaTeX.
- Use data_query for SQL analysis of CSV/JSON/Parquet files; plot_create for generating charts.
- Use docker_run ONLY for running isolated experiments that require specific environments (Python, PyTorch, etc.). Do NOT use docker_run for file browsing or text search — use list_files, read_file, and grep_content instead.
- Use sqlite_query for database operations.
- Use image_analyze to analyze figures, plots, or diagrams.
- Format responses in markdown when appropriate.
- If the user mentions "knowledge base" or "knowledge pack", explain the DKP feature and how to load one.
- If the user asks to start a full research pipeline, suggest using the escalation feature.`)

    return parts.join('\n')
  }

  private buildMessages(state: SessionState): UnifiedMessage[] {
    // Take the most recent messages, respecting the context window
    const recentMessages = state.messages.slice(-MAX_CONTEXT_MESSAGES)
    return recentMessages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }))
  }

  /**
   * Scan the session directory for local literature, fragments, and metadata.
   * Returns a formatted string for the system prompt, or null if nothing found.
   */
  private buildLocalFilesContext(): string | null {
    const parts: string[] = []
    const litDir = join(this.sessionDir, 'literature')
    const papersDir = join(litDir, 'papers')
    const fragmentsDir = join(this.sessionDir, 'fragments')

    // 1. Read acquired-papers.json if it exists
    const acquiredPath = join(litDir, 'acquired-papers.json')
    if (existsSync(acquiredPath)) {
      try {
        const acquired = JSON.parse(readFileSync(acquiredPath, 'utf-8'))
        if (Array.isArray(acquired) && acquired.length > 0) {
          parts.push(`### Acquired Papers (${acquired.length} total)`)
          for (const entry of acquired.slice(0, 30)) {
            const title = entry.paper?.title ?? entry.title ?? 'Unknown'
            const status = entry.status ?? 'unknown'
            const pdfPath = entry.pdf_path
              ? ` [PDF: ${entry.pdf_path.replace(this.sessionDir + '/', '')}]`
              : ''
            parts.push(`- ${title} (${status})${pdfPath}`)
          }
          if (acquired.length > 30) {
            parts.push(`- ... and ${acquired.length - 30} more (use read_file on literature/acquired-papers.json for full list)`)
          }
        }
      } catch { /* ignore parse errors */ }
    }

    // 2. Count PDFs in literature/papers/
    if (existsSync(papersDir)) {
      try {
        const pdfs = readdirSync(papersDir).filter(f => f.endsWith('.pdf'))
        if (pdfs.length > 0) {
          parts.push(`\n### PDF Library: ${pdfs.length} papers in literature/papers/`)
          parts.push('Use list_files("literature/papers/*.pdf") to see all filenames.')
        }
      } catch { /* ignore */ }
    }

    // 3. Check for taxonomy.md
    if (existsSync(join(litDir, 'taxonomy.md'))) {
      parts.push('\n### Literature Taxonomy: literature/taxonomy.md')
      parts.push('Use read_file to see the organized taxonomy of collected literature.')
    }

    // 4. Check for research-plan.json
    if (existsSync(join(litDir, 'research-plan.json'))) {
      parts.push('\n### Research Plan: literature/research-plan.json')
    }

    // 5. Check fragments/ directory
    if (existsSync(fragmentsDir)) {
      try {
        const entries = readdirSync(fragmentsDir, { withFileTypes: true })
        const subdirs = entries.filter(e => e.isDirectory())
        if (subdirs.length > 0) {
          const fragSummary: string[] = []
          for (const sub of subdirs) {
            try {
              const files = readdirSync(join(fragmentsDir, sub.name)).filter(f => f.endsWith('.tex'))
              if (files.length > 0) fragSummary.push(`${sub.name}/ (${files.length} .tex files)`)
            } catch { /* ignore */ }
          }
          if (fragSummary.length > 0) {
            parts.push('\n### LaTeX Fragments in fragments/')
            fragSummary.forEach(f => parts.push(`- ${f}`))
          }
        }
      } catch { /* ignore */ }
    }

    if (parts.length === 0) return null
    return parts.join('\n')
  }

  private getAvailableTools(state: SessionState): ToolDefinition[] {
    // Local file tools first — model should prefer local exploration over external search
    const localTools = BASE_TOOLS.filter(t =>
      ['list_files', 'read_file', 'grep_content'].includes(t.name),
    )
    const tools = [
      ...localTools,
      ...RESEARCH_TOOLS,
      ...WEB_TOOLS,
      ...GITHUB_TOOLS,
      ...MATH_TOOLS,
      ...HF_TOOLS,
      ...ACADEMIC_TOOLS,
      ...CITATION_TOOLS,
      ...DATA_TOOLS,
      ...INFRA_TOOLS,
    ]
    if (state.knowledge_pack_id) {
      tools.push(...DK_TOOLS)
    }
    return tools
  }
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen) + '...'
}
