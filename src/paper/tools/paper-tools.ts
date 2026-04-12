import {
  readFileSync,
  existsSync,
  mkdirSync,
} from 'fs'
import { join, basename, dirname } from 'path'
import { getWorkingDir, resolvePath, type ToolDefinition } from './tool-context'
import { BibTeXManager, formatBibTeX, generateKey } from '../writing/bibtex-manager'

// ── Tool Definitions ──────────────────────────────────────

export const CITATION_TOOLS: ToolDefinition[] = [
  {
    name: 'bibtex_lookup',
    description:
      'Look up BibTeX entries by arXiv ID, DOI, or Semantic Scholar paper ID. Returns formatted BibTeX that can be added to a .bib file.',
    input_schema: {
      type: 'object' as const,
      properties: {
        arxiv_id: { type: 'string', description: 'arXiv paper ID (e.g. "2310.06825")' },
        doi: { type: 'string', description: 'DOI string' },
        s2_id: { type: 'string', description: 'Semantic Scholar paper ID' },
      },
      required: [],
    },
  },
  {
    name: 'bibtex_manage',
    description:
      'Manage a BibTeX bibliography file. Actions: "list" (list all keys), "search" (find entries by key pattern), "add" (add a BibTeX entry), "sync" (sync .bib with \\cite keys in .tex files).',
    input_schema: {
      type: 'object' as const,
      properties: {
        bib_path: { type: 'string', description: 'Path to the .bib file (default: "paper/references.bib")' },
        action: { type: 'string', description: '"list", "search", "add", "sync"' },
        query: { type: 'string', description: 'Search query (for "search" action)' },
        bibtex: { type: 'string', description: 'Raw BibTeX string to add (for "add" action)' },
        paper_dir: { type: 'string', description: 'Directory containing .tex files (for "sync" action, default: "paper/")' },
        lit_bib_path: { type: 'string', description: 'Path to literature .bib file to sync from (for "sync" action)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'latex_compile',
    description:
      'Compile a LaTeX document to PDF using latexmk. Returns structured errors and warnings with file/line info.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tex_file: { type: 'string', description: 'Path to main .tex file (default: "paper/main.tex")' },
        compiler: { type: 'string', description: '"pdflatex" (default), "xelatex", or "lualatex"' },
        bibtex: { type: 'boolean', description: 'Whether to run bibtex/biber (default: true)' },
      },
      required: [],
    },
  },
  {
    name: 'latex_check',
    description:
      'Check LaTeX source files for syntax errors and common issues using chktex. Returns warnings with line numbers.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tex_file: { type: 'string', description: 'Path to .tex file to check' },
      },
      required: ['tex_file'],
    },
  },
]

export const DATA_TOOLS: ToolDefinition[] = [
  {
    name: 'data_query',
    description:
      'Run SQL queries on local CSV, JSON, or Parquet files using DuckDB (or pandas fallback). Returns tabular results.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sql: { type: 'string', description: 'SQL query. Reference files directly in FROM clause (e.g. "SELECT * FROM \'data/results.csv\' LIMIT 10")' },
        files: { type: 'array', items: { type: 'string' }, description: 'List of data file paths to make available. Files are referenced by path in SQL.' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'plot_create',
    description:
      'Create charts and plots using matplotlib. Generates PNG images. Supports line, bar, scatter, heatmap, histogram, and box plots.',
    input_schema: {
      type: 'object' as const,
      properties: {
        data: { type: 'string', description: 'JSON data for the plot. Format depends on chart_type. For line/bar/scatter: {"x": [...], "y": [...]} or {"series": [{"label": "...", "x": [...], "y": [...]}]}. For heatmap: {"matrix": [[...]], "xlabels": [...], "ylabels": [...]}.' },
        chart_type: { type: 'string', description: '"line", "bar", "scatter", "heatmap", "histogram", "box" (default: "line")' },
        title: { type: 'string', description: 'Chart title' },
        xlabel: { type: 'string', description: 'X-axis label' },
        ylabel: { type: 'string', description: 'Y-axis label' },
        output_path: { type: 'string', description: 'Output PNG path (default: "plots/chart.png")' },
        style: { type: 'string', description: 'Matplotlib style (e.g. "seaborn-v0_8", "ggplot", "dark_background"). Default: "seaborn-v0_8".' },
      },
      required: ['data', 'chart_type'],
    },
  },
]

export const INFRA_TOOLS: ToolDefinition[] = [
  {
    name: 'docker_run',
    description:
      'Run a command inside a Docker container. Sandboxed: project directory mounted at /workspace, network disabled by default, resource limits enforced. Use for reproducible experiments and isolated execution.',
    input_schema: {
      type: 'object' as const,
      properties: {
        image: { type: 'string', description: 'Docker image (e.g. "python:3.11", "pytorch/pytorch:latest")' },
        command: { type: 'string', description: 'Command to run inside the container' },
        volumes: { type: 'array', items: { type: 'string' }, description: 'Additional subdirectory mounts within the project (e.g. ["data", "experiments"]). Each is mounted at /workspace/<name>.' },
        env: { type: 'object', description: 'Environment variables to pass to the container' },
        network: { type: 'boolean', description: 'Enable network access (default: false)' },
        memory: { type: 'string', description: 'Memory limit (default: "4g")' },
        cpus: { type: 'number', description: 'CPU limit (default: 2)' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default: 300000, max: 1800000)' },
        readonly: { type: 'boolean', description: 'Mount project directory as read-only (default: false)' },
        workdir: { type: 'string', description: 'Working directory inside container (default: "/workspace")' },
      },
      required: ['image', 'command'],
    },
  },
  {
    name: 'docker_build',
    description:
      'Build a Docker image from a Dockerfile. The Dockerfile must be within the project directory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        dockerfile_path: { type: 'string', description: 'Path to Dockerfile (relative to project root)' },
        tag: { type: 'string', description: 'Image tag (e.g. "my-experiment:latest")' },
        build_args: { type: 'object', description: 'Build arguments as key-value pairs' },
      },
      required: ['dockerfile_path', 'tag'],
    },
  },
  {
    name: 'docker_list',
    description: 'List local Docker images and running containers.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'sqlite_query',
    description:
      'Execute SQL queries on a SQLite database. Supports SELECT (returns tabular results), CREATE TABLE, INSERT, UPDATE, DELETE. Database file must be within the project directory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        db_path: { type: 'string', description: 'Path to SQLite database file (created if not exists)' },
        sql: { type: 'string', description: 'SQL query to execute' },
      },
      required: ['db_path', 'sql'],
    },
  },
]

// ── Citation Tool Execution ──────────────────────────────

export async function executeBibTeXLookup(
  input: Record<string, unknown>,
): Promise<string> {
  try {
    const arxivId = input.arxiv_id as string | undefined
    const doi = input.doi as string | undefined
    const s2Id = input.s2_id as string | undefined

    if (!arxivId && !doi && !s2Id) {
      return 'Error: Provide at least one of arxiv_id, doi, or s2_id'
    }

    // Create a temp BibTeXManager to generate entry (unique name to avoid race conditions)
    const tmpBib = join(getWorkingDir(), `.tmp_bibtex_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.bib`)
    const manager = new BibTeXManager(tmpBib)

    let key: string
    if (arxivId) {
      key = await manager.addFromArxiv(arxivId)
    } else if (s2Id) {
      key = await manager.addFromS2(s2Id)
    } else {
      // DOI → use S2 with DOI as paper ID
      key = await manager.addFromS2(`DOI:${doi}`)
    }

    const bibtex = manager.getBibTeX(key)
    // Clean up temp file
    try {
      const { unlinkSync } = await import('fs')
      unlinkSync(tmpBib)
    } catch { /* ignore */ }

    return bibtex ?? `Generated key "${key}" but could not retrieve BibTeX`
  } catch (err) {
    return `BibTeX lookup error: ${(err as Error).message}`
  }
}

export async function executeBibTeXManage(
  input: Record<string, unknown>,
): Promise<string> {
  try {
    const action = (input.action as string) ?? 'list'
    const bibPath = resolvePath((input.bib_path as string) ?? 'paper/references.bib')
    const manager = new BibTeXManager(bibPath)

    switch (action) {
      case 'list': {
        const keys = await manager.getAllKeys()
        if (keys.length === 0) return `No entries in ${bibPath}`
        return `${keys.length} entries in ${bibPath}:\n${keys.map(k => `  - ${k}`).join('\n')}`
      }
      case 'search': {
        const query = ((input.query as string) ?? '').toLowerCase()
        if (!query) return 'Error: query is required for search action'
        const keys = await manager.getAllKeys()
        const matches = keys.filter(k => k.toLowerCase().includes(query))
        if (matches.length === 0) return `No entries matching "${query}"`
        const lines = [`Found ${matches.length} matching entries:`]
        for (const k of matches) {
          const entry = manager.getBibTeX(k)
          if (entry) lines.push(`\n${entry}`)
        }
        return lines.join('\n')
      }
      case 'add': {
        const bibtex = input.bibtex as string | undefined
        if (!bibtex) return 'Error: bibtex string is required for add action'
        manager.appendRawEntry(bibtex)
        return `Entry added to ${bibPath}`
      }
      case 'sync': {
        const paperDir = resolvePath((input.paper_dir as string) ?? 'paper/')
        const litBibPath = input.lit_bib_path
          ? resolvePath(input.lit_bib_path as string)
          : join(getWorkingDir(), 'literature/literature.bib')
        const result = await manager.syncFromLiterature(litBibPath, paperDir)
        return `Sync complete:\n  Synced: ${result.synced}\n  Missing: ${result.missing}\n  Fixed: ${result.fixed.length > 0 ? result.fixed.join(', ') : 'none'}`
      }
      default:
        return `Unknown action: "${action}". Use "list", "search", "add", or "sync".`
    }
  } catch (err) {
    return `BibTeX manage error: ${(err as Error).message}`
  }
}

export async function executeLatexCompile(
  input: Record<string, unknown>,
): Promise<string> {
  try {
    const texFile = resolvePath((input.tex_file as string) ?? 'paper/main.tex')
    const compiler = (input.compiler as string) ?? 'pdflatex'

    // Validate compiler against allowlist to prevent command injection
    const ALLOWED_COMPILERS = ['pdflatex', 'xelatex', 'lualatex']
    if (!ALLOWED_COMPILERS.includes(compiler)) {
      return `Error: Invalid compiler "${compiler}". Use one of: ${ALLOWED_COMPILERS.join(', ')}`
    }

    if (!existsSync(texFile)) return `Error: File not found: ${texFile}`

    const texDir = dirname(texFile)
    const texName = basename(texFile)
    const cmd = `cd "${texDir}" && latexmk -pdf -${compiler} -interaction=nonstopmode "${texName}" 2>&1`

    const proc = Bun.spawn(['bash', '-c', cmd], {
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        proc.kill()
        reject(new Error('LaTeX compilation timed out after 120s'))
      }, 120_000)
    })

    const resultPromise = (async () => {
      const stdout = await new Response(proc.stdout).text()
      const exitCode = await proc.exited

      const logFile = join(texDir, texName.replace(/\.tex$/, '.log'))
      let logContent = ''
      if (existsSync(logFile)) {
        logContent = readFileSync(logFile, 'utf-8')
      }

      // Parse errors from log
      const errors: string[] = []
      const warnings: string[] = []
      for (const line of logContent.split('\n')) {
        if (line.startsWith('!')) errors.push(line)
        if (line.includes('LaTeX Warning:') || line.includes('Package natbib Warning:')) {
          warnings.push(line.trim())
        }
      }

      if (exitCode === 0) {
        const pdfPath = join(texDir, texName.replace(/\.tex$/, '.pdf'))
        let result = `Compilation successful. PDF: ${pdfPath}`
        if (warnings.length > 0) {
          result += `\n\nWarnings (${warnings.length}):\n${warnings.slice(0, 10).map(w => `  - ${w}`).join('\n')}`
        }
        return result
      } else {
        let result = `Compilation failed.\n\nErrors (${errors.length}):\n`
        result += errors.slice(0, 10).map(e => `  ${e}`).join('\n')
        if (warnings.length > 0) {
          result += `\n\nWarnings (${warnings.length}):\n${warnings.slice(0, 5).map(w => `  - ${w}`).join('\n')}`
        }
        result += `\n\nLog excerpt:\n${logContent.slice(-1000)}`
        return result
      }
    })()

    return await Promise.race([resultPromise, timeoutPromise])
  } catch (err) {
    return `LaTeX compile error: ${(err as Error).message}`
  }
}

export async function executeLatexCheck(
  input: Record<string, unknown>,
): Promise<string> {
  try {
    const texFile = resolvePath((input.tex_file as string) ?? '')
    if (!texFile) return 'Error: tex_file is required'
    if (!existsSync(texFile)) return `Error: File not found: ${texFile}`

    // Check if chktex is available
    try {
      const which = Bun.spawn(['which', 'chktex'], { stdout: 'pipe', stderr: 'pipe' })
      await which.exited
    } catch {
      return 'Error: chktex is not installed. Install with: brew install chktex (macOS) or apt-get install chktex (Linux)'
    }

    const proc = Bun.spawn(['chktex', '-q', '-v0', texFile], {
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    await proc.exited

    const output = (stdout + '\n' + stderr).trim()
    if (!output) return `No issues found in ${basename(texFile)}`

    return `LaTeX check results for ${basename(texFile)}:\n\n${output}`
  } catch (err) {
    return `LaTeX check error: ${(err as Error).message}`
  }
}

// ── Data Tool Execution ──────────────────────────────────

export async function executeDataQuery(
  input: Record<string, unknown>,
): Promise<string> {
  try {
    const sql = (input.sql as string) ?? ''
    if (!sql) return 'Error: sql query is required'

    // Validate file references in SQL are within project
    const files = (input.files as string[]) ?? []
    for (const f of files) {
      resolvePath(f) // Throws if outside project
    }

    // Pass SQL via environment variable to prevent code injection
    const duckdbCode = `
import sys, os
try:
    import duckdb
    sql = os.environ['MARS_QUERY_SQL']
    result = duckdb.sql(sql)
    print(result.df().to_string())
except ImportError:
    print("Error: DuckDB not installed. Install with: pip install duckdb", file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f"Query error: {e}", file=sys.stderr)
    sys.exit(1)
`

    const proc = Bun.spawn(['python3', '-c', duckdbCode], {
      cwd: getWorkingDir(),
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, MARS_QUERY_SQL: sql },
    })

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        proc.kill()
        reject(new Error('Query timed out after 60s'))
      }, 60_000)
    })

    const resultPromise = (async () => {
      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      const exitCode = await proc.exited
      if (exitCode !== 0) return `Query error: ${stderr || 'Unknown error'}`
      if (stdout.length > 50_000) {
        return stdout.slice(0, 50_000) + '\n... [truncated]'
      }
      return stdout || '(empty result)'
    })()

    return await Promise.race([resultPromise, timeoutPromise])
  } catch (err) {
    return `Data query error: ${(err as Error).message}`
  }
}

export async function executePlotCreate(
  input: Record<string, unknown>,
): Promise<string> {
  try {
    const dataStr = (input.data as string) ?? ''
    const chartType = (input.chart_type as string) ?? 'line'
    const title = (input.title as string) ?? ''
    const xlabel = (input.xlabel as string) ?? ''
    const ylabel = (input.ylabel as string) ?? ''
    const outputPath = resolvePath((input.output_path as string) ?? 'plots/chart.png')
    const style = (input.style as string) ?? 'seaborn-v0_8'

    if (!dataStr) return 'Error: data is required (JSON string)'

    // Validate chart_type against allowlist
    const ALLOWED_CHART_TYPES = ['line', 'bar', 'scatter', 'heatmap', 'histogram', 'box']
    if (!ALLOWED_CHART_TYPES.includes(chartType)) {
      return `Error: Invalid chart_type "${chartType}". Use one of: ${ALLOWED_CHART_TYPES.join(', ')}`
    }

    // Ensure output directory exists
    const outDir = dirname(outputPath)
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

    // All dynamic values passed via environment variables to prevent code injection
    const pythonCode = `
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import json
import os, sys

style = os.environ.get('PLOT_STYLE', 'seaborn-v0_8')
try:
    plt.style.use(style)
except:
    pass

data = json.loads(os.environ['PLOT_DATA'])
chart_type = os.environ.get('PLOT_TYPE', 'line')
title = os.environ.get('PLOT_TITLE', '')
xlabel = os.environ.get('PLOT_XLABEL', '')
ylabel = os.environ.get('PLOT_YLABEL', '')
output_path = os.environ['PLOT_OUTPUT']

fig, ax = plt.subplots(figsize=(10, 6))

if chart_type == 'line':
    if 'series' in data:
        for s in data['series']:
            ax.plot(s.get('x', range(len(s['y']))), s['y'], label=s.get('label', ''), marker='o')
        ax.legend()
    else:
        ax.plot(data.get('x', range(len(data['y']))), data['y'], marker='o')
elif chart_type == 'bar':
    if 'series' in data:
        import numpy as np
        x = np.arange(len(data['series'][0].get('x', range(len(data['series'][0]['y'])))))
        width = 0.8 / len(data['series'])
        for i, s in enumerate(data['series']):
            ax.bar(x + i * width, s['y'], width, label=s.get('label', ''))
        ax.set_xticks(x + width * (len(data['series']) - 1) / 2)
        ax.set_xticklabels(data['series'][0].get('x', range(len(data['series'][0]['y']))))
        ax.legend()
    else:
        ax.bar(data.get('x', range(len(data['y']))), data['y'])
elif chart_type == 'scatter':
    ax.scatter(data['x'], data['y'], alpha=0.7)
elif chart_type == 'heatmap':
    import numpy as np
    matrix = np.array(data['matrix'])
    im = ax.imshow(matrix, cmap='viridis', aspect='auto')
    fig.colorbar(im)
    if 'xlabels' in data:
        ax.set_xticks(range(len(data['xlabels'])))
        ax.set_xticklabels(data['xlabels'], rotation=45, ha='right')
    if 'ylabels' in data:
        ax.set_yticks(range(len(data['ylabels'])))
        ax.set_yticklabels(data['ylabels'])
elif chart_type == 'histogram':
    ax.hist(data['values'], bins=data.get('bins', 20), alpha=0.7, edgecolor='black')
elif chart_type == 'box':
    if isinstance(data.get('values', [None])[0], list):
        ax.boxplot(data['values'], labels=data.get('labels', None))
    else:
        ax.boxplot(data['values'])

if title: ax.set_title(title)
if xlabel: ax.set_xlabel(xlabel)
if ylabel: ax.set_ylabel(ylabel)
plt.tight_layout()
plt.savefig(output_path, dpi=150, bbox_inches='tight')
print(f'Plot saved to {output_path}')
`

    const proc = Bun.spawn(['python3', '-c', pythonCode], {
      cwd: getWorkingDir(),
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        PLOT_DATA: dataStr,
        PLOT_TYPE: chartType,
        PLOT_TITLE: title,
        PLOT_XLABEL: xlabel,
        PLOT_YLABEL: ylabel,
        PLOT_OUTPUT: outputPath,
        PLOT_STYLE: style,
      },
    })

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    if (exitCode !== 0) return `Plot error: ${stderr}`
    return stdout.trim() || `Plot saved to ${outputPath}`
  } catch (err) {
    return `Plot creation error: ${(err as Error).message}`
  }
}

// ── Infrastructure Tool Execution ────────────────────────

export async function executeDockerRun(
  input: Record<string, unknown>,
): Promise<string> {
  try {
    const image = (input.image as string) ?? ''
    const command = (input.command as string) ?? ''
    if (!image) return 'Error: image is required'
    if (!command) return 'Error: command is required'

    // Check docker availability
    try {
      const check = Bun.spawn(['docker', 'info'], { stdout: 'pipe', stderr: 'pipe' })
      const exitCode = await check.exited
      if (exitCode !== 0) {
        return 'Error: Docker is not running. Please start Docker Desktop or the Docker daemon.'
      }
    } catch {
      return 'Error: Docker is not installed. Install from https://docs.docker.com/get-docker/'
    }

    // Auto-upgrade base Python images to pre-built research image if available.
    // This avoids wasting time on `pip install numpy torch` every run.
    const RESEARCH_IMAGE = 'mars-research'
    const UPGRADEABLE_IMAGES = new Set([
      'python:3.11', 'python:3.11-slim', 'python:3.12', 'python:3.12-slim',
      'python:3', 'python:latest', 'python:3.11-bookworm',
    ])
    let resolvedImage = image
    if (UPGRADEABLE_IMAGES.has(image)) {
      // Check if mars-research image exists locally
      try {
        const check = Bun.spawn(['docker', 'image', 'inspect', RESEARCH_IMAGE], { stdout: 'pipe', stderr: 'pipe' })
        if ((await check.exited) === 0) {
          resolvedImage = RESEARCH_IMAGE
        }
      } catch { /* fall through to original image */ }
    }

    const network = (input.network as boolean) ?? false
    const memory = (input.memory as string) ?? '4g'
    const cpus = Math.min((input.cpus as number) ?? 2, 16)
    const timeoutMs = Math.min((input.timeout_ms as number) ?? 300_000, 1_800_000)
    const readonly = (input.readonly as boolean) ?? false
    const workdir = (input.workdir as string) ?? '/workspace'
    const envVars = (input.env as Record<string, string>) ?? {}
    const volumes = (input.volumes as string[]) ?? []

    // Security validations
    // Validate image name: must be a valid Docker image reference
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._\/-]*(:[a-zA-Z0-9._-]+)?$/.test(image)) {
      return 'Error: Invalid Docker image name'
    }

    // Validate memory format and cap at 32g
    if (!/^\d+[mgk]$/i.test(memory)) {
      return 'Error: Invalid memory format. Use e.g. "4g", "512m"'
    }
    const memNum = parseInt(memory)
    const memUnit = memory.slice(-1).toLowerCase()
    if ((memUnit === 'g' && memNum > 32) || (memUnit === 'm' && memNum > 32768)) {
      return 'Error: Memory limit cannot exceed 32g'
    }

    // Validate workdir: must be an absolute path with safe characters
    if (!/^\/[a-zA-Z0-9/_-]+$/.test(workdir)) {
      return 'Error: Invalid workdir path. Must be an absolute path with alphanumeric characters.'
    }

    // Generate unique container name for timeout cleanup
    const containerName = `mars-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // Build docker args
    const args = [
      'docker', 'run',
      '--rm',                                    // Auto-cleanup
      '--name', containerName,                   // Named for timeout cleanup
      '--memory', memory,
      '--cpus', String(cpus),
      '--pids-limit', '256',                     // Prevent fork bombs
      '--workdir', workdir,
    ]

    // Network isolation (default: disabled)
    if (!network) {
      args.push('--network', 'none')
    }

    // User mapping to avoid root-owned files
    try {
      const idProc = Bun.spawn(['id', '-u'], { stdout: 'pipe' })
      const uid = (await new Response(idProc.stdout).text()).trim()
      const gidProc = Bun.spawn(['id', '-g'], { stdout: 'pipe' })
      const gid = (await new Response(gidProc.stdout).text()).trim()
      args.push('--user', `${uid}:${gid}`)
    } catch {
      // Skip user mapping if id command fails
    }

    // Mount project directory
    const mountFlag = readonly ? 'ro' : 'rw'
    const projectDir = getWorkingDir()
    args.push('-v', `${projectDir}:${workdir}:${mountFlag}`)

    // Additional volume mounts (must be subdirectories of project)
    for (const vol of volumes) {
      // Validate subdirectory
      const volPath = resolvePath(vol) // Throws if outside project
      args.push('-v', `${volPath}:${workdir}/${basename(vol)}:${mountFlag}`)
    }

    // Environment variables
    for (const [key, val] of Object.entries(envVars)) {
      // Validate env var names to prevent injection
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        return `Error: Invalid environment variable name: "${key}"`
      }
      args.push('-e', `${key}=${val}`)
    }

    // Image and command
    args.push(resolvedImage, 'sh', '-c', command)

    const proc = Bun.spawn(args, {
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        // Kill the container by name (proc.kill only kills the docker CLI, not the container)
        proc.kill()
        Bun.spawn(['docker', 'kill', containerName], { stdout: 'pipe', stderr: 'pipe' })
        reject(new Error(`Docker command timed out after ${timeoutMs / 1000}s`))
      }, timeoutMs)
    })

    const resultPromise = (async () => {
      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      const exitCode = await proc.exited
      let output = ''
      if (stdout) output += stdout
      if (stderr) output += (output ? '\n--- stderr ---\n' : '') + stderr
      if (exitCode !== 0) output += `\n[exit code: ${exitCode}]`
      if (output.length > 50_000) {
        output = output.slice(0, 25_000) + '\n... [truncated] ...\n' + output.slice(-25_000)
      }
      return output || '(no output)'
    })()

    return await Promise.race([resultPromise, timeoutPromise])
  } catch (err) {
    return `Docker run error: ${(err as Error).message}`
  }
}

export async function executeDockerBuild(
  input: Record<string, unknown>,
): Promise<string> {
  try {
    const dockerfilePath = resolvePath((input.dockerfile_path as string) ?? '')
    const tag = (input.tag as string) ?? ''
    const buildArgs = (input.build_args as Record<string, string>) ?? {}

    if (!dockerfilePath) return 'Error: dockerfile_path is required'
    if (!tag) return 'Error: tag is required'
    if (!existsSync(dockerfilePath)) return `Error: Dockerfile not found: ${dockerfilePath}`

    // Validate tag format
    if (!/^[a-z0-9][a-z0-9._/-]*(?::[a-z0-9._-]+)?$/i.test(tag)) {
      return `Error: Invalid image tag: "${tag}"`
    }

    // Check docker availability
    try {
      const check = Bun.spawn(['docker', 'info'], { stdout: 'pipe', stderr: 'pipe' })
      if ((await check.exited) !== 0) {
        return 'Error: Docker is not running.'
      }
    } catch {
      return 'Error: Docker is not installed.'
    }

    const contextDir = dirname(dockerfilePath)
    const args = ['docker', 'build', '-f', dockerfilePath, '-t', tag]

    for (const [key, val] of Object.entries(buildArgs)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        return `Error: Invalid build arg name: "${key}"`
      }
      args.push('--build-arg', `${key}=${val}`)
    }
    args.push(contextDir)

    const proc = Bun.spawn(args, {
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        proc.kill()
        reject(new Error('Docker build timed out after 600s'))
      }, 600_000)
    })

    const resultPromise = (async () => {
      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      const exitCode = await proc.exited
      if (exitCode !== 0) {
        return `Build failed:\n${stderr || stdout}`.slice(0, 5000)
      }
      return `Image "${tag}" built successfully.\n${stdout.slice(-500)}`
    })()

    return await Promise.race([resultPromise, timeoutPromise])
  } catch (err) {
    return `Docker build error: ${(err as Error).message}`
  }
}

export async function executeDockerList(
  _input: Record<string, unknown>,
): Promise<string> {
  try {
    // Check docker availability
    try {
      const check = Bun.spawn(['docker', 'info'], { stdout: 'pipe', stderr: 'pipe' })
      if ((await check.exited) !== 0) {
        return 'Error: Docker is not running.'
      }
    } catch {
      return 'Error: Docker is not installed.'
    }

    const [imagesProc, psProc] = [
      Bun.spawn(['docker', 'images', '--format', 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}'], {
        stdout: 'pipe', stderr: 'pipe',
      }),
      Bun.spawn(['docker', 'ps', '--format', 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'], {
        stdout: 'pipe', stderr: 'pipe',
      }),
    ]

    const images = await new Response(imagesProc.stdout).text()
    const containers = await new Response(psProc.stdout).text()
    await imagesProc.exited
    await psProc.exited

    let output = '## Local Images\n'
    output += images.trim() || '(none)'
    output += '\n\n## Running Containers\n'
    output += containers.trim() || '(none)'

    return output
  } catch (err) {
    return `Docker list error: ${(err as Error).message}`
  }
}

export async function executeSQLiteQuery(
  input: Record<string, unknown>,
): Promise<string> {
  try {
    const dbPath = resolvePath((input.db_path as string) ?? '')
    const sql = (input.sql as string) ?? ''
    if (!dbPath) return 'Error: db_path is required'
    if (!sql) return 'Error: sql is required'

    // Pass db_path and sql via environment variables to prevent code injection
    const pythonCode = `
import sqlite3, sys, os

db_path = os.environ['MARS_DB_PATH']
sql = os.environ['MARS_SQL']

try:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.execute(sql)

    if cursor.description:
        columns = [desc[0] for desc in cursor.description]
        rows = cursor.fetchall()
        print(' | '.join(columns))
        print('-' * (sum(len(c) for c in columns) + 3 * (len(columns) - 1)))
        for row in rows[:500]:
            print(' | '.join(str(row[c]) for c in columns))
        if len(rows) > 500:
            print(f'... ({len(rows)} total rows, showing 500)')
        elif len(rows) == 0:
            print('(no rows)')
    else:
        conn.commit()
        print(f'OK. Rows affected: {cursor.rowcount}')

    conn.close()
except Exception as e:
    print(f'SQLite error: {e}', file=sys.stderr)
    sys.exit(1)
`

    const proc = Bun.spawn(['python3', '-c', pythonCode], {
      cwd: getWorkingDir(),
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, MARS_DB_PATH: dbPath, MARS_SQL: sql },
    })

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        proc.kill()
        reject(new Error('SQLite query timed out after 30s'))
      }, 30_000)
    })

    const resultPromise = (async () => {
      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      const exitCode = await proc.exited
      if (exitCode !== 0) return `SQLite error: ${stderr}`
      return stdout || '(empty result)'
    })()

    return await Promise.race([resultPromise, timeoutPromise])
  } catch (err) {
    return `SQLite query error: ${(err as Error).message}`
  }
}
