import { readFileSync, existsSync, mkdirSync, statSync } from 'fs'
import { join, basename, dirname } from 'path'
import { getWorkingDir, resolvePath, type ToolDefinition } from './tool-context'
import { chatCompletion } from '../llm-client'
import { DEFAULT_MODEL_ASSIGNMENTS } from '../types'

// ── Tool Definitions ──────────────────────────────────────

export const WEB_TOOLS: ToolDefinition[] = [
  {
    name: 'web_search',
    description:
      'Search the web using a search engine. Returns titles, URLs, and snippets. Useful for finding blog posts, documentation, benchmark leaderboards, conference info, and other non-academic sources.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        max_results: { type: 'number', description: 'Maximum number of results (default: 10, max: 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'web_fetch',
    description:
      'Fetch a web page and extract its main text content. Strips HTML tags, scripts, and styles. Useful for reading blog posts, documentation, README files, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        max_length: { type: 'number', description: 'Maximum character length of extracted text (default: 20000)' },
      },
      required: ['url'],
    },
  },
]

export const GITHUB_TOOLS: ToolDefinition[] = [
  {
    name: 'github_search',
    description:
      'Search GitHub for repositories or code. Useful for finding paper implementations, baseline code, and open-source tools.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        type: { type: 'string', description: '"repositories" (default) or "code". Code search requires a qualifier like language or repo.' },
        max_results: { type: 'number', description: 'Maximum number of results (default: 10, max: 30)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'github_read_file',
    description:
      'Read a file from a GitHub repository without cloning. Specify owner/repo and file path.',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: { type: 'string', description: 'Repository in "owner/repo" format (e.g. "pytorch/pytorch")' },
        path: { type: 'string', description: 'File path within the repository (e.g. "README.md")' },
        ref: { type: 'string', description: 'Branch, tag, or commit SHA (default: default branch)' },
      },
      required: ['repo', 'path'],
    },
  },
  {
    name: 'github_clone',
    description:
      'Clone a GitHub repository to a local directory for experimentation. Shallow clone by default.',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: { type: 'string', description: 'Repository in "owner/repo" format or full URL' },
        target_dir: { type: 'string', description: 'Local directory to clone into (default: repos/{repo_name} in project root)' },
        branch: { type: 'string', description: 'Branch to clone (default: default branch)' },
        depth: { type: 'number', description: 'Clone depth for shallow clone (default: 1). Set 0 for full clone.' },
      },
      required: ['repo'],
    },
  },
]

export const MATH_TOOLS: ToolDefinition[] = [
  {
    name: 'wolfram_alpha',
    description:
      'Query Wolfram Alpha for mathematical computation, equation solving, symbolic algebra, calculus, linear algebra, statistics, and more. Returns computed results.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Mathematical query in natural language or Mathematica syntax (e.g. "solve x^2 + 3x - 4 = 0", "integral of sin(x)*exp(-x) dx", "eigenvalues of {{1,2},{3,4}}")' },
        format: { type: 'string', description: '"full" for detailed results with step-by-step (default), "short" for concise answer only' },
      },
      required: ['query'],
    },
  },
  {
    name: 'sympy_eval',
    description:
      'Execute Python code using SymPy for symbolic mathematics. Runs in a sandboxed Python environment with sympy, numpy, and scipy available. Returns stdout output.',
    input_schema: {
      type: 'object' as const,
      properties: {
        code: { type: 'string', description: 'Python code using SymPy. Use print() to output results. Common imports (sympy, numpy, scipy) are available.' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default: 30000, max: 120000)' },
      },
      required: ['code'],
    },
  },
]

export const HF_TOOLS: ToolDefinition[] = [
  {
    name: 'hf_search_models',
    description:
      'Search HuggingFace Hub for models by task, library, or keyword. Returns model IDs, download counts, and tags.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query (e.g. "text-classification bert")' },
        task: { type: 'string', description: 'Filter by task (e.g. "text-classification", "image-segmentation", "text-generation")' },
        library: { type: 'string', description: 'Filter by library (e.g. "transformers", "diffusers", "pytorch")' },
        sort: { type: 'string', description: '"downloads" (default), "likes", "trending", "created"' },
        max_results: { type: 'number', description: 'Maximum number of results (default: 10, max: 50)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'hf_search_datasets',
    description:
      'Search HuggingFace Hub for datasets by keyword or task. Returns dataset IDs, download counts, and descriptions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        task: { type: 'string', description: 'Filter by task category' },
        sort: { type: 'string', description: '"downloads" (default), "likes", "trending", "created"' },
        max_results: { type: 'number', description: 'Maximum number of results (default: 10, max: 50)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'hf_model_info',
    description:
      'Get detailed information about a HuggingFace model: README, config, tags, download stats, and model card.',
    input_schema: {
      type: 'object' as const,
      properties: {
        model_id: { type: 'string', description: 'Model ID (e.g. "bert-base-uncased", "meta-llama/Llama-2-7b")' },
      },
      required: ['model_id'],
    },
  },
  {
    name: 'hf_dataset_preview',
    description:
      'Preview the first N rows of a HuggingFace dataset. Returns sample data in tabular format.',
    input_schema: {
      type: 'object' as const,
      properties: {
        dataset_id: { type: 'string', description: 'Dataset ID (e.g. "squad", "glue")' },
        split: { type: 'string', description: 'Dataset split (default: "train")' },
        config: { type: 'string', description: 'Dataset config/subset name (e.g. "mnli" for glue)' },
        max_rows: { type: 'number', description: 'Maximum rows to preview (default: 5, max: 100)' },
      },
      required: ['dataset_id'],
    },
  },
]

export const ACADEMIC_TOOLS: ToolDefinition[] = [
  {
    name: 'openalex_search',
    description:
      'Search OpenAlex for academic works, authors, institutions, or concepts. Free API with comprehensive metadata, citation counts, and open access info.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        entity: { type: 'string', description: '"works" (default), "authors", "institutions", "concepts"' },
        filter: { type: 'string', description: 'OpenAlex filter string (e.g. "publication_year:2024", "type:journal-article")' },
        sort: { type: 'string', description: '"relevance_score" (default), "cited_by_count", "publication_date"' },
        max_results: { type: 'number', description: 'Maximum number of results (default: 10, max: 50)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'dblp_search',
    description:
      'Search DBLP for computer science publications. Specialized for conference and journal papers in CS.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        max_results: { type: 'number', description: 'Maximum number of results (default: 10, max: 50)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'image_analyze',
    description:
      'Analyze an image (figure, plot, diagram, screenshot) using a vision-capable LLM. Provide a question or prompt about the image.',
    input_schema: {
      type: 'object' as const,
      properties: {
        image_path: { type: 'string', description: 'Path to the image file (PNG, JPG, WEBP)' },
        prompt: { type: 'string', description: 'Question or instruction about the image (e.g. "Describe this figure", "Extract the data from this plot")' },
      },
      required: ['image_path', 'prompt'],
    },
  },
]

// ── Web Tool Executors ────────────────────────────────────

export async function executeWebSearch(
  input: Record<string, unknown>,
): Promise<string> {
  const query = input.query as string
  const maxResults = Math.min((input.max_results as number) ?? 10, 20)

  // Try Brave Search API first, then fallback to DuckDuckGo HTML scraping
  const braveKey = process.env.BRAVE_SEARCH_API_KEY
  if (braveKey) {
    try {
      const encodedQuery = encodeURIComponent(query)
      const res = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodedQuery}&count=${maxResults}`,
        { headers: { 'X-Subscription-Token': braveKey, Accept: 'application/json' } },
      )
      if (res.ok) {
        const data = (await res.json()) as any
        const results = (data.web?.results ?? []).slice(0, maxResults)
        if (results.length === 0) return 'No results found.'
        return results
          .map(
            (r: any, i: number) =>
              `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description ?? ''}`,
          )
          .join('\n\n')
      }
    } catch {
      // Fall through to DuckDuckGo
    }
  }

  // Fallback: DuckDuckGo Lite (no API key needed)
  try {
    const encodedQuery = encodeURIComponent(query)
    const proc = Bun.spawn(
      [
        'curl',
        '-sL',
        '-A',
        'Mozilla/5.0 (compatible; research-bot)',
        `https://lite.duckduckgo.com/lite/?q=${encodedQuery}`,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const html = await new Response(proc.stdout).text()
    // Extract results from DuckDuckGo Lite HTML
    const results: string[] = []
    const linkRegex = /<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi
    const snippetRegex = /<td class="result-snippet">([^<]+)<\/td>/gi
    const links = [...html.matchAll(linkRegex)]
    const snippets = [...html.matchAll(snippetRegex)]
    for (let i = 0; i < Math.min(links.length, maxResults); i++) {
      const url = links[i][1]
      const title = links[i][2].trim()
      const snippet = snippets[i]?.[1]?.trim() ?? ''
      results.push(`${i + 1}. ${title}\n   ${url}\n   ${snippet}`)
    }
    return results.length > 0 ? results.join('\n\n') : 'No results found.'
  } catch (err) {
    return `Web search error: ${(err as Error).message}`
  }
}

export async function executeWebFetch(
  input: Record<string, unknown>,
): Promise<string> {
  const url = input.url as string
  const maxLength = (input.max_length as number) ?? 20_000

  // Basic URL validation
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return 'Error: URL must start with http:// or https://'
  }

  // Block requests to private/internal network addresses (SSRF protection)
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()
    if (
      hostname === 'localhost' ||
      hostname === '[::1]' ||
      /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/.test(hostname) ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      return 'Error: Access to private/internal network addresses is not allowed.'
    }
  } catch {
    return 'Error: Invalid URL'
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; research-bot)',
        Accept: 'text/html,application/xhtml+xml,text/plain',
      },
      redirect: 'follow',
    })
    if (!res.ok) {
      return `Error: HTTP ${res.status} ${res.statusText}`
    }
    const contentType = res.headers.get('content-type') ?? ''
    const html = await res.text()

    // If plain text, return directly
    if (contentType.includes('text/plain') || contentType.includes('application/json')) {
      return html.length > maxLength
        ? html.slice(0, maxLength) + '\n... [truncated]'
        : html
    }

    // Strip HTML to extract text content
    let text = html
      // Remove script and style blocks
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      // Remove HTML tags
      .replace(/<[^>]+>/g, ' ')
      // Decode common entities
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim()

    if (!text) return 'Error: Could not extract text content from page.'

    return text.length > maxLength
      ? text.slice(0, maxLength) + '\n... [truncated]'
      : text
  } catch (err) {
    return `Error fetching URL: ${(err as Error).message}`
  }
}

// ── GitHub Tool Executors ────────────────────────────────

export async function executeGitHubSearch(
  input: Record<string, unknown>,
): Promise<string> {
  const query = input.query as string
  const type = (input.type as string) ?? 'repositories'
  const maxResults = Math.min((input.max_results as number) ?? 10, 30)
  const ghToken = process.env.GITHUB_TOKEN ?? ''
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'MARs-research-agent',
  }
  if (ghToken) headers['Authorization'] = `token ${ghToken}`

  try {
    const encodedQuery = encodeURIComponent(query)
    const endpoint =
      type === 'code'
        ? `https://api.github.com/search/code?q=${encodedQuery}&per_page=${maxResults}`
        : `https://api.github.com/search/repositories?q=${encodedQuery}&sort=stars&per_page=${maxResults}`

    const res = await fetch(endpoint, { headers })
    if (!res.ok) {
      const err = await res.text()
      return `GitHub API error (${res.status}): ${err.slice(0, 500)}`
    }
    const data = (await res.json()) as any
    const items = (data.items ?? []).slice(0, maxResults)

    if (items.length === 0) return 'No results found.'

    if (type === 'code') {
      return items
        .map(
          (item: any, i: number) =>
            `${i + 1}. ${item.repository?.full_name ?? ''}:${item.path}\n   ${item.html_url}`,
        )
        .join('\n\n')
    }

    return items
      .map(
        (item: any, i: number) =>
          `${i + 1}. ${item.full_name} ⭐${item.stargazers_count}\n   ${item.html_url}\n   ${item.description ?? '(no description)'}\n   Language: ${item.language ?? 'N/A'} | Updated: ${item.updated_at?.slice(0, 10) ?? 'N/A'}`,
      )
      .join('\n\n')
  } catch (err) {
    return `GitHub search error: ${(err as Error).message}`
  }
}

export async function executeGitHubReadFile(
  input: Record<string, unknown>,
): Promise<string> {
  const repo = input.repo as string
  const path = input.path as string
  const ref = input.ref as string | undefined
  const ghToken = process.env.GITHUB_TOKEN ?? ''
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3.raw',
    'User-Agent': 'MARs-research-agent',
  }
  if (ghToken) headers['Authorization'] = `token ${ghToken}`

  // Validate repo format
  if (!repo.match(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/)) {
    return 'Error: repo must be in "owner/repo" format'
  }

  try {
    let url = `https://api.github.com/repos/${repo}/contents/${path}`
    if (ref) url += `?ref=${encodeURIComponent(ref)}`

    const res = await fetch(url, { headers })
    if (!res.ok) {
      return `Error: GitHub API ${res.status} — ${res.statusText}`
    }
    const content = await res.text()
    if (content.length > 100_000) {
      return content.slice(0, 100_000) + '\n... [truncated]'
    }
    return content
  } catch (err) {
    return `GitHub read error: ${(err as Error).message}`
  }
}

export async function executeGitHubClone(
  input: Record<string, unknown>,
): Promise<string> {
  const repo = input.repo as string
  const branch = input.branch as string | undefined
  const depth = (input.depth as number) ?? 1

  // Normalize repo to URL
  const repoUrl = repo.startsWith('http')
    ? repo
    : `https://github.com/${repo}.git`

  // Determine target directory (enforce within project)
  const repoName = repo.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').split('/').pop() ?? 'repo'
  const targetDir = resolvePath(
    (input.target_dir as string) ?? join('repos', repoName)
  )

  if (existsSync(targetDir)) {
    return `Directory already exists: ${targetDir}. Use a different target_dir or delete it first.`
  }

  mkdirSync(dirname(targetDir), { recursive: true })

  const args = ['git', 'clone']
  if (depth > 0) args.push('--depth', String(depth))
  // Validate branch does not start with '-' to prevent git flag injection
  if (branch) {
    if (branch.startsWith('-')) return 'Error: Invalid branch name'
    args.push('--branch', branch)
  }
  args.push(repoUrl, targetDir)

  try {
    const proc = Bun.spawn(args, {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env },
    })
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      return `Clone failed: ${stderr}`
    }
    return `Cloned ${repo} to ${targetDir}`
  } catch (err) {
    return `Clone error: ${(err as Error).message}`
  }
}

// ── Math Tool Executors ──────────────────────────────────

export async function executeWolframAlpha(
  input: Record<string, unknown>,
): Promise<string> {
  const query = input.query as string
  const format = (input.format as string) ?? 'full'
  const appId = process.env.WOLFRAM_APP_ID

  if (!appId) {
    return 'Error: WOLFRAM_APP_ID environment variable is not set. Get a free API key at https://developer.wolframalpha.com/'
  }

  try {
    const encodedQuery = encodeURIComponent(query)

    if (format === 'short') {
      // Short Answers API — returns plain text
      const res = await fetch(
        `https://api.wolframalpha.com/v1/result?appid=${appId}&i=${encodedQuery}`,
      )
      if (!res.ok) return `Wolfram Alpha error: HTTP ${res.status}`
      return await res.text()
    }

    // Full Results API — returns structured pods
    const res = await fetch(
      `https://api.wolframalpha.com/v2/query?appid=${appId}&input=${encodedQuery}&format=plaintext&output=JSON`,
    )
    if (!res.ok) return `Wolfram Alpha error: HTTP ${res.status}`

    const data = (await res.json()) as any
    const result = data.queryresult
    if (!result?.success) {
      const didyoumeans = result?.didyoumeans
      if (didyoumeans) {
        return `Wolfram Alpha could not interpret the query. Did you mean: ${JSON.stringify(didyoumeans)}`
      }
      return 'Wolfram Alpha could not interpret this query. Try rephrasing in Mathematica-style syntax.'
    }

    // Format pods into readable text
    const pods = result.pods ?? []
    const lines: string[] = []
    for (const pod of pods) {
      lines.push(`## ${pod.title}`)
      for (const sub of pod.subpods ?? []) {
        if (sub.plaintext) lines.push(sub.plaintext)
      }
      lines.push('')
    }
    const output = lines.join('\n')
    return output.length > 30_000
      ? output.slice(0, 30_000) + '\n... [truncated]'
      : output
  } catch (err) {
    return `Wolfram Alpha error: ${(err as Error).message}`
  }
}

export async function executeSympyEval(
  input: Record<string, unknown>,
): Promise<string> {
  const code = input.code as string
  const timeoutMs = Math.min((input.timeout_ms as number) ?? 30_000, 120_000)

  // Wrap user code with common imports and import restrictions for safety.
  // Block modules that allow arbitrary system access (shell, network, filesystem mutation).
  const fullCode = `
import sys
import builtins

_original_import = builtins.__import__
_BLOCKED_MODULES = frozenset({
    'subprocess', 'os', 'shutil', 'socket', 'http', 'urllib', 'requests',
    'ctypes', 'signal', 'multiprocessing', 'threading', 'asyncio',
    'webbrowser', 'ftplib', 'smtplib', 'telnetlib', 'xmlrpc',
    'importlib', 'code', 'codeop', 'compile', 'compileall',
    'pathlib', 'tempfile', 'glob', 'zipfile', 'tarfile',
})

def _restricted_import(name, *args, **kwargs):
    top = name.split('.')[0]
    if top in _BLOCKED_MODULES:
        raise ImportError(f"Import of '{name}' is blocked in sympy_eval for security")
    return _original_import(name, *args, **kwargs)

builtins.__import__ = _restricted_import

# Block dangerous builtins that bypass import restrictions
def _blocked(*a, **kw):
    raise PermissionError("This builtin is blocked in sympy_eval for security")

builtins.open = _blocked
builtins.exec = _blocked
builtins.eval = _blocked
builtins.compile = _blocked
builtins.__import__ = _restricted_import

try:
    from sympy import *
    import numpy as np
    from scipy import linalg as sp_linalg
except ImportError as e:
    print(f"Import error: {e}", file=sys.stderr)

# User code:
${code}
`.trim()

  try {
    const proc = Bun.spawn(['python3', '-c', fullCode], {
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: getWorkingDir(),
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: '1',
      },
    })

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        proc.kill()
        reject(new Error(`SymPy evaluation timed out after ${timeoutMs}ms`))
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
    return `SymPy error: ${(err as Error).message}`
  }
}

// ── HuggingFace Tool Execution ───────────────────────────

export async function executeHFSearchModels(
  input: Record<string, unknown>,
): Promise<string> {
  try {
    const query = (input.query as string) ?? ''
    const task = input.task as string | undefined
    const library = input.library as string | undefined
    const sort = (input.sort as string) ?? 'downloads'
    const maxResults = Math.min((input.max_results as number) ?? 10, 50)

    const params = new URLSearchParams({ search: query, limit: String(maxResults), sort })
    if (task) params.set('pipeline_tag', task)
    if (library) params.set('library', library)

    const headers: Record<string, string> = {}
    const hfToken = process.env.HF_TOKEN
    if (hfToken) headers['Authorization'] = `Bearer ${hfToken}`

    const resp = await fetch(`https://huggingface.co/api/models?${params}`, { headers })
    if (!resp.ok) return `HuggingFace API error: ${resp.status} ${resp.statusText}`

    const models = (await resp.json()) as Array<{
      modelId?: string
      id?: string
      downloads?: number
      likes?: number
      pipeline_tag?: string
      tags?: string[]
      lastModified?: string
    }>

    if (models.length === 0) return `No models found for: "${query}"`

    const lines = [`Found ${models.length} models:\n`]
    for (const m of models) {
      const id = m.modelId ?? m.id ?? 'unknown'
      lines.push(`**${id}**`)
      if (m.pipeline_tag) lines.push(`  Task: ${m.pipeline_tag}`)
      lines.push(`  Downloads: ${(m.downloads ?? 0).toLocaleString()} | Likes: ${m.likes ?? 0}`)
      if (m.tags && m.tags.length > 0) lines.push(`  Tags: ${m.tags.slice(0, 8).join(', ')}`)
      lines.push('')
    }
    return lines.join('\n')
  } catch (err) {
    return `HuggingFace search error: ${(err as Error).message}`
  }
}

export async function executeHFSearchDatasets(
  input: Record<string, unknown>,
): Promise<string> {
  try {
    const query = (input.query as string) ?? ''
    const task = input.task as string | undefined
    const sort = (input.sort as string) ?? 'downloads'
    const maxResults = Math.min((input.max_results as number) ?? 10, 50)

    const params = new URLSearchParams({ search: query, limit: String(maxResults), sort })
    if (task) params.set('task_categories', task)

    const headers: Record<string, string> = {}
    const hfToken = process.env.HF_TOKEN
    if (hfToken) headers['Authorization'] = `Bearer ${hfToken}`

    const resp = await fetch(`https://huggingface.co/api/datasets?${params}`, { headers })
    if (!resp.ok) return `HuggingFace API error: ${resp.status} ${resp.statusText}`

    const datasets = (await resp.json()) as Array<{
      id?: string
      downloads?: number
      likes?: number
      tags?: string[]
      description?: string
    }>

    if (datasets.length === 0) return `No datasets found for: "${query}"`

    const lines = [`Found ${datasets.length} datasets:\n`]
    for (const d of datasets) {
      lines.push(`**${d.id ?? 'unknown'}**`)
      lines.push(`  Downloads: ${(d.downloads ?? 0).toLocaleString()} | Likes: ${d.likes ?? 0}`)
      if (d.description) lines.push(`  ${d.description.slice(0, 150)}`)
      if (d.tags && d.tags.length > 0) lines.push(`  Tags: ${d.tags.slice(0, 6).join(', ')}`)
      lines.push('')
    }
    return lines.join('\n')
  } catch (err) {
    return `HuggingFace dataset search error: ${(err as Error).message}`
  }
}

export async function executeHFModelInfo(
  input: Record<string, unknown>,
): Promise<string> {
  try {
    const modelId = (input.model_id as string) ?? ''
    if (!modelId) return 'Error: model_id is required'

    const headers: Record<string, string> = {}
    const hfToken = process.env.HF_TOKEN
    if (hfToken) headers['Authorization'] = `Bearer ${hfToken}`

    const resp = await fetch(`https://huggingface.co/api/models/${modelId}`, { headers })
    if (!resp.ok) {
      if (resp.status === 404) return `Model "${modelId}" not found`
      return `HuggingFace API error: ${resp.status} ${resp.statusText}`
    }

    const model = (await resp.json()) as {
      modelId?: string
      id?: string
      downloads?: number
      likes?: number
      pipeline_tag?: string
      tags?: string[]
      library_name?: string
      config?: Record<string, unknown>
      cardData?: { license?: string; language?: string[] }
      siblings?: Array<{ rfilename: string }>
      lastModified?: string
    }

    const lines: string[] = []
    lines.push(`# ${model.modelId ?? model.id ?? modelId}`)
    if (model.pipeline_tag) lines.push(`Task: ${model.pipeline_tag}`)
    if (model.library_name) lines.push(`Library: ${model.library_name}`)
    lines.push(`Downloads: ${(model.downloads ?? 0).toLocaleString()} | Likes: ${model.likes ?? 0}`)
    if (model.lastModified) lines.push(`Last modified: ${model.lastModified}`)
    if (model.tags && model.tags.length > 0) lines.push(`Tags: ${model.tags.join(', ')}`)
    if (model.cardData?.license) lines.push(`License: ${model.cardData.license}`)
    if (model.cardData?.language) lines.push(`Languages: ${model.cardData.language.join(', ')}`)

    if (model.siblings && model.siblings.length > 0) {
      lines.push(`\nFiles (${model.siblings.length}):`)
      for (const f of model.siblings.slice(0, 20)) {
        lines.push(`  ${f.rfilename}`)
      }
      if (model.siblings.length > 20) lines.push(`  ... and ${model.siblings.length - 20} more`)
    }

    // Fetch README
    try {
      const readmeResp = await fetch(
        `https://huggingface.co/${modelId}/raw/main/README.md`,
        { headers },
      )
      if (readmeResp.ok) {
        const readme = await readmeResp.text()
        const snippet = readme.length > 2000 ? readme.slice(0, 2000) + '\n... [truncated]' : readme
        lines.push(`\n## README\n${snippet}`)
      }
    } catch {
      // README not available
    }

    return lines.join('\n')
  } catch (err) {
    return `HuggingFace model info error: ${(err as Error).message}`
  }
}

export async function executeHFDatasetPreview(
  input: Record<string, unknown>,
): Promise<string> {
  try {
    const datasetId = (input.dataset_id as string) ?? ''
    if (!datasetId) return 'Error: dataset_id is required'
    const split = (input.split as string) ?? 'train'
    const config = input.config as string | undefined
    const maxRows = Math.min((input.max_rows as number) ?? 5, 100)

    const params = new URLSearchParams({ dataset: datasetId, split })
    if (config) params.set('config', config)

    const resp = await fetch(
      `https://datasets-server.huggingface.co/first-rows?${params}`,
    )
    if (!resp.ok) {
      if (resp.status === 404) return `Dataset "${datasetId}" not found or not available for preview`
      return `Dataset server error: ${resp.status} ${resp.statusText}`
    }

    const data = (await resp.json()) as {
      features?: Array<{ feature_idx: number; name: string; type: { dtype?: string } }>
      rows?: Array<{ row_idx: number; row: Record<string, unknown> }>
    }

    if (!data.rows || data.rows.length === 0) return `No rows available for dataset "${datasetId}"`

    const features = data.features ?? []
    const columnNames = features.map(f => f.name)
    const rows = data.rows.slice(0, maxRows)

    const lines = [`Dataset: ${datasetId} (split: ${split})\n`]
    lines.push(`Columns (${columnNames.length}): ${columnNames.join(', ')}\n`)

    for (const r of rows) {
      lines.push(`--- Row ${r.row_idx} ---`)
      for (const col of columnNames) {
        const val = r.row[col]
        const valStr = typeof val === 'string'
          ? (val.length > 200 ? val.slice(0, 200) + '...' : val)
          : JSON.stringify(val)?.slice(0, 200) ?? 'null'
        lines.push(`  ${col}: ${valStr}`)
      }
    }

    return lines.join('\n')
  } catch (err) {
    return `Dataset preview error: ${(err as Error).message}`
  }
}

// ── Academic Tool Execution ──────────────────────────────

export async function executeOpenAlexSearch(
  input: Record<string, unknown>,
): Promise<string> {
  try {
    const query = (input.query as string) ?? ''
    const entity = (input.entity as string) ?? 'works'
    const filter = input.filter as string | undefined
    const sort = (input.sort as string) ?? 'relevance_score'
    const maxResults = Math.min((input.max_results as number) ?? 10, 50)

    const params = new URLSearchParams({ search: query, per_page: String(maxResults) })
    if (sort !== 'relevance_score') params.set('sort', sort)
    if (filter) params.set('filter', filter)

    const mailto = process.env.OPENALEX_MAILTO
    if (mailto) params.set('mailto', mailto)

    const resp = await fetch(`https://api.openalex.org/${entity}?${params}`)
    if (!resp.ok) return `OpenAlex API error: ${resp.status} ${resp.statusText}`

    const data = (await resp.json()) as {
      meta?: { count?: number }
      results?: Array<Record<string, unknown>>
    }

    const results = data.results ?? []
    if (results.length === 0) return `No ${entity} found for: "${query}"`

    const totalCount = data.meta?.count ?? results.length
    const lines = [`Found ${totalCount} ${entity} (showing ${results.length}):\n`]

    if (entity === 'works') {
      for (const w of results) {
        const title = (w.title as string) ?? 'Untitled'
        const year = w.publication_year as number | undefined
        const cited = w.cited_by_count as number | undefined
        const doi = w.doi as string | undefined
        const oaUrl = (w.open_access as { oa_url?: string })?.oa_url
        const authorships = (w.authorships as Array<{ author: { display_name: string } }>) ?? []
        const authors = authorships.slice(0, 3).map(a => a.author?.display_name).filter(Boolean)

        lines.push(`**${title}** (${year ?? 'n/a'})`)
        if (authors.length > 0) lines.push(`  Authors: ${authors.join(', ')}${authorships.length > 3 ? ' et al.' : ''}`)
        lines.push(`  Cited by: ${cited ?? 0}`)
        if (doi) lines.push(`  DOI: ${doi}`)
        if (oaUrl) lines.push(`  Open Access: ${oaUrl}`)
        lines.push('')
      }
    } else {
      for (const r of results) {
        const name = (r.display_name as string) ?? (r.title as string) ?? 'Unknown'
        const worksCount = r.works_count as number | undefined
        const citedBy = r.cited_by_count as number | undefined
        lines.push(`**${name}**`)
        if (worksCount) lines.push(`  Works: ${worksCount}`)
        if (citedBy) lines.push(`  Cited by: ${citedBy}`)
        lines.push('')
      }
    }

    return lines.join('\n')
  } catch (err) {
    return `OpenAlex search error: ${(err as Error).message}`
  }
}

export async function executeDblpSearch(
  input: Record<string, unknown>,
): Promise<string> {
  try {
    const query = (input.query as string) ?? ''
    const maxResults = Math.min((input.max_results as number) ?? 10, 50)

    const params = new URLSearchParams({
      q: query,
      format: 'json',
      h: String(maxResults),
    })

    const resp = await fetch(`https://dblp.org/search/publ/api?${params}`)
    if (!resp.ok) return `DBLP API error: ${resp.status} ${resp.statusText}`

    const data = (await resp.json()) as {
      result?: {
        hits?: {
          '@total'?: string
          hit?: Array<{
            info?: {
              title?: string
              authors?: { author?: Array<{ text?: string } | string> | { text?: string } | string }
              year?: string
              venue?: string
              type?: string
              doi?: string
              url?: string
            }
          }>
        }
      }
    }

    const hits = data.result?.hits?.hit ?? []
    if (hits.length === 0) return `No publications found for: "${query}"`

    const total = data.result?.hits?.['@total'] ?? hits.length
    const lines = [`Found ${total} publications (showing ${hits.length}):\n`]

    for (const hit of hits) {
      const info = hit.info
      if (!info) continue
      lines.push(`**${info.title ?? 'Untitled'}** (${info.year ?? 'n/a'})`)

      // Parse authors — DBLP has varying formats
      let authorList: string[] = []
      if (info.authors?.author) {
        const rawAuthors = info.authors.author
        if (Array.isArray(rawAuthors)) {
          authorList = rawAuthors.map(a => (typeof a === 'string' ? a : a.text ?? '')).filter(Boolean)
        } else if (typeof rawAuthors === 'string') {
          authorList = [rawAuthors]
        } else if (rawAuthors.text) {
          authorList = [rawAuthors.text]
        }
      }
      if (authorList.length > 0) lines.push(`  Authors: ${authorList.join(', ')}`)
      if (info.venue) lines.push(`  Venue: ${info.venue}`)
      if (info.type) lines.push(`  Type: ${info.type}`)
      if (info.doi) lines.push(`  DOI: ${info.doi}`)
      if (info.url) lines.push(`  URL: ${info.url}`)
      lines.push('')
    }

    return lines.join('\n')
  } catch (err) {
    return `DBLP search error: ${(err as Error).message}`
  }
}

export async function executeImageAnalyze(
  input: Record<string, unknown>,
): Promise<string> {
  try {
    const imagePath = (input.image_path as string) ?? ''
    const prompt = (input.prompt as string) ?? 'Describe this image in detail.'

    if (!imagePath) return 'Error: image_path is required'
    const resolved = resolvePath(imagePath)
    if (!existsSync(resolved)) return `Error: Image not found: ${resolved}`

    // Check file size to prevent OOM (max 20MB)
    const stats = statSync(resolved)
    if (stats.size > 20 * 1024 * 1024) {
      return `Error: Image file too large (${(stats.size / 1024 / 1024).toFixed(1)}MB). Maximum is 20MB.`
    }

    const imageBuffer = readFileSync(resolved)
    const base64 = imageBuffer.toString('base64')

    // Determine MIME type
    const ext = resolved.split('.').pop()?.toLowerCase() ?? ''
    const mimeMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      gif: 'image/gif',
    }
    const mimeType = mimeMap[ext] ?? 'image/png'

    // Use chatCompletion with a vision-capable model
    const { loadModelAssignments } = await import('../llm-client')
    const assignments = loadModelAssignments()
    // Prefer a vision-capable model; fallback to research model
    const modelSpec = assignments.research || DEFAULT_MODEL_ASSIGNMENTS.research

    const result = await chatCompletion({
      modelSpec,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: base64,
              },
            },
            { type: 'text', text: prompt },
          ] as any,
        },
      ],
      system: 'You are a helpful assistant that analyzes images. Provide detailed, accurate descriptions.',
      max_tokens: 4096,
    })

    return result.text || 'No analysis generated.'
  } catch (err) {
    return `Image analysis error: ${(err as Error).message}`
  }
}

