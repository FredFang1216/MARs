/**
 * Tool execution pipeline — validates, permission-checks, executes,
 * and budget-controls a single tool call.
 *
 * Inspired by Claude Code's toolExecution.ts but simplified for MARs:
 *   1. Zod input validation
 *   2. Optional custom validation
 *   3. Permission check
 *   4. Execute tool.call()
 *   5. Apply result budget (truncate oversized output)
 */

import { writeFileSync, mkdirSync } from 'fs'
import { join, relative } from 'path'
import type { ToolDef, ToolResult, ToolExecContext } from './types'
import type { ToolRegistry } from './registry'

// ── Result Budget ────────────────────────────────────────

/**
 * Truncate tool results that exceed the character budget.
 * Oversized results are written to a temp file; the truncated preview
 * includes a pointer so the LLM can read the full output if needed.
 */
export function applyResultBudget(
  result: ToolResult,
  maxChars: number,
  workingDir: string,
): ToolResult {
  const text = typeof result.data === 'string' ? result.data : JSON.stringify(result.data)
  if (text.length <= maxChars) return result

  // Write full output to disk
  const outDir = join(workingDir, '.claude-paper', 'tool-output')
  mkdirSync(outDir, { recursive: true })
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.txt`
  const fullPath = join(outDir, fileName)
  writeFileSync(fullPath, text, 'utf-8')

  const relPath = relative(workingDir, fullPath)
  const preview = text.slice(0, maxChars - 250)
  return {
    data: `${preview}\n\n... [truncated — full output (${text.length} chars) saved to: ${relPath}]\nUse read_file to see the complete output.`,
    truncated: true,
  }
}

// ── Single Tool Execution ────────────────────────────────

export interface ExecuteToolCallOptions {
  /** The tool call from the LLM. */
  toolCall: { name: string; input: Record<string, unknown> }
  /** Registry to look up tools. */
  registry: ToolRegistry
  /** Execution context (working dir, abort signal). */
  ctx: ToolExecContext
}

/**
 * Execute a single tool call through the full pipeline.
 * Returns a ToolResult (never throws for tool-level errors).
 */
export async function executeToolCall(opts: ExecuteToolCallOptions): Promise<ToolResult> {
  const { toolCall, registry, ctx } = opts

  // Step 0: Resolve tool
  const tool = registry.get(toolCall.name)
  if (!tool) {
    return { data: `Error: unknown tool "${toolCall.name}". Available: ${registry.allNames().join(', ')}` }
  }

  // Step 1: Abort check
  if (ctx.signal?.aborted) {
    return { data: 'Cancelled: operation was aborted.' }
  }

  // Step 2: Zod input validation
  const parsed = tool.inputSchema.safeParse(toolCall.input)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(i => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    return { data: `Input validation error for "${toolCall.name}":\n${issues}` }
  }

  // Step 3: Custom validation
  if (tool.validateInput) {
    const v = tool.validateInput(parsed.data)
    if (!v.valid) {
      return { data: `Validation error for "${toolCall.name}": ${v.error}` }
    }
  }

  // Step 4: Permission check
  if (tool.checkPermissions) {
    const perm = await tool.checkPermissions(parsed.data, ctx)
    if (perm.behavior === 'deny') {
      return { data: `Permission denied for "${toolCall.name}": ${perm.reason}` }
    }
    // 'ask' behavior: in auto mode, allow; in interactive mode, would prompt user (future)
  }

  // Step 5: Execute
  let result: ToolResult
  try {
    result = await tool.call(parsed.data, ctx)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { data: `Tool "${toolCall.name}" error: ${msg}` }
  }

  // Step 6: Apply result budget
  const maxChars = tool.maxResultChars ?? 30_000
  result = applyResultBudget(result, maxChars, ctx.workingDir)

  return result
}
