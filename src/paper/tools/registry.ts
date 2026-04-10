/**
 * Tool Registry — central registry for all MARs tools.
 *
 * Replaces the scattered tool arrays and the big switch-case in
 * agent-dispatch.ts with a single lookup structure.
 *
 * Backward compatible: the old executeTool() can delegate to
 * registry.execute() while keeping its original signature.
 */

import type { ToolDef, ToolCategory, ToolResult, ToolExecContext } from './types'
import type { ToolDefinition } from './tool-context'
import { toolDefToLegacy } from './types'

// ── Agent → Extra categories mapping ─────────────────────
// Mirrors the existing AGENT_EXTENDED_TOOLS mapping but uses categories.

const AGENT_EXTRA_CATEGORIES: Record<string, ToolCategory[]> = {
  investigator:       ['web', 'github', 'academic', 'hf'],
  'data-scout':       ['web', 'github', 'hf', 'academic', 'data'],
  'result-analyzer':  ['data', 'math'],
  'fragment-writer':  ['citation', 'math'],
  'math-reasoner':    ['math', 'data'],
  'experiment-runner': ['data', 'infra', 'math'],
  'latex-compiler':   ['citation'],
  'paper-assembler':  ['citation'],
}

// ── Registry ─────────────────────────────────────────────

export class ToolRegistry {
  private tools = new Map<string, ToolDef>()
  private categoryIndex = new Map<ToolCategory, ToolDef[]>()

  /** Register a tool. Overwrites if a tool with the same name exists. */
  register(tool: ToolDef): void {
    this.tools.set(tool.name, tool)
    let list = this.categoryIndex.get(tool.category)
    if (!list) {
      list = []
      this.categoryIndex.set(tool.category, list)
    }
    // Replace if already registered (idempotent)
    const idx = list.findIndex(t => t.name === tool.name)
    if (idx >= 0) list[idx] = tool
    else list.push(tool)
  }

  /** Register multiple tools at once. */
  registerAll(tools: ToolDef[]): void {
    for (const tool of tools) this.register(tool)
  }

  /** Look up a single tool by name. */
  get(name: string): ToolDef | undefined {
    return this.tools.get(name)
  }

  /** Check if a tool is registered. */
  has(name: string): boolean {
    return this.tools.has(name)
  }

  /** Get all tools in one or more categories. */
  getByCategory(...categories: ToolCategory[]): ToolDef[] {
    const result: ToolDef[] = []
    for (const cat of categories) {
      const list = this.categoryIndex.get(cat)
      if (list) result.push(...list)
    }
    return result
  }

  /**
   * Get the tool set for a specific agent.
   *
   * If the agent template specifies an explicit `tools` list, only those are
   * returned. Otherwise: base + research + agent-specific extended categories.
   *
   * DK tools are handled separately by agent-dispatch (filtered per agent).
   */
  getForAgent(agentName: string, explicitToolNames?: string[]): ToolDef[] {
    if (explicitToolNames) {
      return explicitToolNames
        .map(n => this.tools.get(n))
        .filter((t): t is ToolDef => t !== undefined)
    }

    const base = this.getByCategory('base', 'research')
    const extraCats = AGENT_EXTRA_CATEGORIES[agentName] ?? []
    const extra = this.getByCategory(...extraCats)
    return [...base, ...extra]
  }

  /** Convert a list of ToolDefs to the legacy ToolDefinition[] format. */
  toLegacyFormat(tools: ToolDef[]): ToolDefinition[] {
    return tools.map(toolDefToLegacy)
  }

  /** Get all registered tool names. */
  allNames(): string[] {
    return Array.from(this.tools.keys())
  }

  /** Get total count of registered tools. */
  get size(): number {
    return this.tools.size
  }
}

/**
 * Global registry singleton.
 * Populated during module initialization by tool registration modules.
 */
export const registry = new ToolRegistry()
