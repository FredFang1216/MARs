import { isAbsolute, resolve } from 'path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { DKPLoader } from '../domain-knowledge/loader'

// ── Execution Context (AsyncLocalStorage) ────────────────
// Replaces module-level globals for working directory and DKP loader.
// Each agent execution or chat session runs within its own context,
// allowing safe parallel execution without shared mutable state.

export interface ExecutionContext {
  workingDir: string
  dkpLoader: DKPLoader | null
}

export const executionContext = new AsyncLocalStorage<ExecutionContext>()

// Legacy globals — kept as fallback for callers that haven't migrated to ExecutionContext.
// Prefer executionContext.getStore() in all new code.
let activeWorkingDir: string = process.cwd()

/** Set the working directory used by tool execution functions (legacy). */
export function setActiveWorkingDir(dir: string): void {
  activeWorkingDir = dir
}

/**
 * Get the effective working directory: from AsyncLocalStorage context if available,
 * otherwise fall back to the legacy module-level global.
 */
export function getWorkingDir(): string {
  return executionContext.getStore()?.workingDir ?? activeWorkingDir
}

/**
 * DKPLoader instance shared across agent executions within a session.
 * Initialized lazily by initAgentDKP() when knowledge packs are loaded.
 */
export let activeDKPLoader: DKPLoader | null = null

export function setActiveDKPLoader(loader: DKPLoader | null): void {
  activeDKPLoader = loader
}

/**
 * Get the effective DKP loader: from AsyncLocalStorage context if available,
 * otherwise fall back to the legacy module-level global.
 */
export function getEffectiveDKPLoader(): DKPLoader | null {
  const ctx = executionContext.getStore()
  if (ctx) return ctx.dkpLoader
  return activeDKPLoader
}

// ── Tool Definition Type ─────────────────────────────────
// Shared by agent-dispatch.ts and tool definition modules.

export interface ToolDefinition {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required: string[]
  }
}

export function resolvePath(filePath: string): string {
  const projectRoot = getWorkingDir()
  // Resolve relative to project root, then normalize
  const resolved = isAbsolute(filePath)
    ? resolve(filePath)
    : resolve(projectRoot, filePath)
  // Prevent path traversal outside the project directory
  if (!resolved.startsWith(projectRoot + '/') && resolved !== projectRoot) {
    throw new Error(
      `Path "${filePath}" resolves outside project directory. Access denied.`,
    )
  }
  return resolved
}
