import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync } from 'fs'
import { join, resolve } from 'path'
import type { DatasetSpec, ExperimentPlan } from './types'

const DATA_DIR = 'experiments/shared/data'
const MANIFEST_FILE = 'datasets-manifest.json'

export interface DatasetStatus {
  name: string
  status: 'downloaded' | 'failed' | 'skipped'
  path: string
  error?: string
}

interface DataManifest {
  plan_id: string
  downloaded_at: string
  datasets: DatasetStatus[]
}

/**
 * Pre-fetches all datasets defined in an ExperimentPlan.
 *
 * Security: download_code is LLM-generated Python executed in a subprocess
 * with a scrubbed environment (only PATH/HOME/LANG — no API keys or tokens).
 * Dataset names are sanitized to prevent path traversal.
 */
export class DataPrefetcher {
  private dataDir: string

  constructor(private projectDir: string) {
    this.dataDir = join(projectDir, DATA_DIR)
  }

  /**
   * Download all datasets from the plan. Skips already-downloaded ones.
   * Returns status for each dataset.
   */
  async fetchAll(
    plan: ExperimentPlan,
    onProgress?: (msg: string) => void,
  ): Promise<DatasetStatus[]> {
    mkdirSync(this.dataDir, { recursive: true })

    const existing = this.loadManifest()
    const results: DatasetStatus[] = []

    for (const spec of plan.datasets) {
      const safeName = sanitizeName(spec.name)
      const datasetDir = this.safeDatasetDir(safeName)

      // Skip if already downloaded
      if (existing?.datasets.some(d => d.name === safeName && d.status === 'downloaded')) {
        onProgress?.(`Dataset "${safeName}" already downloaded, skipping`)
        results.push({ name: safeName, status: 'downloaded', path: datasetDir })
        continue
      }

      onProgress?.(`Downloading dataset "${safeName}" (${spec.source})...`)

      try {
        const status = await this.fetchOne(spec, safeName, datasetDir)
        results.push(status)
        onProgress?.(
          status.status === 'downloaded'
            ? `Dataset "${safeName}" downloaded to ${status.path}`
            : `Dataset "${safeName}" failed: ${status.error}`,
        )
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        results.push({ name: safeName, status: 'failed', path: datasetDir, error: msg })
        onProgress?.(`Dataset "${safeName}" failed: ${msg}`)
      }
    }

    // Save manifest
    this.saveManifest({
      plan_id: plan.id,
      downloaded_at: new Date().toISOString(),
      datasets: results,
    })

    return results
  }

  /**
   * Fetch a single dataset by generating and executing a download script.
   */
  private async fetchOne(
    spec: DatasetSpec,
    safeName: string,
    datasetDir: string,
  ): Promise<DatasetStatus> {
    mkdirSync(datasetDir, { recursive: true })

    const extraPackages = this.inferPackages(spec)

    // Generate the download script
    const script = this.buildDownloadScript(spec, safeName, datasetDir)
    writeFileSync(join(datasetDir, '_download.py'), script, 'utf-8')

    // Create a minimal pyproject.toml for uv
    const deps = ['numpy', 'pandas', ...extraPackages]
    const safeDeps = deps.map(d => sanitizePackageName(d)).filter(Boolean)
    const depsStr = safeDeps.map(d => `    "${d}",`).join('\n')
    const pyproject = `[project]
name = "download-${safeName}"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
${depsStr}
]
`
    writeFileSync(join(datasetDir, 'pyproject.toml'), pyproject, 'utf-8')

    // Run uv sync (best-effort)
    try {
      const syncProc = Bun.spawn(['uv', 'sync'], {
        cwd: datasetDir,
        stdout: 'pipe',
        stderr: 'pipe',
      })
      await syncProc.exited
    } catch {
      // uv sync may fail — continue anyway
    }

    // Execute with scrubbed environment: no API keys or tokens leak to download scripts
    const scrubbedEnv: Record<string, string> = {
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env.HOME ?? '/tmp',
      LANG: process.env.LANG ?? 'en_US.UTF-8',
      PYTHONHASHSEED: '42',
    }

    const proc = Bun.spawn(['uv', 'run', 'python', '_download.py'], {
      cwd: datasetDir,
      stdout: 'pipe',
      stderr: 'pipe',
      env: scrubbedEnv,
    })

    // Timeout with SIGKILL escalation
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill()
      setTimeout(() => { try { proc.kill(9) } catch { /* already dead */ } }, 5_000)
    }, 120_000)

    let stdout = ''
    let stderr = ''
    let exitCode: number
    try {
      ;[stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      exitCode = await proc.exited
    } finally {
      clearTimeout(timer)
    }

    if (timedOut) {
      return { name: safeName, status: 'failed', path: datasetDir, error: 'Timed out after 120s' }
    }

    if (exitCode !== 0) {
      return {
        name: safeName,
        status: 'failed',
        path: datasetDir,
        error: stderr.slice(-500) || stdout.slice(-500) || `exit code ${exitCode}`,
      }
    }

    return { name: safeName, status: 'downloaded', path: datasetDir }
  }

  /**
   * Build a Python download script from the DatasetSpec.
   * Uses repr() for safe string interpolation in generated Python.
   */
  private buildDownloadScript(spec: DatasetSpec, safeName: string, datasetDir: string): string {
    const safePath = datasetDir.replace(/\\/g, '/')

    return `#!/usr/bin/env python3
"""Auto-generated dataset download script for: ${safeName}"""
import os
import sys

DATA_DIR = ${JSON.stringify(safePath)}
os.makedirs(DATA_DIR, exist_ok=True)
os.chdir(DATA_DIR)

print("Downloading dataset " + ${JSON.stringify(safeName)} + " to " + DATA_DIR)

try:
${spec.download_code.split('\n').map(line => '    ' + line).join('\n')}
    print("Download complete: " + ${JSON.stringify(safeName)})
    # List downloaded files
    for f in os.listdir(DATA_DIR):
        if not f.startswith('_') and f not in ('pyproject.toml', '.venv', 'uv.lock', '.python-version'):
            size = os.path.getsize(os.path.join(DATA_DIR, f))
            print(f"  {f}: {size:,} bytes")
except Exception as e:
    print(f"ERROR downloading: {e}", file=sys.stderr)
    sys.exit(1)
`
  }

  /**
   * Infer extra pip packages from the download_code content.
   */
  private inferPackages(spec: DatasetSpec): string[] {
    const pkgs: string[] = []
    const code = spec.download_code.toLowerCase()

    if (spec.source === 'sklearn' || code.includes('sklearn') || code.includes('scikit-learn')) {
      pkgs.push('scikit-learn')
    }
    if (spec.source === 'openml' || code.includes('openml')) {
      pkgs.push('openml')
    }
    if (spec.source === 'huggingface' || code.includes('datasets.load_dataset') || code.includes('from datasets')) {
      pkgs.push('datasets')
    }
    if (code.includes('requests')) {
      pkgs.push('requests')
    }
    if (code.includes('ucimlrepo')) {
      pkgs.push('ucimlrepo')
    }
    return [...new Set(pkgs)]
  }

  /**
   * Resolve a safe dataset directory path. Prevents path traversal.
   */
  private safeDatasetDir(safeName: string): string {
    const resolved = resolve(join(this.dataDir, safeName))
    const resolvedBase = resolve(this.dataDir)
    if (!resolved.startsWith(resolvedBase + '/') && resolved !== resolvedBase) {
      throw new Error(`Path traversal detected in dataset name: ${safeName}`)
    }
    return resolved
  }

  private loadManifest(): DataManifest | null {
    const path = join(this.dataDir, MANIFEST_FILE)
    if (!existsSync(path)) return null
    try {
      return JSON.parse(readFileSync(path, 'utf-8'))
    } catch {
      return null
    }
  }

  private saveManifest(manifest: DataManifest): void {
    const target = join(this.dataDir, MANIFEST_FILE)
    const tmp = target + '.tmp'
    writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf-8')
    renameSync(tmp, target)
  }

  /** Get the path to a specific dataset's directory. */
  getDatasetPath(datasetName: string): string {
    return join(this.dataDir, sanitizeName(datasetName))
  }

  /** Check if a dataset has been downloaded. */
  isDownloaded(datasetName: string): boolean {
    const manifest = this.loadManifest()
    const safeName = sanitizeName(datasetName)
    return manifest?.datasets.some(d => d.name === safeName && d.status === 'downloaded') ?? false
  }
}

// ── Sanitizers ────────────────────────────────────────

/** Sanitize a name to only allow alphanumeric, hyphen, underscore. */
function sanitizeName(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
  if (clean.length === 0) return 'unnamed'
  return clean
}

/** Sanitize a pip package name. */
function sanitizePackageName(pkg: string): string {
  return pkg.replace(/[^a-zA-Z0-9_.\-\[\]]/g, '')
}
