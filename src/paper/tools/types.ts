/**
 * Tool definition interface inspired by Claude Code's Tool.ts,
 * adapted for MARs' research agent system.
 *
 * Design principles:
 *   1. Backward compatible — old ToolDefinition still works everywhere
 *   2. Opt-in upgrade — tools can be migrated one-at-a-time via buildTool()
 *   3. Zero changes to orchestrator, auto-mode, or research-state
 */

import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ToolDefinition } from './tool-context'

// ── Tool Categories ──────────────────────────────────────

export type ToolCategory =
  | 'base'       // bash, read_file, write_file, list_files, grep_content
  | 'research'   // arxiv, semantic_scholar, paperqa, paper_download, pdf_extract
  | 'web'        // web_search, web_fetch
  | 'github'     // github_search, github_read_file, github_clone
  | 'math'       // wolfram_alpha, sympy_eval
  | 'data'       // data_query, plot_create
  | 'infra'      // docker_run, docker_build, docker_list
  | 'dk'         // dk_search, dk_expand, dk_navigate, dk_find_technique
  | 'citation'   // bibtex_lookup, bibtex_manage, latex_compile, latex_check
  | 'academic'   // openalex_search, dblp_search, image_analyze
  | 'hf'         // hf_search_models, hf_search_datasets, hf_model_info, hf_dataset_preview

// ── Permission Result ────────────────────────────────────

export type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; reason: string }
  | { behavior: 'ask'; message: string }

// ── Tool Result ──────────────────────────────────────────

export interface ToolResult<T = string> {
  /** The tool's output data. Typically a string for text results. */
  data: T
  /** Optional: flag indicating the result was truncated by budget. */
  truncated?: boolean
}

// ── Tool Execution Context ───────────────────────────────
// Passed to tool.call(). Extends the existing ExecutionContext concept.

export interface ToolExecContext {
  /** Absolute path to the agent's working directory. */
  workingDir: string
  /** Abort signal for cancellation. */
  signal?: AbortSignal
}

// ── Enhanced Tool Definition ─────────────────────────────

export interface ToolDef<TInput extends Record<string, unknown> = Record<string, unknown>> {
  /** Unique tool name (must match the name used in LLM tool calls). */
  name: string
  /** Human-readable description sent to LLMs. */
  description: string
  /** Tool category for registry filtering. */
  category: ToolCategory
  /** Zod schema for input validation. */
  inputSchema: z.ZodType<TInput>

  // ── Behavioral attributes ──────────────────────────────
  // These drive the concurrency engine and permission system.
  // All have safe defaults via buildTool().

  /** Can multiple instances run in parallel? Default: false (conservative). */
  isConcurrencySafe(input?: TInput): boolean
  /** Does this tool only read state (no writes)? Default: false (conservative). */
  isReadOnly(input?: TInput): boolean
  /** Can this tool cause irreversible changes? Default: false. */
  isDestructive(input?: TInput): boolean

  // ── Execution ──────────────────────────────────────────

  /** Execute the tool. Returns a ToolResult (data + optional metadata). */
  call(input: TInput, ctx: ToolExecContext): Promise<ToolResult>

  // ── Optional overrides ─────────────────────────────────

  /** Custom permission check. Default: allow all. */
  checkPermissions?(input: TInput, ctx: ToolExecContext): Promise<PermissionResult>
  /** Extra validation beyond Zod schema. */
  validateInput?(input: TInput): { valid: boolean; error?: string }
  /** Maximum result size in characters before truncation. Default: 30000. */
  maxResultChars?: number
}

// ── Defaults & Factory ───────────────────────────────────

type DefaultableKeys = 'isConcurrencySafe' | 'isReadOnly' | 'isDestructive'

const TOOL_DEFAULTS: Pick<ToolDef, DefaultableKeys> & { maxResultChars: number } = {
  isConcurrencySafe: () => false,
  isReadOnly: () => false,
  isDestructive: () => false,
  maxResultChars: 30_000,
}

/**
 * Build a complete ToolDef from a partial definition.
 * Fills in safe defaults for behavioral attributes.
 *
 * Usage:
 *   const myTool = buildTool({
 *     name: 'read_file',
 *     description: 'Read a file',
 *     category: 'base',
 *     inputSchema: z.object({ path: z.string() }),
 *     isConcurrencySafe: () => true,
 *     isReadOnly: () => true,
 *     call: async (input, ctx) => { ... },
 *   })
 */
export function buildTool<TInput extends Record<string, unknown>>(
  def: Omit<ToolDef<TInput>, DefaultableKeys> & Partial<Pick<ToolDef<TInput>, DefaultableKeys>>,
): ToolDef<TInput> {
  return {
    ...TOOL_DEFAULTS,
    ...def,
  } as ToolDef<TInput>
}

// ── Conversion Utilities ─────────────────────────────────

/**
 * Convert a ToolDef (Zod-based) to the legacy ToolDefinition format
 * used by chatCompletion() and LLM APIs.
 */
export function toolDefToLegacy(tool: ToolDef): ToolDefinition {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jsonSchema = zodToJsonSchema(tool.inputSchema as any) as Record<string, unknown>
  return {
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: 'object' as const,
      properties: (jsonSchema.properties ?? {}) as Record<string, unknown>,
      required: ((jsonSchema.required ?? []) as string[]),
    },
  }
}

/**
 * Convert multiple ToolDefs to legacy format.
 */
export function toolDefsToLegacy(tools: ToolDef[]): ToolDefinition[] {
  return tools.map(toolDefToLegacy)
}
