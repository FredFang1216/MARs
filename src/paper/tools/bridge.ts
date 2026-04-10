/**
 * Tool Bridge — wraps existing tool definitions and executors into the
 * new ToolDef format without rewriting any tool implementation code.
 *
 * This is the key backward-compatibility layer:
 *   1. Takes the old ToolDefinition[] arrays and executeTool() function
 *   2. Creates ToolDef wrappers that delegate to the old executors
 *   3. Registers everything in the global ToolRegistry
 *
 * No existing code needs to change. The orchestrator, auto-mode, and
 * all agents continue to work identically.
 */

import { z } from 'zod'
import { buildTool, type ToolDef, type ToolCategory, type ToolResult } from './types'
import type { ToolDefinition } from './tool-context'
import { registry } from './registry'

// ── Read-only tools (safe for concurrent execution) ──────

const READ_ONLY_TOOLS = new Set([
  'read_file',
  'list_files',
  'grep_content',
  'arxiv_search',
  'semantic_scholar_search',
  'paperqa_query',
  'dk_search',
  'dk_expand',
  'dk_navigate',
  'dk_find_technique',
  'web_search',
  'openalex_search',
  'dblp_search',
  'hf_search_models',
  'hf_search_datasets',
  'hf_model_info',
  'hf_dataset_preview',
  'wolfram_alpha',
  'bibtex_lookup',
  'latex_check',
  'data_query',
  'docker_list',
  'sqlite_query',
])

// ── Destructive tools (irreversible changes) ─────────────

const DESTRUCTIVE_TOOLS = new Set([
  'docker_run',
  'docker_build',
])

// ── Tool name → category mapping ─────────────────────────

const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  // base
  bash: 'base',
  read_file: 'base',
  write_file: 'base',
  list_files: 'base',
  grep_content: 'base',
  // research
  arxiv_search: 'research',
  semantic_scholar_search: 'research',
  paperqa_query: 'research',
  paper_download: 'research',
  pdf_extract: 'research',
  // dk
  dk_search: 'dk',
  dk_expand: 'dk',
  dk_navigate: 'dk',
  dk_find_technique: 'dk',
  // web
  web_search: 'web',
  web_fetch: 'web',
  // github
  github_search: 'github',
  github_read_file: 'github',
  github_clone: 'github',
  // math
  wolfram_alpha: 'math',
  sympy_eval: 'math',
  // hf
  hf_search_models: 'hf',
  hf_search_datasets: 'hf',
  hf_model_info: 'hf',
  hf_dataset_preview: 'hf',
  // academic
  openalex_search: 'academic',
  dblp_search: 'academic',
  image_analyze: 'academic',
  // citation
  bibtex_lookup: 'citation',
  bibtex_manage: 'citation',
  latex_compile: 'citation',
  latex_check: 'citation',
  // data
  data_query: 'data',
  plot_create: 'data',
  sqlite_query: 'data',
  // infra
  docker_run: 'infra',
  docker_build: 'infra',
  docker_list: 'infra',
}

// ── Zod schema from JSON Schema ──────────────────────────

/**
 * Build a permissive Zod schema from the old ToolDefinition input_schema.
 * Uses z.coerce for number/boolean to match the old behavior where LLM
 * inputs were never validated — e.g., "5" coerces to 5, "true" to true.
 * Also allows any extra properties via .passthrough().
 */
function buildZodSchema(def: ToolDefinition): z.ZodType {
  const shape: Record<string, z.ZodTypeAny> = {}
  const required = new Set(def.input_schema.required ?? [])

  for (const [key, prop] of Object.entries(def.input_schema.properties)) {
    const p = prop as Record<string, unknown>
    let fieldSchema: z.ZodTypeAny

    switch (p.type) {
      case 'number':
        fieldSchema = z.coerce.number()
        break
      case 'boolean':
        fieldSchema = z.coerce.boolean()
        break
      case 'array':
        fieldSchema = z.array(z.unknown())
        break
      default:
        fieldSchema = z.coerce.string()
    }

    if (p.description) {
      fieldSchema = fieldSchema.describe(p.description as string)
    }
    if (!required.has(key)) {
      fieldSchema = fieldSchema.optional()
    }

    shape[key] = fieldSchema
  }

  return z.object(shape).passthrough()
}

// ── Bridge: wrap old tool into new ToolDef ────────────────

/**
 * Create a ToolDef wrapper around an existing ToolDefinition + executor.
 *
 * The executor is the old `executeTool(name, input) → string` function.
 * We wrap it so it conforms to the new ToolDef interface, gaining:
 *   - Zod input validation
 *   - isConcurrencySafe / isReadOnly / isDestructive declarations
 *   - Result budget control (via execution.ts)
 */
export function bridgeTool(
  def: ToolDefinition,
  executor: (name: string, input: Record<string, unknown>) => Promise<string>,
): ToolDef {
  const category = TOOL_CATEGORIES[def.name] ?? 'base'
  const isReadOnly = READ_ONLY_TOOLS.has(def.name)
  const isDestructive = DESTRUCTIVE_TOOLS.has(def.name)

  return buildTool({
    name: def.name,
    description: def.description,
    category,
    inputSchema: buildZodSchema(def),
    isConcurrencySafe: () => isReadOnly,
    isReadOnly: () => isReadOnly,
    isDestructive: () => isDestructive,

    async call(input, _ctx): Promise<ToolResult> {
      const result = await executor(def.name, input)
      return { data: result }
    },

    // Result budget: bash and web_fetch may produce large output
    maxResultChars: def.name === 'bash' ? 30_000
      : def.name === 'web_fetch' ? 30_000
      : def.name === 'read_file' ? 50_000
      : isReadOnly ? 15_000
      : 30_000,
  })
}

// ── Bulk Registration ────────────────────────────────────

/**
 * Register all tools from the existing tool definition arrays
 * into the global ToolRegistry.
 *
 * Call this once during initialization (e.g., in agent-dispatch.ts).
 */
export function registerAllTools(
  toolArrays: ToolDefinition[][],
  executor: (name: string, input: Record<string, unknown>) => Promise<string>,
): void {
  for (const arr of toolArrays) {
    for (const def of arr) {
      const toolDef = bridgeTool(def, executor)
      registry.register(toolDef)
    }
  }
}
