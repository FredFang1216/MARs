import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'
import type { ExperimentPlan, ExperimentSpec } from './types'
import { DataPrefetcher } from './data-prefetch'

const PLAN_STATE_FILE = 'experiment-plan-state.json'

export type ExperimentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

interface PlanState {
  plan_id: string
  experiment_status: Record<string, ExperimentStatus> // spec.id → status
  data_fetched: boolean
  started_at: string
  updated_at: string
}

/**
 * Drives the execution of experiments according to the ExperimentPlan.
 *
 * Responsibilities:
 * - Track which experiments have been completed
 * - Determine the next experiment to run (respecting execution_order + dependencies)
 * - Generate initial script scaffolds from ExperimentSpec
 * - Coordinate data pre-fetching
 */
export class PlanExecutor {
  private planState: PlanState
  private prefetcher: DataPrefetcher

  constructor(
    private projectDir: string,
    private plan: ExperimentPlan,
  ) {
    this.prefetcher = new DataPrefetcher(projectDir)
    this.planState = this.loadState() ?? this.initState()
  }

  // ── Data Acquisition ────────────────────────────────

  /**
   * Download all datasets. Should be called once before the orchestrator loop.
   */
  async prefetchData(
    onProgress?: (msg: string) => void,
  ): Promise<{ downloaded: number; failed: number }> {
    if (this.planState.data_fetched) {
      onProgress?.('Data already fetched, skipping')
      return { downloaded: this.plan.datasets.length, failed: 0 }
    }

    const results = await this.prefetcher.fetchAll(this.plan, onProgress)

    const downloaded = results.filter(r => r.status === 'downloaded').length
    const failed = results.filter(r => r.status === 'failed').length

    // Only mark as fully fetched if no failures (allows retry on restart)
    this.planState.data_fetched = failed === 0
    this.saveState()

    return { downloaded, failed }
  }

  // ── Experiment Scheduling ───────────────────────────

  /**
   * Get the next experiment to run according to the plan.
   * Returns null if all experiments are done or blocked by dependencies.
   */
  getNextExperiment(): ExperimentSpec | null {
    for (const expId of this.plan.execution_order) {
      const status = this.planState.experiment_status[expId]
      if (status !== 'pending') continue

      const spec = this.plan.experiments.find(e => e.id === expId)
      if (!spec) continue

      // Check dependencies are satisfied
      const depsOk = spec.dependencies.every(depId => {
        const depStatus = this.planState.experiment_status[depId]
        return depStatus === 'completed' || depStatus === 'skipped'
      })
      if (!depsOk) continue

      return spec
    }
    return null
  }

  /**
   * Get all pending experiments (for overview/planning).
   */
  getPendingExperiments(): ExperimentSpec[] {
    return this.plan.execution_order
      .filter(id => this.planState.experiment_status[id] === 'pending')
      .map(id => this.plan.experiments.find(e => e.id === id))
      .filter((e): e is ExperimentSpec => !!e)
  }

  /**
   * Get completed experiment IDs.
   */
  getCompletedExperiments(): string[] {
    return Object.entries(this.planState.experiment_status)
      .filter(([_, s]) => s === 'completed')
      .map(([id]) => id)
  }

  /**
   * Mark an experiment as a given status.
   */
  markExperiment(specId: string, status: ExperimentStatus): void {
    this.planState.experiment_status[specId] = status
    this.planState.updated_at = new Date().toISOString()
    this.saveState()
  }

  /**
   * Check if all experiments in the plan are done (completed/failed/skipped).
   */
  isComplete(): boolean {
    return Object.values(this.planState.experiment_status).every(
      s => s === 'completed' || s === 'failed' || s === 'skipped',
    )
  }

  /**
   * Get a progress summary string.
   */
  getProgressSummary(): string {
    const statuses = Object.values(this.planState.experiment_status)
    const total = statuses.length
    const completed = statuses.filter(s => s === 'completed').length
    const failed = statuses.filter(s => s === 'failed').length
    const pending = statuses.filter(s => s === 'pending').length
    const running = statuses.filter(s => s === 'running').length
    return `Experiments: ${completed}/${total} completed, ${failed} failed, ${running} running, ${pending} pending`
  }

  // ── Script Generation ───────────────────────────────

  /**
   * Generate an initial Python script from an ExperimentSpec.
   * This gives the experiment-runner agent a head start instead of writing from scratch.
   */
  generateInitialScript(spec: ExperimentSpec): string {
    const datasetPaths = spec.datasets
      .map(name => {
        const ds = this.plan.datasets.find(d => d.name === name)
        return ds
          ? `# Dataset: ${name} (${ds.source})\n# Path: experiments/shared/data/${name}/`
          : `# Dataset: ${name}`
      })
      .join('\n')

    const metricsKeys = spec.metrics_to_collect
      .map(m => `            "${m}": 0.0,  # TODO: compute`)
      .join('\n')

    const dataLoaders = spec.datasets
      .map(name => {
        const ds = this.plan.datasets.find(d => d.name === name)
        if (!ds) return `# TODO: load dataset "${name}"`
        return `# Load ${name}\n${ds.download_code}`
      })
      .join('\n\n')

    return `#!/usr/bin/env python3
"""
Experiment: ${spec.name}
ID: ${spec.id}
Claim: ${spec.claim_target}
Success criteria: ${spec.success_criteria}

${spec.description}
"""

import json
import os
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd

SEED = 42
np.random.seed(SEED)

${datasetPaths}

RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")
os.makedirs(RESULTS_DIR, exist_ok=True)

# ── Data Loading ────────────────────────────────────
${dataLoaders}

# ── Experiment Logic ────────────────────────────────
# Outline:
${spec.script_outline.split('\n').map(line => '# ' + line).join('\n')}

start_time = time.time()

# TODO: Implement experiment logic here

elapsed = time.time() - start_time

# ── Results ─────────────────────────────────────────
metrics = {
    "experiment_id": "${spec.id}",
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "seed": SEED,
    "models": {
        "baseline": {
            "out_of_sample": {
${metricsKeys}
            },
        },
    },
    "wall_time_seconds": elapsed,
}

with open(os.path.join(RESULTS_DIR, "metrics.json"), "w") as f:
    json.dump(metrics, f, indent=2)

print(f"Experiment ${spec.id} completed in {elapsed:.1f}s")
print(f"Results saved to {RESULTS_DIR}/metrics.json")
`
  }

  /**
   * Build experiment-runner context that includes the planned experiment details
   * and generated initial script.
   */
  buildExperimentContext(spec: ExperimentSpec): string {
    const sections: string[] = [
      `## Planned Experiment: ${spec.name}`,
      `ID: ${spec.id}`,
      `Type: ${spec.type === 'probe' ? 'Tier 1 (probe)' : 'Tier 2 (full run)'}`,
      `Claim target: ${spec.claim_target}`,
      `Description: ${spec.description}`,
      `Metrics to collect: ${spec.metrics_to_collect.join(', ')}`,
      `Success criteria: ${spec.success_criteria}`,
      `Estimated duration: ${spec.estimated_duration}`,
    ]

    if (spec.python_packages.length > 0) {
      sections.push(`Extra packages needed: ${spec.python_packages.join(', ')}`)
      sections.push('Install via: uv add ' + spec.python_packages.join(' '))
    }

    // Dataset locations
    sections.push('', '## Dataset Locations')
    for (const dsName of spec.datasets) {
      const ds = this.plan.datasets.find(d => d.name === dsName)
      const path = `experiments/shared/data/${dsName}/`
      const downloaded = this.prefetcher.isDownloaded(dsName)
      sections.push(
        `- **${dsName}**: ${path} ${downloaded ? '(downloaded)' : '(NOT YET DOWNLOADED — download first!)'}`,
      )
      if (ds) {
        sections.push(`  Source: ${ds.source}${ds.source_id ? ':' + ds.source_id : ''}`)
        sections.push(`  Download code:\n\`\`\`python\n${ds.download_code}\n\`\`\``)
      }
    }

    // Script outline
    sections.push('', '## Script Outline', spec.script_outline)

    // Progress context
    sections.push('', `## Plan Progress`, this.getProgressSummary())
    const completed = this.getCompletedExperiments()
    if (completed.length > 0) {
      sections.push('Completed experiments: ' + completed.join(', '))
    }

    return sections.join('\n')
  }

  // ── Persistence ─────────────────────────────────────

  private initState(): PlanState {
    const status: Record<string, ExperimentStatus> = {}
    for (const exp of this.plan.experiments) {
      status[exp.id] = 'pending'
    }
    return {
      plan_id: this.plan.id,
      experiment_status: status,
      data_fetched: false,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  private loadState(): PlanState | null {
    const path = join(this.projectDir, PLAN_STATE_FILE)
    if (!existsSync(path)) return null
    try {
      const state = JSON.parse(readFileSync(path, 'utf-8')) as PlanState
      if (state.plan_id !== this.plan.id) return null // plan changed
      return state
    } catch {
      return null
    }
  }

  private saveState(): void {
    const target = join(this.projectDir, PLAN_STATE_FILE)
    const tmp = target + '.tmp'
    writeFileSync(tmp, JSON.stringify(this.planState, null, 2) + '\n', 'utf-8')
    renameSync(tmp, target)
  }
}
