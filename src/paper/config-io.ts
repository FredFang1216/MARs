import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs'
import { join } from 'path'
import { DEFAULT_MODEL_ASSIGNMENTS } from './types'

export const CONFIG_DIR = join(
  process.env.HOME ?? process.env.USERPROFILE ?? '.',
  '.claude-paper',
)
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json')

export function loadConfig(): Record<string, any> {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
    }
  } catch {
    // ignore
  }
  return getDefaultConfig()
}

export function saveConfig(config: Record<string, any>): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o600,
  })
  try {
    chmodSync(CONFIG_DIR, 0o700)
    chmodSync(CONFIG_PATH, 0o600)
  } catch {
    // best-effort on systems where chmod may fail
  }
}

export function getDefaultConfig(): Record<string, any> {
  return {
    models: {
      research: DEFAULT_MODEL_ASSIGNMENTS.research,
      reasoning: DEFAULT_MODEL_ASSIGNMENTS.reasoning,
      reasoning_deep: DEFAULT_MODEL_ASSIGNMENTS.reasoning_deep,
      coding: DEFAULT_MODEL_ASSIGNMENTS.coding,
      writing: DEFAULT_MODEL_ASSIGNMENTS.writing,
      review: DEFAULT_MODEL_ASSIGNMENTS.review,
      quick: DEFAULT_MODEL_ASSIGNMENTS.quick,
    },
    proposals: {
      count: 3,
      detail_level: 'full',
      include_feasibility: true,
      include_risk: true,
      include_timeline: true,
      auto_novelty_check: true,
      focus_constraints: [],
    },
    review: {
      num_reviewers: 3,
      max_rounds: 3,
      strength: 'standard',
      acceptance_threshold: 7.0,
      ground_in_literature: true,
      check_novelty: true,
      auto_accept: false,
    },
    paper: {
      template: 'neurips',
      compiler: 'pdflatex',
      language: 'english',
      max_pages: 10,
    },
    experiment: {
      python_version: '3.11',
      gpu_required: false,
      max_runtime_hours: 4,
      auto_retry_on_error: true,
      max_retries: 3,
      prefer_docker: false,
    },
    orchestrator: {
      rigor_level: 2,
    },
    auto_mode: false,
  }
}

export function getNestedValue(obj: any, path: string): any {
  const keys = path.split('.')
  let current = obj
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined
    current = current[key]
  }
  return current
}

export function setNestedValue(obj: any, path: string, value: any): void {
  const keys = path.split('.')
  let current = obj
  for (let i = 0; i < keys.length - 1; i++) {
    if (current[keys[i]] == null || typeof current[keys[i]] !== 'object') {
      current[keys[i]] = {}
    }
    current = current[keys[i]]
  }
  current[keys[keys.length - 1]] = value
}

export function parseValue(raw: string): any {
  if (raw === 'true') return true
  if (raw === 'false') return false
  const num = Number(raw)
  if (!isNaN(num) && raw.trim() !== '') return num
  // Array
  if (raw.startsWith('[') && raw.endsWith(']')) {
    try {
      return JSON.parse(raw)
    } catch {
      // fall through
    }
  }
  return raw
}

export function formatConfig(config: Record<string, any>, prefix = ''): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(config)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      lines.push(`[${fullKey}]`)
      lines.push(formatConfig(value, fullKey))
    } else {
      lines.push(`  ${fullKey} = ${JSON.stringify(value)}`)
    }
  }
  return lines.join('\n')
}
