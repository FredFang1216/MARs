import {
  readFileSync,
  readdirSync,
  existsSync,
  writeFileSync,
  mkdirSync,
} from 'fs'
import { join, basename, dirname } from 'path'
import { Glob } from 'bun'
import matter from 'gray-matter'
import { chatCompletion, estimateCost, type UnifiedMessage } from './llm-client'
import { buildStateContext, type ResearchState } from './research-state'
import { DKPLoader } from './domain-knowledge/loader'
import type { KnowledgeEntry } from './domain-knowledge/types'
import {
  executionContext,
  getWorkingDir,
  getEffectiveDKPLoader,
  resolvePath,
  setActiveWorkingDir,
  setActiveDKPLoader,
  type ExecutionContext,
} from './tools/tool-context'
import {
  executeWebSearch,
  executeWebFetch,
  executeGitHubSearch,
  executeGitHubReadFile,
  executeGitHubClone,
  executeWolframAlpha,
  executeSympyEval,
  executeHFSearchModels,
  executeHFSearchDatasets,
  executeHFModelInfo,
  executeHFDatasetPreview,
  executeOpenAlexSearch,
  executeDblpSearch,
  executeImageAnalyze,
  WEB_TOOLS,
  GITHUB_TOOLS,
  MATH_TOOLS,
  HF_TOOLS,
  ACADEMIC_TOOLS,
} from './tools/external-tools'
import {
  executeBibTeXLookup,
  executeBibTeXManage,
  executeLatexCompile,
  executeLatexCheck,
  executeDataQuery,
  executePlotCreate,
  executeDockerRun,
  executeDockerBuild,
  executeDockerList,
  executeSQLiteQuery,
  CITATION_TOOLS,
  DATA_TOOLS,
  INFRA_TOOLS,
} from './tools/paper-tools'
import { DEFAULT_MODEL_ASSIGNMENTS } from './types'
import type {
  ExecutionResult,
  LiteratureFinding,
  KnownResultFinding,
  CitationFinding,
} from './orchestrator'

// ── Execution Context (re-exported from tools/tool-context) ──
// The ExecutionContext interface, executionContext AsyncLocalStorage,
// setActiveWorkingDir, getWorkingDir, resolvePath, and DKP helpers
// are defined in tools/tool-context.ts and re-exported here for
// backward compatibility with existing importers.
export { executionContext, setActiveWorkingDir, type ExecutionContext }

// ── Agent Template Loading ──────────────────────────────

interface AgentTemplate {
  name: string
  description: string
  systemPrompt: string
  model?: string
  tools?: string[]
}

const AGENT_DIRS = [
  join(process.cwd(), 'agents'),
  join(process.cwd(), '.claude', 'agents'),
]

function loadAgentTemplate(agentName: string): AgentTemplate | null {
  for (const dir of AGENT_DIRS) {
    const filePath = join(dir, `${agentName}.md`)
    if (!existsSync(filePath)) continue

    try {
      const raw = readFileSync(filePath, 'utf-8')
      const parsed = matter(raw)
      const fm = parsed.data as Record<string, unknown>

      return {
        name: (fm.name as string) ?? agentName,
        description: (fm.description as string) ?? '',
        systemPrompt: parsed.content.trim(),
        model: (fm.model_name as string) ?? (fm.model as string) ?? undefined,
        tools: fm.tools as string[] | undefined,
      }
    } catch {
      continue
    }
  }
  return null
}

function listAvailableAgents(): string[] {
  const agents = new Set<string>()
  for (const dir of AGENT_DIRS) {
    if (!existsSync(dir)) continue
    try {
      for (const file of readdirSync(dir)) {
        if (file.endsWith('.md')) {
          agents.add(basename(file, '.md'))
        }
      }
    } catch {
      // ignore
    }
  }
  return [...agents]
}

// ── Model Resolution ────────────────────────────────────

type ModelRole = keyof typeof DEFAULT_MODEL_ASSIGNMENTS

const ROLE_ALIASES: Record<string, ModelRole> = {
  main: 'research',
  research: 'research',
  reasoning: 'reasoning',
  reasoning_deep: 'reasoning_deep',
  coding: 'coding',
  writing: 'writing',
  review: 'review',
}

/**
 * Resolve a role name (from agent template frontmatter) to a full "provider:model" spec.
 * If the value is already a model spec (contains ':'), use as-is.
 * If it's a bare model name (e.g. 'claude-opus-4-6'), infer provider.
 * If it's a role name (e.g. 'research', 'reasoning'), map through DEFAULT_MODEL_ASSIGNMENTS.
 */
function resolveModelSpec(roleOrModel?: string): string {
  if (!roleOrModel) {
    return DEFAULT_MODEL_ASSIGNMENTS.research
  }

  const role = ROLE_ALIASES[roleOrModel.toLowerCase()]
  if (role) {
    return DEFAULT_MODEL_ASSIGNMENTS[role]
  }

  // Already has provider prefix — use as-is
  if (roleOrModel.includes(':')) {
    return roleOrModel
  }

  // Bare model name — infer provider
  if (
    roleOrModel.includes('gpt') ||
    roleOrModel.includes('o3') ||
    roleOrModel.includes('o4')
  ) {
    return `openai:${roleOrModel}`
  }
  if (
    roleOrModel.includes('claude') ||
    roleOrModel.includes('haiku') ||
    roleOrModel.includes('sonnet') ||
    roleOrModel.includes('opus')
  ) {
    return `anthropic:${roleOrModel}`
  }
  if (roleOrModel.includes('deepseek')) return `deepseek:${roleOrModel}`
  if (roleOrModel.includes('qwen')) return `qwen:${roleOrModel}`
  if (roleOrModel.includes('glm')) return `glm:${roleOrModel}`

  // Unknown role, fall back to research
  return DEFAULT_MODEL_ASSIGNMENTS.research
}

/**
 * Extract model ID from "provider:model" format.
 * e.g. "anthropic:claude-opus-4-6" -> "claude-opus-4-6"
 */
export function extractModelId(modelSpec: string): string {
  const colonIdx = modelSpec.indexOf(':')
  return colonIdx >= 0 ? modelSpec.slice(colonIdx + 1) : modelSpec
}

// ── Tool Definitions for Agents ─────────────────────────

// Re-export ToolDefinition from tool-context (single source of truth)
export type { ToolDefinition } from './tools/tool-context'
import type { ToolDefinition } from './tools/tool-context'

export const BASE_TOOLS: ToolDefinition[] = [
  {
    name: 'bash',
    description:
      'Execute a shell command and return its stdout/stderr. Use for running experiments, installing packages, compiling LaTeX, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
        timeout_ms: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 60000, max: 300000)',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file. Returns the full text content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description:
            'Path to the file (absolute or relative to project root)',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Write content to a file. Creates parent directories if needed. Overwrites existing files.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description:
            'Path to the file (absolute or relative to project root)',
        },
        content: {
          type: 'string',
          description: 'The content to write',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_files',
    description:
      'List files matching a glob pattern. Returns matching file paths.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern (e.g. "**/*.py", "results/*.csv")',
        },
        cwd: {
          type: 'string',
          description: 'Directory to search in (default: project root)',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'grep_content',
    description:
      'Search file contents using a regex pattern. Returns matching lines with file paths.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: {
          type: 'string',
          description: 'Regex pattern to search for',
        },
        path: {
          type: 'string',
          description: 'Directory or file to search in (default: project root)',
        },
        glob: {
          type: 'string',
          description: 'File glob filter (e.g. "*.py", "*.tex")',
        },
      },
      required: ['pattern'],
    },
  },
]

export const RESEARCH_TOOLS: ToolDefinition[] = [
  {
    name: 'arxiv_search',
    description:
      'Search arXiv for academic papers. Returns structured metadata (title, authors, abstract, categories, URLs).',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query (supports arXiv search syntax)',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results (default: 10, max: 50)',
        },
        categories: {
          type: 'string',
          description:
            'Comma-separated arXiv categories to filter (e.g. "cs.LG,stat.ML")',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'semantic_scholar_search',
    description:
      'Search Semantic Scholar for papers with citation data. Supports forward/backward citation graph traversal.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        paper_id: {
          type: 'string',
          description:
            'Paper ID for citation graph traversal (alternative to query)',
        },
        action: {
          type: 'string',
          description:
            'Action: "search" (default), "citations" (papers citing this), "references" (papers cited by this)',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results (default: 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'paperqa_query',
    description:
      'Query the local PaperQA2 literature index. Actions: "ask" (answer a question from indexed papers), "search" (find relevant passages).',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'The question or search query',
        },
        action: {
          type: 'string',
          description:
            '"ask" for QA, "search" for passage retrieval (default: "ask")',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'paper_download',
    description:
      'Download a paper PDF using the fallback chain: arXiv → Unpaywall → CORE → abstract_only.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'Paper URL (arXiv, DOI, or direct PDF URL)',
        },
        paper_id: {
          type: 'string',
          description: 'Identifier for the paper (e.g. arXiv ID)',
        },
        output_dir: {
          type: 'string',
          description:
            'Directory to save the PDF (default: literature/papers/)',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'pdf_extract',
    description:
      'Extract text, figures, tables, and references from a PDF file using structured extraction (PyMuPDF + pdfplumber).',
    input_schema: {
      type: 'object' as const,
      properties: {
        pdf_path: {
          type: 'string',
          description: 'Path to the PDF file to extract',
        },
        output_dir: {
          type: 'string',
          description:
            'Directory for extraction output (default: alongside PDF)',
        },
      },
      required: ['pdf_path'],
    },
  },
]

export const DK_TOOLS: ToolDefinition[] = [
  {
    name: 'dk_search',
    description:
      'Search loaded domain knowledge packs for theorems, definitions, algorithms, and results. Returns summary-level results. Use dk_expand to get full details.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query',
        },
        type: {
          type: 'string',
          description:
            'Filter by entry type: theorem, definition, algorithm, result (optional)',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results (default: 5)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'dk_expand',
    description:
      'Expand a domain knowledge entry to see full details: statement, assumptions, proof sketch, usability notes, relations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entry_id: {
          type: 'string',
          description: 'Knowledge entry ID (e.g. "thm-001", "def-003")',
        },
        include_proof: {
          type: 'boolean',
          description: 'Include proof sketch for theorems (default: false)',
        },
      },
      required: ['entry_id'],
    },
  },
  {
    name: 'dk_navigate',
    description:
      'Navigate the knowledge graph from a given entry. Directions: prerequisites, dependents, related, siblings.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entry_id: {
          type: 'string',
          description: 'Knowledge entry ID to navigate from',
        },
        direction: {
          type: 'string',
          description: 'One of: prerequisites, dependents, related, siblings',
        },
      },
      required: ['entry_id', 'direction'],
    },
  },
  {
    name: 'dk_find_technique',
    description:
      'Search for theorems that use a specific proof technique. Returns theorems with their proof sketches.',
    input_schema: {
      type: 'object' as const,
      properties: {
        technique: {
          type: 'string',
          description:
            'Proof technique (e.g. "contraction mapping", "induction", "Lyapunov")',
        },
      },
      required: ['technique'],
    },
  },
]

// Extended tool definitions are co-located with their executors:
// - WEB_TOOLS, GITHUB_TOOLS, MATH_TOOLS, HF_TOOLS, ACADEMIC_TOOLS → ./tools/external-tools.ts
// - CITATION_TOOLS, DATA_TOOLS, INFRA_TOOLS → ./tools/paper-tools.ts
// Re-export for backward compatibility with existing importers.
export {
  WEB_TOOLS, GITHUB_TOOLS, MATH_TOOLS, HF_TOOLS, ACADEMIC_TOOLS,
} from './tools/external-tools'
export {
  CITATION_TOOLS, DATA_TOOLS, INFRA_TOOLS,
} from './tools/paper-tools'


/** Initialize DKP loader for agent tool execution. Called by orchestrator. */
export function initAgentDKP(state: ResearchState, packsDir?: string): void {
  setActiveDKPLoader(createDKPLoaderForState(state, packsDir))
}

/**
 * Initialize DKP loader for a conversation-mode session.
 * Takes a pack ID directly (from SessionState.knowledge_pack_id) instead of
 * requiring a ResearchState. Uses the same activeDKPLoader global — safe because
 * Bun is single-threaded and ChatManager.processing prevents concurrent execution.
 * Same pattern as setActiveWorkingDir().
 */
export function initDKPForSession(packId: string | null, packsDir?: string): void {
  if (!packId) {
    setActiveDKPLoader(null)
    return
  }
  const loader = new DKPLoader(packsDir)
  try {
    loader.load(packId)
    setActiveDKPLoader(loader)
  } catch (err) {
    setActiveDKPLoader(null)
    console.warn(`[DKP] Failed to load pack "${packId}":`, (err as Error).message)
  }
}

/** Get the active DKPLoader instance — from context if available, else legacy global. */
export function getActiveDKPLoader(): DKPLoader | null {
  return getEffectiveDKPLoader()
}

/**
 * Create a DKP loader for a research state WITHOUT setting the global.
 * Used by executionContext-based parallel execution.
 */
function createDKPLoaderForState(state: ResearchState, packsDir?: string): DKPLoader | null {
  const packIds = state.loaded_knowledge_packs ?? []
  if (packIds.length === 0) return null
  const loader = new DKPLoader(packsDir)
  let loadedAny = false
  for (const packId of packIds) {
    try {
      loader.load(packId)
      loadedAny = true
    } catch {
      // Pack not found on disk — skip
    }
  }
  return loadedAny ? loader : null
}


/** Check if DK tools should be included for this agent. */
function shouldIncludeDKTools(agentName: string): boolean {
  const loader = getEffectiveDKPLoader()
  if (!loader || loader.getLoadedPacks().length === 0)
    return false
  // Per knowledge.md spec: math-reasoner, investigator, experiment-runner, fragment-writer
  const dkAgents = [
    'math-reasoner',
    'investigator',
    'experiment-runner',
    'fragment-writer',
    'data-scout',
    'result-analyzer',
  ]
  return dkAgents.includes(agentName)
}

/**
 * Map agent names to extended tool sets beyond BASE_TOOLS + RESEARCH_TOOLS.
 * Each agent gets the tools relevant to its role in the research pipeline.
 */
const AGENT_EXTENDED_TOOLS: Record<string, ToolDefinition[][]> = {
  // investigator: literature search across all sources + web/github for implementations
  'investigator': [WEB_TOOLS, GITHUB_TOOLS, ACADEMIC_TOOLS, HF_TOOLS],
  // data-scout: find datasets, models, implementations
  'data-scout': [WEB_TOOLS, GITHUB_TOOLS, HF_TOOLS, ACADEMIC_TOOLS, DATA_TOOLS],
  // result-analyzer: analyze data, create plots, compute math
  'result-analyzer': [DATA_TOOLS, MATH_TOOLS],
  // fragment-writer: LaTeX/BibTeX management, math for proofs
  'fragment-writer': [CITATION_TOOLS, MATH_TOOLS],
  // math-reasoner: symbolic math + data analysis
  'math-reasoner': [MATH_TOOLS, DATA_TOOLS],
  // experiment-runner: docker for isolated experiments, data analysis, plotting
  'experiment-runner': [DATA_TOOLS, INFRA_TOOLS, MATH_TOOLS],
  // latex-compiler: LaTeX compilation and checking
  'latex-compiler': [CITATION_TOOLS],
  // paper-assembler: citation management
  'paper-assembler': [CITATION_TOOLS],
}

/** Get tools for an agent, respecting the template's tools field when available */
function getAgentTools(
  agentName: string,
  templateTools?: string[],
): ToolDefinition[] {
  // DK tools are included automatically when packs are loaded and agent qualifies
  const dkTools = shouldIncludeDKTools(agentName) ? DK_TOOLS : []
  // math-reasoner: dk_search, dk_expand, dk_navigate, dk_find_technique (all 4)
  // investigator: dk_search, dk_expand, dk_navigate (no dk_find_technique)
  // experiment-runner: dk_search only
  // fragment-writer: dk_search, dk_expand
  let filteredDK = dkTools
  if (dkTools.length > 0) {
    switch (agentName) {
      case 'experiment-runner':
      case 'data-scout':
      case 'result-analyzer':
        filteredDK = dkTools.filter(t => t.name === 'dk_search')
        break
      case 'fragment-writer':
        filteredDK = dkTools.filter(
          t => t.name === 'dk_search' || t.name === 'dk_expand',
        )
        break
      case 'investigator':
        filteredDK = dkTools.filter(t => t.name !== 'dk_find_technique')
        break
      // math-reasoner gets all 4
    }
  }

  // Extended tools for this agent (role-based)
  const extendedArrays = AGENT_EXTENDED_TOOLS[agentName] ?? []
  const extendedTools = extendedArrays.flat()

  // All known tool arrays for template matching
  const allToolArrays = [
    ...BASE_TOOLS, ...RESEARCH_TOOLS, ...DK_TOOLS,
    ...WEB_TOOLS, ...GITHUB_TOOLS, ...MATH_TOOLS,
    ...HF_TOOLS, ...ACADEMIC_TOOLS, ...CITATION_TOOLS,
    ...DATA_TOOLS, ...INFRA_TOOLS,
  ]

  // If the agent template specifies tools, filter to those + base tools
  if (templateTools && templateTools.length > 0) {
    const requestedNames = new Set(templateTools.map(t => t.toLowerCase()))

    // Always include base tools; add requested tools from all known arrays
    const selectedTools = [...BASE_TOOLS]
    for (const tool of allToolArrays) {
      if (requestedNames.has(tool.name) && !selectedTools.find(t => t.name === tool.name)) {
        selectedTools.push(tool)
      }
    }
    // Add DK tools matching request or all filtered DK tools if agent qualifies
    for (const tool of filteredDK) {
      if (requestedNames.has(tool.name) || !requestedNames.has('dk_search')) {
        if (!selectedTools.find(t => t.name === tool.name)) {
          selectedTools.push(tool)
        }
      }
    }
    // If template requested any tool names not in our registry,
    // include all research + extended tools (template may use generic names)
    const hasUnknown = templateTools.some(
      t => !allToolArrays.find(at => at.name === t.toLowerCase()),
    )
    if (hasUnknown) {
      return [...BASE_TOOLS, ...RESEARCH_TOOLS, ...extendedTools, ...filteredDK]
    }
    return selectedTools
  }

  // Fallback: infer from agent name
  const researchAgents = [
    'investigator',
    'data-scout',
    'result-analyzer',
    'fragment-writer',
  ]
  if (researchAgents.includes(agentName) || extendedTools.length > 0) {
    return [...BASE_TOOLS, ...RESEARCH_TOOLS, ...extendedTools, ...filteredDK]
  }
  return [...BASE_TOOLS, ...filteredDK]
}

// ── Tool Execution ──────────────────────────────────────

export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<string> {
  switch (toolName) {
    case 'bash':
      return executeBash(
        toolInput.command as string,
        (toolInput.timeout_ms as number) ?? 60_000,
      )
    case 'read_file':
      return executeReadFile(toolInput.path as string)
    case 'write_file':
      return executeWriteFile(
        toolInput.path as string,
        toolInput.content as string,
      )
    case 'list_files':
      return executeListFiles(
        toolInput.pattern as string,
        toolInput.cwd as string | undefined,
      )
    case 'grep_content':
      return executeGrepContent(
        toolInput.pattern as string,
        toolInput.path as string | undefined,
        toolInput.glob as string | undefined,
      )
    case 'arxiv_search':
      return executeResearchTool('arxiv_search', toolInput)
    case 'semantic_scholar_search':
      return executeResearchTool('semantic_scholar_search', toolInput)
    case 'paperqa_query':
      return executeResearchTool('paperqa_query', toolInput)
    case 'paper_download':
      return executeResearchTool('paper_download', toolInput)
    case 'pdf_extract':
      return executeResearchTool('pdf_extract', toolInput)
    case 'dk_search':
      return executeDKSearch(toolInput)
    case 'dk_expand':
      return executeDKExpand(toolInput)
    case 'dk_navigate':
      return executeDKNavigate(toolInput)
    case 'dk_find_technique':
      return executeDKFindTechnique(toolInput)
    // Web tools
    case 'web_search':
      return executeWebSearch(toolInput)
    case 'web_fetch':
      return executeWebFetch(toolInput)
    // GitHub tools
    case 'github_search':
      return executeGitHubSearch(toolInput)
    case 'github_read_file':
      return executeGitHubReadFile(toolInput)
    case 'github_clone':
      return executeGitHubClone(toolInput)
    // Math tools
    case 'wolfram_alpha':
      return executeWolframAlpha(toolInput)
    case 'sympy_eval':
      return executeSympyEval(toolInput)
    // HuggingFace tools
    case 'hf_search_models':
      return executeHFSearchModels(toolInput)
    case 'hf_search_datasets':
      return executeHFSearchDatasets(toolInput)
    case 'hf_model_info':
      return executeHFModelInfo(toolInput)
    case 'hf_dataset_preview':
      return executeHFDatasetPreview(toolInput)
    // Academic tools
    case 'openalex_search':
      return executeOpenAlexSearch(toolInput)
    case 'dblp_search':
      return executeDblpSearch(toolInput)
    case 'image_analyze':
      return executeImageAnalyze(toolInput)
    // Citation tools
    case 'bibtex_lookup':
      return executeBibTeXLookup(toolInput)
    case 'bibtex_manage':
      return executeBibTeXManage(toolInput)
    case 'latex_compile':
      return executeLatexCompile(toolInput)
    case 'latex_check':
      return executeLatexCheck(toolInput)
    // Data tools
    case 'data_query':
      return executeDataQuery(toolInput)
    case 'plot_create':
      return executePlotCreate(toolInput)
    // Infrastructure tools
    case 'docker_run':
      return executeDockerRun(toolInput)
    case 'docker_build':
      return executeDockerBuild(toolInput)
    case 'docker_list':
      return executeDockerList(toolInput)
    case 'sqlite_query':
      return executeSQLiteQuery(toolInput)
    default:
      return `Error: Unknown tool "${toolName}"`
  }
}

async function executeBash(
  command: string,
  timeoutMs: number,
): Promise<string> {
  const clampedTimeout = Math.min(Math.max(timeoutMs, 1000), 300_000)
  const projectDir = getWorkingDir()

  try {
    // Sandbox: override HOME and TMPDIR so agents stay inside the project.
    // cd ~, $HOME, ~ expansions all resolve to the project directory.
    const sandboxEnv = {
      ...process.env,
      HOME: projectDir,
      TMPDIR: join(projectDir, '.tmp'),
    }

    const proc = Bun.spawn(['bash', '-c', command], {
      cwd: projectDir,
      stdout: 'pipe',
      stderr: 'pipe',
      env: sandboxEnv,
    })

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        proc.kill()
        reject(new Error(`Command timed out after ${clampedTimeout}ms`))
      }, clampedTimeout)
    })

    const resultPromise = (async () => {
      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      const exitCode = await proc.exited
      let output = ''
      if (stdout) output += stdout
      if (stderr) output += (output ? '\n--- stderr ---\n' : '') + stderr
      if (exitCode !== 0) {
        output += `\n[exit code: ${exitCode}]`
      }
      // Truncate very long output to avoid token explosion
      if (output.length > 50_000) {
        output =
          output.slice(0, 25_000) +
          '\n\n... [output truncated] ...\n\n' +
          output.slice(-25_000)
      }
      return output || '(no output)'
    })()

    return await Promise.race([resultPromise, timeoutPromise])
  } catch (error: any) {
    return `Error executing command: ${error.message}`
  }
}

function executeReadFile(filePath: string): string {
  try {
    const resolved = resolvePath(filePath)
    if (!existsSync(resolved)) {
      return `Error: File not found: ${resolved}`
    }
    const content = readFileSync(resolved, 'utf-8')
    // Truncate very large files
    if (content.length > 100_000) {
      return (
        content.slice(0, 50_000) +
        '\n\n... [file truncated, showing first 50000 chars] ...\n\n' +
        content.slice(-50_000)
      )
    }
    return content
  } catch (error: any) {
    return `Error reading file: ${error.message}`
  }
}

function executeWriteFile(filePath: string, content: string): string {
  try {
    const resolved = resolvePath(filePath)
    const dir = dirname(resolved)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(resolved, content, 'utf-8')
    return `Successfully wrote ${content.length} bytes to ${resolved}`
  } catch (error: any) {
    return `Error writing file: ${error.message}`
  }
}

async function executeListFiles(
  pattern: string,
  cwd?: string,
): Promise<string> {
  try {
    const searchDir = cwd ? resolvePath(cwd) : getWorkingDir()
    const glob = new Glob(pattern)
    const matches: string[] = []
    for await (const file of glob.scan({ cwd: searchDir, dot: false })) {
      matches.push(file)
      if (matches.length >= 500) {
        matches.push('... (truncated at 500 results)')
        break
      }
    }
    if (matches.length === 0) {
      return `No files matching "${pattern}" found in ${searchDir}`
    }
    return matches.join('\n')
  } catch (error: any) {
    return `Error listing files: ${error.message}`
  }
}

async function executeGrepContent(
  pattern: string,
  path?: string,
  glob?: string,
): Promise<string> {
  try {
    const searchDir = path ? resolvePath(path) : getWorkingDir()
    const args = ['rg', '--max-count=50', '--line-number']
    if (glob) args.push('--glob', glob)
    args.push(pattern, searchDir)

    const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' })
    const stdout = await new Response(proc.stdout).text()
    const exitCode = await proc.exited
    if (exitCode === 1) return `No matches found for "${pattern}"`
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      return `Error: ${stderr}`
    }
    if (stdout.length > 50_000) {
      return stdout.slice(0, 50_000) + '\n... [truncated]'
    }
    return stdout || 'No matches found'
  } catch (error: any) {
    return `Error searching: ${error.message}`
  }
}

async function executeResearchTool(
  toolName: string,
  input: Record<string, unknown>,
): Promise<string> {
  // Research tools delegate to existing Python scripts / CLI tools
  try {
    switch (toolName) {
      case 'arxiv_search': {
        const query = input.query as string
        const maxResults = (input.max_results as number) ?? 10
        const categories = (input.categories as string) ?? ''
        const scriptPath = join(
          process.cwd(),
          'src/tools/paper/scripts/arxiv_search.py',
        )
        if (!existsSync(scriptPath)) {
          // Fallback to curl-based arXiv API
          const encodedQuery = encodeURIComponent(query)
          const url = `http://export.arxiv.org/api/query?search_query=all:${encodedQuery}&max_results=${maxResults}`
          const proc = Bun.spawn(['curl', '-s', url], {
            stdout: 'pipe',
            stderr: 'pipe',
          })
          const stdout = await new Response(proc.stdout).text()
          return stdout.length > 50_000
            ? stdout.slice(0, 50_000) + '\n... [truncated]'
            : stdout
        }
        const args = [
          'python3',
          scriptPath,
          '--query',
          query,
          '--max-results',
          String(maxResults),
        ]
        if (categories) args.push('--categories', categories)
        const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' })
        const stdout = await new Response(proc.stdout).text()
        const exitCode = await proc.exited
        if (exitCode !== 0) {
          const stderr = await new Response(proc.stderr).text()
          return `arXiv search error: ${stderr}`
        }
        return stdout || 'No results found'
      }
      case 'semantic_scholar_search': {
        const query = input.query as string
        const action = (input.action as string) ?? 'search'
        const paperId = input.paper_id as string | undefined
        const maxResults = (input.max_results as number) ?? 10
        const s2Key = process.env.S2_API_KEY ?? ''
        const s2Headers: Record<string, string> = {}
        if (s2Key) s2Headers['x-api-key'] = s2Key

        const fields = 'title,authors,year,abstract,citationCount'
        let s2Url: string
        if (action === 'citations' && paperId) {
          s2Url = `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(paperId)}/citations?limit=${maxResults}&fields=${fields}`
        } else if (action === 'references' && paperId) {
          s2Url = `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(paperId)}/references?limit=${maxResults}&fields=${fields}`
        } else {
          const encodedQuery = encodeURIComponent(query)
          s2Url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodedQuery}&limit=${maxResults}&fields=${fields},url`
        }
        const s2Resp = await fetch(s2Url, { headers: s2Headers })
        if (!s2Resp.ok) return `Semantic Scholar API error: ${s2Resp.status} ${s2Resp.statusText}`
        return await s2Resp.text()
      }
      case 'paperqa_query': {
        const query = input.query as string
        const action = (input.action as string) ?? 'ask'
        const litDir = join(getWorkingDir(), 'literature')
        const proc = Bun.spawn(['pqa', action, query, '--directory', litDir], {
          stdout: 'pipe',
          stderr: 'pipe',
          env: { ...process.env },
        })
        const stdout = await new Response(proc.stdout).text()
        const exitCode = await proc.exited
        if (exitCode !== 0) {
          const stderr = await new Response(proc.stderr).text()
          return `PaperQA error (is paper-qa installed?): ${stderr}`
        }
        return stdout || 'No results'
      }
      case 'paper_download': {
        const url = input.url as string
        const outputDir = resolvePath(
          (input.output_dir as string) ?? 'literature/papers'
        )
        mkdirSync(outputDir, { recursive: true })
        const filename =
          (input.paper_id as string)?.replace(/[^a-zA-Z0-9.-]/g, '_') ?? 'paper'
        const outputPath = join(outputDir, `${filename}.pdf`)
        const proc = Bun.spawn(['curl', '-sL', '-o', outputPath, url], {
          stdout: 'pipe',
          stderr: 'pipe',
        })
        const exitCode = await proc.exited
        if (exitCode !== 0) {
          return `Download failed for ${url}`
        }
        return existsSync(outputPath)
          ? `Downloaded to ${outputPath}`
          : `Download failed — file not created`
      }
      case 'pdf_extract': {
        const pdfPath = resolvePath(input.pdf_path as string)
        if (!existsSync(pdfPath)) {
          return `PDF file not found: ${pdfPath}`
        }
        const outputDir = resolvePath(
          (input.output_dir as string) ??
          pdfPath.replace(/\.pdf$/i, '') + '_extracted'
        )
        mkdirSync(outputDir, { recursive: true })
        const scriptPath = join(
          import.meta.dir,
          '..',
          'tools',
          'paper',
          'scripts',
          'extract_pdf.py',
        )
        const proc = Bun.spawn(
          ['python3', scriptPath, pdfPath, '--output-dir', outputDir],
          { stdout: 'pipe', stderr: 'pipe' },
        )
        const stdout = await new Response(proc.stdout).text()
        const exitCode = await proc.exited
        if (exitCode !== 0) {
          const stderr = await new Response(proc.stderr).text()
          return `PDF extraction failed: ${stderr}`
        }
        // Read the extraction result JSON
        const resultPath = join(outputDir, 'extraction.json')
        if (existsSync(resultPath)) {
          const content = readFileSync(resultPath, 'utf-8')
          const result = JSON.parse(content)
          return `Extracted from ${pdfPath}:\n- Text length: ${result.text?.length ?? 0} chars\n- Figures: ${result.figures?.length ?? 0}\n- References: ${result.references?.length ?? 0}\n\nFull extraction saved to: ${resultPath}`
        }
        return stdout || 'Extraction completed but no result file found'
      }
      default:
        return `Unknown research tool: ${toolName}`
    }
  } catch (error: any) {
    return `Research tool error (${toolName}): ${error.message}`
  }
}

// ── Domain Knowledge Tool Execution ──────────────────────

function executeDKSearch(input: Record<string, unknown>): string {
  const activeDKPLoader = getEffectiveDKPLoader()
  if (!activeDKPLoader) return 'No knowledge packs loaded.'

  const query = (input.query as string) ?? ''
  const typeFilter = input.type as string | undefined
  const maxResults = (input.max_results as number) ?? 5

  const packs = activeDKPLoader.getLoadedPacks()
  const keywords = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2)

  const scored = new Map<string, { score: number; packId: string }>()

  for (const pack of packs) {
    // Strategy 1: full-text index keyword matching
    for (const kw of keywords) {
      const ids = pack.indices.fullText[kw]
      if (!ids) continue
      for (const id of ids) {
        const existing = scored.get(id)
        if (existing) {
          existing.score++
        } else {
          scored.set(id, { score: 1, packId: pack.manifest.id })
        }
      }
    }

    // Strategy 2: topic/tag matching
    for (const kw of keywords) {
      const ids = pack.indices.byTopic[kw]
      if (!ids) continue
      for (const id of ids) {
        const existing = scored.get(id)
        if (existing) {
          existing.score += 2 // Tags are more specific, weight higher
        } else {
          scored.set(id, { score: 2, packId: pack.manifest.id })
        }
      }
    }
  }

  // Sort by score, take top N
  let candidates = Array.from(scored.entries()).sort(
    (a, b) => b[1].score - a[1].score,
  )

  // Type filter
  if (typeFilter) {
    const filtered: typeof candidates = []
    for (const [id, meta] of candidates) {
      if (id.startsWith(typeFilter.slice(0, 3) + '-')) {
        filtered.push([id, meta])
      } else {
        // Check actual entry type
        const entry = activeDKPLoader.getEntry(meta.packId, id)
        if (entry && entry.type === typeFilter) {
          filtered.push([id, meta])
        }
      }
    }
    candidates = filtered
  }

  const topIds = candidates.slice(0, maxResults)
  if (topIds.length === 0) {
    return `No entries found for query: "${query}"`
  }

  const totalSearched = packs.reduce(
    (s, p) => s + p.manifest.stats.entries_total,
    0,
  )
  const lines = [
    `Found ${topIds.length} entries (searched ${totalSearched} total):\n`,
  ]

  for (const [id, meta] of topIds) {
    const entry = activeDKPLoader.getEntry(meta.packId, id)
    if (!entry) continue
    lines.push(`[${entry.id}] ${entry.label} (${entry.source.id})`)
    lines.push(`  Type: ${entry.type} | ${entry.name}`)
    lines.push(
      `  ${entry.statement.slice(0, 150)}${entry.statement.length > 150 ? '...' : ''}`,
    )
    lines.push(`  Tags: ${entry.tags.join(', ')}`)
    lines.push(`  -> dk_expand("${entry.id}") for full details\n`)
  }

  return lines.join('\n')
}

function executeDKExpand(input: Record<string, unknown>): string {
  const activeDKPLoader = getEffectiveDKPLoader()
  if (!activeDKPLoader) return 'No knowledge packs loaded.'

  const entryId = (input.entry_id as string) ?? ''
  const includeProof = (input.include_proof as boolean) ?? false

  // Search all loaded packs for this entry
  let entry: KnowledgeEntry | null = null
  for (const pack of activeDKPLoader.getLoadedPacks()) {
    entry = activeDKPLoader.getEntry(pack.manifest.id, entryId)
    if (entry) break
  }

  if (!entry) {
    return `Entry "${entryId}" not found in any loaded knowledge pack.`
  }

  let output = `## ${entry.label}: ${entry.name}\n`
  output += `Source: ${entry.source.id}, Ch.${entry.source.chapter}, p.${entry.source.page}\n`
  output += `Type: ${entry.type} | Difficulty: ${entry.proof_difficulty ?? 'n/a'}\n\n`

  output += `### Statement\n${entry.statement}\n\n`

  if (entry.assumptions && entry.assumptions.length > 0) {
    output += `### Assumptions\n`
    for (const a of entry.assumptions) {
      output += `- (${a.id}) ${a.text} [${a.strength}]\n`
    }
    output += '\n'
  }

  if (includeProof && entry.proof_sketch) {
    output += `### Proof Sketch\n${entry.proof_sketch}\n`
    output += `Technique: ${entry.proof_technique ?? 'unspecified'}\n\n`
  }

  if (entry.pseudocode) {
    output += `### Algorithm\n${entry.pseudocode}\n`
    if (entry.complexity) output += `Complexity: ${entry.complexity}\n`
    if (entry.inputs) output += `Inputs: ${entry.inputs}\n`
    if (entry.outputs) output += `Outputs: ${entry.outputs}\n`
    output += '\n'
  }

  if (entry.usability) {
    output += `### Usability\n`
    output += `Citable: ${entry.usability.citable ? 'Yes' : 'No'}`
    if (entry.usability.cite_as) output += ` (${entry.usability.cite_as})`
    output += '\n'
    output += `Common use: ${entry.usability.common_use}\n`
    if (entry.usability.adaptation_notes) {
      output += `Adaptation: ${entry.usability.adaptation_notes}\n`
    }
  }

  if (entry.relations) {
    output += `\n### Relations\n`
    if (entry.relations.depends_on.length > 0)
      output += `Depends on: ${entry.relations.depends_on.join(', ')}\n`
    if (entry.relations.used_by.length > 0)
      output += `Used by: ${entry.relations.used_by.join(', ')}\n`
    if (entry.relations.generalizes)
      output += `Generalizes: ${entry.relations.generalizes}\n`
    if (entry.relations.specialized_by.length > 0)
      output += `Specialized by: ${entry.relations.specialized_by.join(', ')}\n`
  }

  return output
}

function executeDKNavigate(input: Record<string, unknown>): string {
  const activeDKPLoader = getEffectiveDKPLoader()
  if (!activeDKPLoader) return 'No knowledge packs loaded.'

  const entryId = (input.entry_id as string) ?? ''
  const direction = (input.direction as string) ?? 'related'

  // Find the entry and its pack
  let entry: KnowledgeEntry | null = null
  let packId = ''
  for (const pack of activeDKPLoader.getLoadedPacks()) {
    entry = activeDKPLoader.getEntry(pack.manifest.id, entryId)
    if (entry) {
      packId = pack.manifest.id
      break
    }
  }

  if (!entry) {
    return `Entry "${entryId}" not found in any loaded knowledge pack.`
  }

  let targetIds: string[] = []

  switch (direction) {
    case 'prerequisites':
      targetIds = entry.relations.depends_on
      break
    case 'dependents':
      targetIds = entry.relations.used_by
      break
    case 'related': {
      const connections = activeDKPLoader.getConnections(packId)
      targetIds = connections.edges
        .filter(e => e.from === entryId || e.to === entryId)
        .map(e => (e.from === entryId ? e.to : e.from))
      break
    }
    case 'siblings': {
      // Same source + chapter
      const pack = activeDKPLoader.getLoadedPack(packId)
      if (pack) {
        const sourceEntryIds = pack.indices.bySource[entry.source.id] ?? []
        targetIds = sourceEntryIds.filter(id => {
          if (id === entryId) return false
          const other = activeDKPLoader!.getEntry(packId, id)
          return other && other.source.chapter === entry!.source.chapter
        })
      }
      break
    }
  }

  if (targetIds.length === 0) {
    return `No ${direction} found for entry "${entryId}".`
  }

  const entries = activeDKPLoader.getEntries(packId, targetIds)
  const lines = [`${direction} of [${entryId}] (${entries.length} entries):\n`]
  for (const e of entries) {
    lines.push(
      `[${e.id}] ${e.label}: ${e.statement.slice(0, 100)}${e.statement.length > 100 ? '...' : ''}`,
    )
  }

  return lines.join('\n')
}

function executeDKFindTechnique(input: Record<string, unknown>): string {
  const activeDKPLoader = getEffectiveDKPLoader()
  if (!activeDKPLoader) return 'No knowledge packs loaded.'

  const technique = ((input.technique as string) ?? '').toLowerCase()
  if (!technique) return 'Error: technique parameter is required.'

  const results: KnowledgeEntry[] = []

  for (const pack of activeDKPLoader.getLoadedPacks()) {
    const theoremIds = [
      ...(pack.indices.byType.theorem ?? []),
      ...(pack.indices.byType.proposition ?? []),
      ...(pack.indices.byType.lemma ?? []),
    ]
    const entries = activeDKPLoader.getEntries(pack.manifest.id, theoremIds)
    for (const entry of entries) {
      if (
        entry.proof_technique &&
        entry.proof_technique.toLowerCase().includes(technique)
      ) {
        results.push(entry)
      }
    }
  }

  if (results.length === 0) {
    return `No theorems found using technique: "${technique}"`
  }

  const lines = [`Found ${results.length} theorems using "${technique}":\n`]
  for (const r of results) {
    lines.push(`[${r.id}] ${r.label}: ${r.name}`)
    lines.push(`  Technique: ${r.proof_technique}`)
    if (r.proof_sketch) lines.push(`  Sketch: ${r.proof_sketch}`)
    lines.push(`  -> dk_expand("${r.id}") for full details\n`)
  }

  return lines.join('\n')
}

// ── Progress Reporting Helpers ───────────────────────────

function formatToolProgress(
  toolName: string,
  input: Record<string, unknown>,
): string {
  switch (toolName) {
    case 'arxiv_search':
      return `searching arXiv: "${(input.query as string)?.slice(0, 60)}"`
    case 'semantic_scholar_search': {
      const action = (input.action as string) ?? 'search'
      const query = (input.query as string) ?? ''
      return action === 'search'
        ? `searching Semantic Scholar: "${query.slice(0, 60)}"`
        : `fetching ${action} for paper ${(input.paper_id as string)?.slice(0, 20)}`
    }
    case 'paperqa_query':
      return `querying PaperQA: "${(input.query as string)?.slice(0, 60)}"`
    case 'paper_download':
      return `downloading paper: ${(input.url as string)?.slice(0, 60)}`
    case 'pdf_extract':
      return `extracting PDF: ${basename((input.pdf_path as string) ?? '')}`
    case 'bash':
      return `running: ${(input.command as string)?.slice(0, 80)}`
    case 'read_file':
      return `reading: ${basename((input.path as string) ?? '')}`
    case 'write_file':
      return `writing: ${basename((input.path as string) ?? '')}`
    case 'list_files':
      return `listing: ${(input.pattern as string) ?? '*'}`
    case 'grep_content':
      return `searching for: "${(input.pattern as string)?.slice(0, 40)}"`
    case 'dk_search':
      return `searching knowledge: "${(input.query as string)?.slice(0, 60)}"`
    case 'dk_expand':
      return `expanding entry: ${(input.entry_id as string) ?? ''}`
    case 'dk_navigate':
      return `navigating ${(input.direction as string) ?? ''}: ${(input.entry_id as string) ?? ''}`
    case 'dk_find_technique':
      return `finding technique: "${(input.technique as string)?.slice(0, 40)}"`
    case 'hf_search_models':
      return `searching HuggingFace models: "${(input.query as string)?.slice(0, 50)}"`
    case 'hf_search_datasets':
      return `searching HuggingFace datasets: "${(input.query as string)?.slice(0, 50)}"`
    case 'hf_model_info':
      return `fetching model info: ${(input.model_id as string) ?? ''}`
    case 'hf_dataset_preview':
      return `previewing dataset: ${(input.dataset_id as string) ?? ''}`
    case 'openalex_search':
      return `searching OpenAlex: "${(input.query as string)?.slice(0, 50)}"`
    case 'dblp_search':
      return `searching DBLP: "${(input.query as string)?.slice(0, 50)}"`
    case 'image_analyze':
      return `analyzing image: ${basename((input.image_path as string) ?? '')}`
    case 'bibtex_lookup':
      return `looking up BibTeX: ${(input.arxiv_id as string) ?? (input.doi as string) ?? (input.s2_id as string) ?? ''}`
    case 'bibtex_manage':
      return `BibTeX ${(input.action as string) ?? 'manage'}: ${basename((input.bib_path as string) ?? 'references.bib')}`
    case 'latex_compile':
      return `compiling LaTeX: ${basename((input.tex_file as string) ?? 'main.tex')}`
    case 'latex_check':
      return `checking LaTeX: ${basename((input.tex_file as string) ?? '')}`
    case 'data_query':
      return `running SQL query`
    case 'plot_create':
      return `creating ${(input.chart_type as string) ?? 'chart'}`
    case 'docker_run':
      return `running in Docker: ${(input.image as string) ?? ''}`
    case 'docker_build':
      return `building Docker image: ${(input.tag as string) ?? ''}`
    case 'docker_list':
      return `listing Docker images/containers`
    case 'sqlite_query':
      return `querying SQLite: ${basename((input.db_path as string) ?? '')}`
    default:
      return toolName
  }
}

function summarizeToolResult(
  toolName: string,
  input: Record<string, unknown>,
  result: string,
): string | null {
  switch (toolName) {
    case 'arxiv_search':
    case 'semantic_scholar_search': {
      // Count papers found
      const paperCount =
        (result.match(/"title"/g) || []).length ||
        (result.match(/Title:/g) || []).length
      if (paperCount > 0) {
        return `  found ${paperCount} paper(s)`
      }
      if (result.includes('0 results') || result.includes('No papers')) {
        return `  no papers found`
      }
      return null
    }
    case 'bash': {
      const lines = result.split('\n').filter(l => l.trim()).length
      const exitMatch = result.match(/\[exit code: (\d+)\]/)
      if (exitMatch && exitMatch[1] !== '0') {
        return `  command failed (exit ${exitMatch[1]})`
      }
      if (lines > 0) {
        return `  ${lines} line(s) of output`
      }
      return null
    }
    case 'write_file':
      return `  wrote ${basename((input.path as string) ?? '')}`
    case 'paper_download':
      if (result.includes('Downloaded to')) {
        return `  download complete`
      }
      if (result.includes('failed')) {
        return `  download failed`
      }
      return null
    case 'pdf_extract':
      if (result.includes('Text length:')) {
        return `  extraction complete`
      }
      return null
    case 'dk_search': {
      const foundMatch = result.match(/Found (\d+) entries/)
      if (foundMatch) return `  found ${foundMatch[1]} entries`
      if (result.includes('No entries found')) return `  no entries found`
      return null
    }
    case 'dk_expand':
      if (result.includes('not found')) return `  entry not found`
      return `  expanded entry`
    case 'dk_navigate': {
      const navMatch = result.match(/\((\d+) entries\)/)
      if (navMatch) return `  found ${navMatch[1]} connected entries`
      return null
    }
    case 'dk_find_technique': {
      const techMatch = result.match(/Found (\d+) theorems/)
      if (techMatch) return `  found ${techMatch[1]} theorems`
      if (result.includes('No theorems found')) return `  no theorems found`
      return null
    }
    default:
      return null
  }
}

// ── Agent Execution (Multi-Turn Tool Loop) ──────────────

const MAX_TOOL_ROUNDS = 20

/**
 * Execute an agent by loading its template and running a multi-turn
 * tool-use conversation with the LLM. The agent can execute bash commands,
 * read/write files, and list files to accomplish its task.
 */
export async function executeAgent(
  agentName: string,
  task: string,
  context: string,
  state: ResearchState,
  onProgress?: (message: string) => void,
  sessionDir?: string,
): Promise<ExecutionResult> {
  const template = loadAgentTemplate(agentName)
  if (!template) {
    const available = listAvailableAgents()
    return {
      success: false,
      agent: agentName,
      summary: `Agent "${agentName}" not found. Available: ${available.join(', ')}`,
      artifacts_produced: [],
      new_claims: [],
      new_evidence: [],
      cost_usd: 0,
    }
  }

  const stateContext = buildStateContext(state)

  // Resolve model spec (preserves provider for multi-model routing)
  const modelSpec = resolveModelSpec(template.model)
  const tools = getAgentTools(agentName, template.tools)

  // Resolve the working directory: session dir if available, else cwd
  const workingDir = sessionDir ?? process.cwd()

  // Create scoped execution context for this agent — provides isolated
  // workingDir and dkpLoader via AsyncLocalStorage, safe for parallel dispatch.
  const ctx: ExecutionContext = {
    workingDir,
    dkpLoader: createDKPLoaderForState(state),
  }

  return executionContext.run(ctx, async () => {
  // NOTE: Legacy globals (activeWorkingDir, activeDKPLoader) are NOT set here.
  // All tool executors use getWorkingDir() and getEffectiveDKPLoader() which
  // read from AsyncLocalStorage context first, making parallel dispatch safe.

  const systemPrompt = `${template.systemPrompt}

## Working Directory
All files you create should be relative to: ${workingDir}
Key directories:
- fragments/ — LaTeX fragments (proofs/, derivations/, algorithms/, definitions/, experiments/, related_work/, figures/, tables/)
- literature/papers/ — downloaded PDFs
- literature/notes/ — investigation notes
- experiments/ — experiment code and results
- data/ — datasets

## Current Research State
${stateContext}`

  const hasResearchTools = tools.length > BASE_TOOLS.length

  const literatureInstructions = hasResearchTools
    ? `
## Literature Research Instructions
You have access to research tools: arxiv_search, semantic_scholar_search, paperqa_query, paper_download, pdf_extract.

IMPORTANT — When you find relevant papers:
1. **Download them** using paper_download. Save to the project's literature/papers/ directory.
2. **Extract key findings** by reading the downloaded PDF (use pdf_extract or read_file).
3. **Write investigation notes** using write_file — save to literature/notes/ with a descriptive filename (e.g., "literature/notes/diffusion_sampling_survey.md").
4. **Record all papers found** in the "papers_found" field of your output JSON.
5. **Record known results** (citable findings from literature) in the "known_results" field.
6. **Record citations** with BibTeX entries in the "citations" field.

Do NOT just search and report — actually download, read, and save findings to disk.`
    : ''

  const userMessage = `## Task
${task}

## Context
${context}

## Instructions
Complete this task using the tools available to you. You can execute shell commands, read and write files, and list directory contents.${hasResearchTools ? ' You also have access to research tools — see Literature Research Instructions below.' : ''}
${literatureInstructions}

When you have finished, provide your final results in the following JSON format in your last message:

\`\`\`json
{
  "summary": "Brief summary of what was accomplished",
  "artifacts": ["list of artifact paths or descriptions produced"],
  "new_claims": [{"type": "hypothesis|assumption|observation|empirical|theorem|algorithmic|novelty|benchmark|limitation", "epistemicLayer": "observation|explanation|exploitation|justification", "statement": "...", "confidence": 0.8, "evidenceType": "theorem_support|empirical_support|heuristic_motivation|ablation_support|consistent_with|no_support", "vulnerabilityScore": 0.3}],
  "new_evidence": [{"claim_statement": "the claim this evidence supports", "kind": "grounded|derived", "method": "experiment|proof|computation|simulation|literature", "source_ref": "artifact path or citation key"}]${
    hasResearchTools
      ? `,
  "papers_found": [{"paper_id": "arxiv_id_or_doi", "title": "Paper Title", "url": "https://...", "abstract": "...", "downloaded_path": "literature/papers/filename.pdf"}],
  "known_results": [{"statement": "Key finding from literature", "source": "citation_key", "confidence": 0.9, "directly_usable": true}],
  "citations": [{"key": "author2024title", "bibtex": "@article{...}"}]`
      : ''
  }
}
\`\`\``

  try {
    // Build conversation messages for the unified API
    const messages: UnifiedMessage[] = [{ role: 'user', content: userMessage }]

    let totalInputTokens = 0
    let totalOutputTokens = 0
    let finalText = ''

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await chatCompletion({
        modelSpec,
        messages,
        system: systemPrompt,
        max_tokens: 16384,
        tools,
      })

      // Accumulate token usage
      totalInputTokens += response.input_tokens
      totalOutputTokens += response.output_tokens

      // Collect text from this response
      if (response.text) {
        finalText = finalText ? finalText + '\n' + response.text : response.text
      }

      // Check if we need to handle tool calls
      if (response.stop_reason !== 'tool_use' || !response.tool_calls?.length) {
        // Agent is done
        break
      }

      // Execute tool calls and collect results
      const toolResultParts: string[] = []
      for (const tc of response.tool_calls) {
        // No need to re-set globals per tool call — executionContext.run() provides
        // isolated workingDir and dkpLoader via AsyncLocalStorage, safe across awaits.

        // Report progress: what tool is being called and with what input
        if (onProgress) {
          const toolLabel = formatToolProgress(tc.name, tc.input)
          onProgress(`  ${agentName} → ${toolLabel}`)
        }
        const result = await executeTool(tc.name, tc.input)
        // Report tool result summary
        if (onProgress) {
          const resultSummary = summarizeToolResult(tc.name, tc.input, result)
          if (resultSummary) {
            onProgress(`  ${resultSummary}`)
          }
        }
        toolResultParts.push(`[Tool: ${tc.name}]\n${result}`)
      }

      // Append the assistant's response and tool results to the conversation
      // The unified API uses plain text messages, so we serialize tool results as text
      messages.push({
        role: 'assistant',
        content:
          (response.text ?? '') +
          (response.tool_calls
            ? '\n' +
              response.tool_calls.map(tc => `[calling ${tc.name}]`).join('\n')
            : ''),
      })
      messages.push({
        role: 'user',
        content: toolResultParts.join('\n\n---\n\n'),
      })
    }

    // Warn if we exhausted all tool rounds without the agent finishing naturally
    if (finalText && !finalText.includes('"summary"')) {
      // Agent exhausted tool rounds without completing — results may be incomplete
    }

    // Extract JSON result from the final text
    const jsonMatch = finalText.match(/```json\s*([\s\S]*?)\s*```/)
    const parsed = jsonMatch ? safeParseJSON(jsonMatch[1]) : null

    const costUsd = estimateCost(
      totalInputTokens,
      totalOutputTokens,
      modelSpec,
    )

    if (parsed) {
      return {
        success: true,
        agent: agentName,
        summary: parsed.summary ?? finalText.slice(0, 200),
        artifacts_produced: parsed.artifacts ?? [],
        new_claims: (parsed.new_claims ?? []).map((c: any) => ({
          type: c.type ?? 'hypothesis',
          epistemicLayer: c.epistemicLayer ?? 'explanation',
          statement: c.statement,
          confidence: c.confidence ?? 0.5,
          evidenceType: c.evidenceType ?? 'heuristic_motivation',
          vulnerabilityScore: c.vulnerabilityScore ?? 0.5,
        })),
        new_evidence: (parsed.new_evidence ?? []).map((e: any) => ({
          claim_statement: e.claim_statement ?? '',
          kind: e.kind ?? 'derived',
          method: e.method,
          source_ref: e.source_ref,
        })),
        literature_findings: parseLiteratureFindings(parsed),
        cost_usd: costUsd,
      }
    }

    // No structured JSON — salvage artifact info from conversation history
    const discoveredArtifacts: string[] = []
    for (const msg of messages) {
      if (msg.role !== 'user') continue
      const content =
        typeof msg.content === 'string' ? msg.content : String(msg.content)
      // Look for write_file tool results with file paths
      const writeMatches = content.matchAll(
        /\[Tool: write_file\]\n(?:.*?(?:wrote to|created|saved)\s+)([^\n]+)/gi,
      )
      for (const m of writeMatches) {
        discoveredArtifacts.push(m[1].trim())
      }
      // Look for "Successfully wrote N bytes to <path>"
      const successMatches = content.matchAll(
        /Successfully wrote \d+ bytes to ([^\n]+)/g,
      )
      for (const m of successMatches) {
        discoveredArtifacts.push(m[1].trim())
      }
      // Look for bash tool results that created files
      const bashWrites = content.matchAll(
        /\[Tool: bash\][\s\S]*?(?:wrote|created|saved)\s+([^\s\n]+\.(?:tex|py|csv|json|bib|pdf|png))/gi,
      )
      for (const m of bashWrites) {
        discoveredArtifacts.push(m[1].trim())
      }
    }

    // Extract summary from the last assistant message
    const lastAssistant = [...messages]
      .reverse()
      .find(m => m.role === 'assistant')
    const summaryText =
      typeof lastAssistant?.content === 'string'
        ? lastAssistant.content.slice(0, 500)
        : finalText.slice(0, 500)

    return {
      success: true,
      agent: agentName,
      summary: summaryText,
      artifacts_produced: discoveredArtifacts,
      new_claims: [],
      new_evidence: [],
      cost_usd: costUsd,
    }
  } catch (error: any) {
    return {
      success: false,
      agent: agentName,
      summary: `Agent execution failed: ${error.message}`,
      artifacts_produced: [],
      new_claims: [
        {
          type: 'limitation' as const,
          epistemicLayer: 'observation' as const,
          statement: `Agent ${agentName} failed: ${error.message}`,
          confidence: 0.9,
          evidenceType: 'empirical_support' as const,
          vulnerabilityScore: 0.1,
        },
      ],
      new_evidence: [],
      cost_usd: 0,
    }
  }

  }) // end executionContext.run()
}

/**
 * Execute multiple agents in parallel using Promise.allSettled.
 * Each agent runs in its own AsyncLocalStorage execution context,
 * so they can safely share the event loop without clobbering globals.
 *
 * Returns results in the same order as the input array.
 * Failed agents return error ExecutionResults rather than throwing.
 */
export async function executeAgentsParallel(
  agents: Array<{
    agentName: string
    task: string
    context: string
    state: ResearchState
    onProgress?: (message: string) => void
    sessionDir?: string
  }>,
): Promise<ExecutionResult[]> {
  const promises = agents.map(a =>
    executeAgent(a.agentName, a.task, a.context, a.state, a.onProgress, a.sessionDir),
  )

  const settled = await Promise.allSettled(promises)

  return settled.map((result, i) => {
    if (result.status === 'fulfilled') return result.value
    return {
      success: false,
      agent: agents[i].agentName,
      summary: `Parallel execution failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason ?? 'Unknown error')}`,
      artifacts_produced: [],
      new_claims: [],
      new_evidence: [],
      cost_usd: 0,
    }
  })
}

// ── Helpers ─────────────────────────────────────────────

function parseLiteratureFindings(
  parsed: any,
): ExecutionResult['literature_findings'] {
  const papersFound = parsed.papers_found ?? parsed.papers ?? []
  const knownResults = parsed.known_results ?? []
  const citations = parsed.citations ?? parsed.new_citations ?? []

  // Only return if there's actually data
  if (
    papersFound.length === 0 &&
    knownResults.length === 0 &&
    citations.length === 0
  ) {
    return undefined
  }

  return {
    papers_found: papersFound.map(
      (p: any): LiteratureFinding => ({
        paper_id: String(p.paper_id ?? p.id ?? ''),
        title: String(p.title ?? ''),
        url: p.url ? String(p.url) : undefined,
        abstract: p.abstract ? String(p.abstract) : undefined,
        downloaded_path: p.downloaded_path
          ? String(p.downloaded_path)
          : undefined,
      }),
    ),
    known_results: knownResults.map(
      (kr: any): KnownResultFinding => ({
        statement: String(kr.statement ?? ''),
        source: String(kr.source ?? ''),
        confidence: typeof kr.confidence === 'number' ? kr.confidence : 0.8,
        directly_usable: Boolean(kr.directly_usable ?? false),
      }),
    ),
    citations: citations.map(
      (c: any): CitationFinding => ({
        key: String(c.key ?? ''),
        bibtex: c.bibtex ? String(c.bibtex) : undefined,
      }),
    ),
  }
}

function safeParseJSON(text: string): any | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// Cost estimation now uses shared estimateCost() from llm-client.ts


// ── Test-only exports ────────────────────────────────────
export const __test__ = {
  executeDKSearch,
  executeDKExpand,
  executeDKNavigate,
  executeDKFindTechnique,
  getAgentTools,
  shouldIncludeDKTools,
  getActiveDKPLoader,
}
