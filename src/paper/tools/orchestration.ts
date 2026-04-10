/**
 * Concurrent tool orchestration — inspired by Claude Code's
 * toolOrchestration.ts.
 *
 * Partitions tool calls into concurrent-safe and non-safe batches,
 * then executes them accordingly:
 *   - Concurrent-safe tools run in parallel (up to maxConcurrency)
 *   - Non-safe tools run serially (one at a time)
 */

import type { ToolResult, ToolExecContext } from './types'
import type { ToolRegistry } from './registry'
import { executeToolCall } from './execution'

// ── Types ────────────────────────────────────────────────

interface ToolCall {
  name: string
  input: Record<string, unknown>
}

interface Batch {
  concurrent: boolean
  calls: ToolCall[]
}

// ── Partition Logic ──────────────────────────────────────

/**
 * Partition tool calls into batches preserving order.
 * Consecutive concurrent-safe calls become one parallel batch;
 * each non-safe call becomes its own serial batch.
 */
function partitionByConcurrency(
  calls: ToolCall[],
  registry: ToolRegistry,
): Batch[] {
  const batches: Batch[] = []
  let currentSafe: ToolCall[] = []

  for (const tc of calls) {
    const tool = registry.get(tc.name)
    const safe = tool?.isConcurrencySafe(tc.input as any) ?? false

    if (safe) {
      currentSafe.push(tc)
    } else {
      // Flush accumulated safe batch
      if (currentSafe.length > 0) {
        batches.push({ concurrent: true, calls: currentSafe })
        currentSafe = []
      }
      // Non-safe gets its own serial batch
      batches.push({ concurrent: false, calls: [tc] })
    }
  }
  // Flush trailing safe batch
  if (currentSafe.length > 0) {
    batches.push({ concurrent: true, calls: currentSafe })
  }
  return batches
}

// ── Parallel execution helper ────────────────────────────

async function pMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++
      results[i] = await fn(items[i])
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  )
  await Promise.all(workers)
  return results
}

// ── Main Entry Point ─────────────────────────────────────

/**
 * Execute an array of tool calls with automatic concurrency management.
 *
 * This is the primary upgrade from the old serial loop in executeAgent().
 * Safe tools (read_file, grep, search APIs) run in parallel;
 * unsafe tools (bash, write_file, docker) run one at a time.
 *
 * @returns Results in the same order as the input calls.
 */
export async function runToolCalls(
  calls: ToolCall[],
  registry: ToolRegistry,
  ctx: ToolExecContext,
  maxConcurrency = 5,
): Promise<ToolResult[]> {
  if (calls.length === 0) return []
  if (calls.length === 1) {
    // Fast path: single call, no batching overhead
    return [await executeToolCall({ toolCall: calls[0], registry, ctx })]
  }

  const batches = partitionByConcurrency(calls, registry)
  const allResults: ToolResult[] = []

  for (const batch of batches) {
    if (batch.concurrent && batch.calls.length > 1) {
      // Parallel execution
      const batchResults = await pMap(
        batch.calls,
        tc => executeToolCall({ toolCall: tc, registry, ctx }),
        maxConcurrency,
      )
      allResults.push(...batchResults)
    } else {
      // Serial execution (single call or non-concurrent)
      for (const tc of batch.calls) {
        allResults.push(await executeToolCall({ toolCall: tc, registry, ctx }))
      }
    }
  }

  return allResults
}
