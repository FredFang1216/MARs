/**
 * Tool system public API.
 *
 * New code should import from here:
 *   import { registry, buildTool, runToolCalls } from './tools'
 *
 * Existing code continues to import from tool-context.ts unchanged.
 */

// Core types and factory
export { buildTool, type ToolDef, type ToolCategory, type ToolResult, type ToolExecContext, type PermissionResult, toolDefToLegacy, toolDefsToLegacy } from './types'

// Registry
export { ToolRegistry, registry } from './registry'

// Execution pipeline
export { executeToolCall, applyResultBudget } from './execution'

// Concurrent orchestration
export { runToolCalls } from './orchestration'

// Bridge for existing tools
export { bridgeTool, registerAllTools } from './bridge'

// Re-export existing context utilities (backward compat)
export { getWorkingDir, resolvePath, executionContext, type ExecutionContext, type ToolDefinition } from './tool-context'
