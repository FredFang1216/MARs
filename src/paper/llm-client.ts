import Anthropic from '@anthropic-ai/sdk'
import { OpenAI } from 'openai'
import { existsSync, readFileSync } from 'fs'
import os from 'os'
import { join } from 'path'
import { DEFAULT_MODEL_ASSIGNMENTS } from './types'
import { addToTotalCost } from '../core/costTracker'

export type PaperProvider = 'anthropic' | 'openai' | 'deepseek' | 'qwen' | 'glm'

let cachedAnthropicClient: Anthropic | null = null
let cachedOpenAIClient: OpenAI | null = null

interface LoadedConfig {
  api_keys?: { anthropic?: string; anthropic_auth_token?: string; openai?: string; deepseek?: string; qwen?: string; glm?: string }
  models?: Record<string, string>
  advanced_models?: Record<
    string,
    {
      temperature?: number
      max_output_tokens?: number
      base_url?: string
      thinking_effort?: 'low' | 'medium' | 'high' | 'max'
    }
  >
}

let cachedConfig: LoadedConfig | null = null

/**
 * Invalidate all cached config and client instances.
 * Must be called after config is updated (e.g. via web UI settings save).
 */
export function invalidateCaches(): void {
  cachedConfig = null
  cachedAnthropicClient = null
  cachedOpenAIClient = null
  // Clear compat clients (deepseek, qwen, glm)
  for (const key of Object.keys(cachedCompatClients)) {
    delete cachedCompatClients[key]
  }
}

function loadConfig(): LoadedConfig {
  if (cachedConfig) return cachedConfig
  try {
    const configPath = join(os.homedir(), '.claude-paper', 'config.json')
    if (existsSync(configPath)) {
      cachedConfig = JSON.parse(readFileSync(configPath, 'utf-8'))
      return cachedConfig!
    }
  } catch {
    // ignore
  }
  cachedConfig = {}
  return cachedConfig
}

function loadApiKeyFromConfig(): {
  anthropic?: string
  anthropic_auth_token?: string
  openai?: string
  deepseek?: string
  qwen?: string
  glm?: string
} {
  const config = loadConfig()
  return {
    anthropic: config?.api_keys?.anthropic,
    anthropic_auth_token: config?.api_keys?.anthropic_auth_token,
    openai: config?.api_keys?.openai,
    deepseek: config?.api_keys?.deepseek,
    qwen: config?.api_keys?.qwen,
    glm: config?.api_keys?.glm,
  }
}

/**
 * Load model assignments from config, falling back to DEFAULT_MODEL_ASSIGNMENTS.
 * Called by modules that need to resolve role → model spec.
 */
export function loadModelAssignments(): Record<string, string> {
  const config = loadConfig()
  if (config.models && Object.keys(config.models).length > 0) {
    return config.models
  }
  return {} // Caller should use DEFAULT_MODEL_ASSIGNMENTS as fallback
}

/**
 * Get advanced model config for a specific role.
 */
function getAdvancedConfig(modelRole: string):
  | {
      temperature?: number
      max_output_tokens?: number
      thinking_effort?: 'low' | 'medium' | 'high' | 'max'
    }
  | undefined {
  const config = loadConfig()
  return config.advanced_models?.[modelRole]
}

// ── Token Tracker ────────────────────────────────────────

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  calls: number
  cost_usd: number
}

let sessionUsage: TokenUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  calls: 0,
  cost_usd: 0,
}

let commandUsage: TokenUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  calls: 0,
  cost_usd: 0,
}

// Pricing per million tokens (2025 rates).
// Keys are sorted longest-first so includes() matching picks the most specific entry.
const COST_TABLE: Record<string, { input: number; output: number }> = {
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  'deepseek-coder': { input: 0.14, output: 0.28 },
  'deepseek-chat': { input: 0.27, output: 1.10 },
  'gpt-5.4-mini': { input: 1, output: 5 },
  'gpt-5.4-pro': { input: 15, output: 60 },
  'gpt-5.4': { input: 2.5, output: 10 },
  'glm-4-flash': { input: 0.07, output: 0.07 },
  'glm-4-plus': { input: 7.14, output: 7.14 },
  'glm-4-long': { input: 1.43, output: 1.43 },
  'qwen-turbo': { input: 0.30, output: 0.60 },
  'qwen-plus': { input: 0.80, output: 2.00 },
  'qwen-long': { input: 0.07, output: 0.28 },
  'qwen-max': { input: 2.40, output: 9.60 },
  'o3-mini': { input: 1.10, output: 4.40 },
  opus: { input: 15, output: 75 },
  haiku: { input: 0.25, output: 1.25 },
  sonnet: { input: 3, output: 15 },
  'gpt-5': { input: 10, output: 30 },
  'gpt-4': { input: 2.5, output: 10 },
  o3: { input: 10, output: 40 },
  o4: { input: 10, output: 40 },
}

const DEFAULT_RATES = { input: 3, output: 15 } // Sonnet-tier fallback

// Sorted keys by length descending for most-specific-first matching
const COST_TABLE_KEYS = Object.keys(COST_TABLE).sort((a, b) => b.length - a.length)

export function estimateCost(input: number, output: number, model: string): number {
  // Try exact match first
  let rates = COST_TABLE[model]
  if (!rates) {
    // Longest-key-first matching prevents e.g. "gpt-5" from matching before "gpt-5.4-mini"
    for (const key of COST_TABLE_KEYS) {
      if (model.includes(key)) {
        rates = COST_TABLE[key]
        break
      }
    }
  }
  if (!rates) rates = DEFAULT_RATES
  return (input / 1_000_000) * rates.input + (output / 1_000_000) * rates.output
}

function trackOpenAIResponse(
  response: any,
  model: string,
  durationMs: number = 0,
): void {
  const usage = response?.usage
  if (!usage) return

  const input = usage.prompt_tokens ?? 0
  const output = usage.completion_tokens ?? 0
  const cost = estimateCost(input, output, model)

  sessionUsage.input_tokens += input
  sessionUsage.output_tokens += output
  sessionUsage.calls += 1
  sessionUsage.cost_usd += cost

  commandUsage.input_tokens += input
  commandUsage.output_tokens += output
  commandUsage.calls += 1
  commandUsage.cost_usd += cost

  // Bridge to global cost tracker for session-end display
  addToTotalCost(cost, durationMs)
}

function trackResponse(
  response: any,
  model: string,
  durationMs: number = 0,
): void {
  const usage = response?.usage
  if (!usage) return

  const input = usage.input_tokens ?? 0
  const output = usage.output_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const cost = estimateCost(input, output, model)

  sessionUsage.input_tokens += input
  sessionUsage.output_tokens += output
  sessionUsage.cache_read_tokens += cacheRead
  sessionUsage.cache_write_tokens += cacheWrite
  sessionUsage.calls += 1
  sessionUsage.cost_usd += cost

  commandUsage.input_tokens += input
  commandUsage.output_tokens += output
  commandUsage.cache_read_tokens += cacheRead
  commandUsage.cache_write_tokens += cacheWrite
  commandUsage.calls += 1
  commandUsage.cost_usd += cost

  // Bridge to global cost tracker for session-end display
  addToTotalCost(cost, durationMs)
}

/** Reset command-level counters (call at start of each command) */
export function resetCommandUsage(): void {
  commandUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    calls: 0,
    cost_usd: 0,
  }
}

/** Get current command's token usage */
export function getCommandUsage(): TokenUsage {
  return { ...commandUsage }
}

/** Get total session usage */
export function getSessionUsage(): TokenUsage {
  return { ...sessionUsage }
}

/** Format token usage as a compact string */
export function formatUsage(usage: TokenUsage): string {
  const tokens = usage.input_tokens + usage.output_tokens
  if (tokens === 0) return ''
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
  return `${k(tokens)} tokens (${k(usage.input_tokens)} in, ${k(usage.output_tokens)} out) | $${usage.cost_usd.toFixed(4)} | ${usage.calls} calls`
}

// ── Client Factories ─────────────────────────────────────

const ANTHROPIC_SETUP_TOKEN_PREFIX = 'sk-ant-oat01-'

function isSetupToken(value: string): boolean {
  return value.startsWith(ANTHROPIC_SETUP_TOKEN_PREFIX) && value.length >= 80
}

/**
 * Get a shared Anthropic client for paper modules.
 * Supports both API key and setup-token (subscription) authentication.
 * All messages.create() calls are automatically tracked for token usage.
 */
export function getAnthropicClient(): Anthropic {
  if (cachedAnthropicClient) return cachedAnthropicClient

  const keys = loadApiKeyFromConfig()

  // 1. Check for setup-token (subscription auth) — env var or config
  let authToken = process.env.ANTHROPIC_AUTH_TOKEN
  if (!authToken) {
    // Check dedicated auth_token field first, then auto-detect from anthropic key
    if (keys.anthropic_auth_token) {
      authToken = keys.anthropic_auth_token
    } else if (keys.anthropic && isSetupToken(keys.anthropic)) {
      authToken = keys.anthropic
    }
  }

  // 2. Check for API key (only if no auth token found)
  let apiKey: string | undefined
  if (!authToken) {
    apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey && keys.anthropic && !isSetupToken(keys.anthropic)) {
      apiKey = keys.anthropic
      process.env.ANTHROPIC_API_KEY = apiKey
    }
  }

  if (!authToken && !apiKey) {
    throw new Error(
      [
        'No Anthropic credentials found.',
        '',
        'Set up authentication in one of these ways:',
        '',
        '  1. API key (usage-based billing):',
        '     export ANTHROPIC_API_KEY="sk-ant-..."',
        '     Get a key at: https://console.anthropic.com/settings/keys',
        '',
        '  2. Setup token (subscription billing):',
        '     export ANTHROPIC_AUTH_TOKEN="sk-ant-oat01-..."',
        '     Run "claude setup-token" to generate one',
        '',
        '  3. Run the setup wizard: /onboarding',
      ].join('\n'),
    )
  }

  const realClient = authToken
    ? new Anthropic({ authToken })
    : new Anthropic({ apiKey: apiKey! })

  // Wrap messages.create to auto-track tokens
  const originalCreate = realClient.messages.create.bind(realClient.messages)
  realClient.messages.create = (async (...args: any[]) => {
    const t0 = Date.now()
    const response = await (originalCreate as any)(...args)
    const model =
      typeof args[0] === 'object' ? (args[0].model ?? 'unknown') : 'unknown'
    trackResponse(response, model, Date.now() - t0)
    return response
  }) as any

  cachedAnthropicClient = realClient
  return cachedAnthropicClient
}

/**
 * Get a shared OpenAI client for paper modules.
 * Used for reasoning (gpt-5.4-pro) and review models.
 */
export function getOpenAIClient(): OpenAI {
  if (cachedOpenAIClient) return cachedOpenAIClient

  let apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    const keys = loadApiKeyFromConfig()
    apiKey = keys.openai
    if (apiKey) {
      process.env.OPENAI_API_KEY = apiKey
    }
  }

  if (!apiKey) {
    throw new Error(
      [
        'OPENAI_API_KEY is not set.',
        '',
        'Claude Paper uses OpenAI models for reasoning and review tasks.',
        'Set it in one of these ways:',
        '',
        '  1. Environment variable:',
        '     export OPENAI_API_KEY="sk-..."',
        '',
        '  2. Run /settings api_keys.openai "sk-..."',
        '',
        'Get a key at: https://platform.openai.com/api-keys',
      ].join('\n'),
    )
  }

  cachedOpenAIClient = new OpenAI({
    apiKey,
    timeout: 1_800_000, // 30 minutes — reasoning models can take a long time
  })
  return cachedOpenAIClient
}

// ── OpenAI-Compatible Client Factory ─────────────────────

const OPENAI_COMPAT_PROVIDERS: Record<
  string,
  { envKeys: string[]; baseURL: string; label: string; helpUrl: string }
> = {
  deepseek: {
    envKeys: ['DEEPSEEK_API_KEY'],
    baseURL: 'https://api.deepseek.com/v1',
    label: 'DeepSeek',
    helpUrl: 'https://platform.deepseek.com/api_keys',
  },
  qwen: {
    envKeys: ['DASHSCOPE_API_KEY', 'QWEN_API_KEY'],
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    label: 'Qwen (DashScope)',
    helpUrl: 'https://dashscope.console.aliyun.com/apiKey',
  },
  glm: {
    envKeys: ['ZHIPU_API_KEY', 'GLM_API_KEY'],
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    label: 'GLM (Zhipu AI)',
    helpUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
}

const cachedCompatClients: Record<string, OpenAI> = {}

/**
 * Get an OpenAI-compatible client for DeepSeek, Qwen, or GLM providers.
 */
export function getOpenAICompatibleClient(provider: string): OpenAI {
  if (cachedCompatClients[provider]) return cachedCompatClients[provider]

  const info = OPENAI_COMPAT_PROVIDERS[provider]
  if (!info) throw new Error(`Unknown OpenAI-compatible provider: ${provider}`)

  let apiKey: string | undefined
  for (const envKey of info.envKeys) {
    apiKey = process.env[envKey]
    if (apiKey) break
  }

  if (!apiKey) {
    const keys = loadApiKeyFromConfig()
    apiKey = (keys as any)[provider]
    if (apiKey) {
      process.env[info.envKeys[0]] = apiKey
    }
  }

  if (!apiKey) {
    throw new Error(
      [
        `${info.envKeys[0]} is not set.`,
        '',
        `Claude Paper requires a ${info.label} API key to use ${info.label} models.`,
        'Set it in one of these ways:',
        '',
        '  1. Environment variable:',
        `     export ${info.envKeys[0]}="your-key"`,
        '',
        '  2. Run the setup wizard:',
        '     /onboarding',
        '',
        `Get a key at: ${info.helpUrl}`,
      ].join('\n'),
    )
  }

  const client = new OpenAI({
    apiKey,
    baseURL: info.baseURL,
    timeout: 1_800_000,
  })
  cachedCompatClients[provider] = client
  return client
}

// ── Provider Credential Detection ──────────────────────

/**
 * Check whether credentials are available for a given provider
 * without instantiating a client or throwing.
 */
export function hasCredentials(provider: PaperProvider): boolean {
  const keys = loadApiKeyFromConfig()

  switch (provider) {
    case 'anthropic': {
      if (process.env.ANTHROPIC_AUTH_TOKEN) return true
      if (keys.anthropic_auth_token) return true
      if (keys.anthropic) return true
      if (process.env.ANTHROPIC_API_KEY) return true
      return false
    }
    case 'openai': {
      if (process.env.OPENAI_API_KEY) return true
      if (keys.openai) return true
      return false
    }
    default: {
      const info = OPENAI_COMPAT_PROVIDERS[provider]
      if (!info) return false
      for (const envKey of info.envKeys) {
        if (process.env[envKey]) return true
      }
      if ((keys as any)[provider]) return true
      return false
    }
  }
}

/**
 * Return a list of providers that have credentials configured,
 * in preferred fallback order.
 */
export function getAvailableProviders(): PaperProvider[] {
  const all: PaperProvider[] = ['anthropic', 'openai', 'deepseek', 'qwen', 'glm']
  return all.filter(p => hasCredentials(p))
}

// ── Provider Fallback ──────────────────────────────────

const FALLBACK_MODELS: Record<PaperProvider, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  deepseek: 'deepseek-chat',
  qwen: 'qwen-plus',
  glm: 'glm-4-plus',
}

/**
 * If the requested provider has no credentials, find an alternative
 * provider that does and return a remapped modelSpec.
 * Returns { modelSpec, fallback: true } if remapped, or { modelSpec, fallback: false } if unchanged.
 */
export function resolveWithFallback(modelSpec: string): { modelSpec: string; fallback: boolean; originalProvider?: PaperProvider; resolvedProvider?: PaperProvider } {
  const provider = getProviderFromSpec(modelSpec)
  if (hasCredentials(provider)) {
    return { modelSpec, fallback: false }
  }

  const available = getAvailableProviders()
  if (available.length === 0) {
    return { modelSpec, fallback: false }
  }

  const target = available[0]
  const fallbackModel = FALLBACK_MODELS[target]
  return {
    modelSpec: `${target}:${fallbackModel}`,
    fallback: true,
    originalProvider: provider,
    resolvedProvider: target,
  }
}

// ── Provider Detection ──────────────────────────────────

/**
 * Determine the provider from a "provider:model" spec string.
 */
export function getProviderFromSpec(modelSpec: string): PaperProvider {
  const colonIdx = modelSpec.indexOf(':')
  if (colonIdx < 0) {
    // No provider prefix — infer from model name
    if (modelSpec.startsWith('deepseek')) return 'deepseek'
    if (modelSpec.startsWith('qwen')) return 'qwen'
    if (modelSpec.startsWith('glm')) return 'glm'
    if (
      modelSpec.includes('gpt') ||
      modelSpec.includes('o3') ||
      modelSpec.includes('o4')
    ) {
      return 'openai'
    }
    return 'anthropic'
  }
  const provider = modelSpec.slice(0, colonIdx).toLowerCase()
  if (provider === 'openai') return 'openai'
  if (provider === 'deepseek') return 'deepseek'
  if (provider === 'qwen') return 'qwen'
  if (provider === 'glm') return 'glm'
  return 'anthropic'
}

// ── Unified Chat Completion ─────────────────────────────

export interface UnifiedMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface UnifiedChatOptions {
  modelSpec: string // "provider:model" or just "model"
  messages: UnifiedMessage[]
  system?: string
  max_tokens?: number
  temperature?: number
  reasoning_effort?: 'low' | 'medium' | 'high' | 'max'
  tools?: any[] // Anthropic tool format
  signal?: AbortSignal
}

export interface UnifiedChatResult {
  text: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
  tool_calls?: Array<{
    id: string
    name: string
    input: Record<string, unknown>
  }>
  stop_reason: string
}

/**
 * Unified chat completion that routes to Anthropic or OpenAI based on model spec.
 * Handles format conversion between the two APIs.
 * Applies advanced model config (temperature, max_output_tokens) from user config.
 */
export async function chatCompletion(
  opts: UnifiedChatOptions,
): Promise<UnifiedChatResult> {
  // Auto-fallback: if requested provider has no credentials, switch to one that does
  const resolved = resolveWithFallback(opts.modelSpec)
  if (resolved.fallback) {
    const debugMsg = `[llm-client] ${resolved.originalProvider} credentials not found, falling back to ${resolved.resolvedProvider} (${resolved.modelSpec})`
    if (process.env.DEBUG || process.env.VERBOSE) {
      console.error(debugMsg)
    }
    opts = { ...opts, modelSpec: resolved.modelSpec }
  }

  const provider = getProviderFromSpec(opts.modelSpec)
  const colonIdx = opts.modelSpec.indexOf(':')
  const modelId =
    colonIdx >= 0 ? opts.modelSpec.slice(colonIdx + 1) : opts.modelSpec

  // Apply advanced config from user's onboarding settings
  const role = resolveModelRole(opts.modelSpec)
  if (role) {
    const advanced = getAdvancedConfig(role)
    if (advanced) {
      if (
        opts.temperature === undefined &&
        advanced.temperature !== undefined
      ) {
        opts = { ...opts, temperature: advanced.temperature }
      }
      if (
        opts.max_tokens === undefined &&
        advanced.max_output_tokens !== undefined
      ) {
        opts = { ...opts, max_tokens: advanced.max_output_tokens }
      }
      if (
        opts.reasoning_effort === undefined &&
        advanced.thinking_effort !== undefined
      ) {
        opts = { ...opts, reasoning_effort: advanced.thinking_effort }
      }
    }
  }

  if (provider === 'anthropic') {
    return chatCompletionAnthropic(modelId, opts)
  }
  // OpenAI Responses API (gpt-5.4-pro only)
  if (provider === 'openai' && needsResponsesAPI(modelId)) {
    return chatCompletionOpenAIResponses(modelId, opts)
  }
  // All OpenAI-compatible providers (openai, deepseek, qwen, glm)
  return chatCompletionOpenAICompat(provider, modelId, opts)
}

/**
 * Resolve which model role a modelSpec corresponds to.
 * Returns the role name (research, reasoning, etc.) or null.
 */
function resolveModelRole(modelSpec: string): string | null {
  const config = loadConfig()
  if (config.models) {
    for (const [role, spec] of Object.entries(config.models)) {
      if (spec === modelSpec) return role
    }
  }
  // Check against defaults
  for (const [role, spec] of Object.entries(DEFAULT_MODEL_ASSIGNMENTS)) {
    if (spec === modelSpec) return role
  }
  return null
}

async function chatCompletionAnthropic(
  model: string,
  opts: UnifiedChatOptions,
): Promise<UnifiedChatResult> {
  const client = getAnthropicClient()

  // Separate system message from conversation messages
  const messages: Anthropic.MessageParam[] = opts.messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

  const systemParts: string[] = []
  if (opts.system) systemParts.push(opts.system)
  for (const m of opts.messages) {
    if (m.role === 'system') systemParts.push(m.content)
  }

  const temperature = opts.temperature ?? undefined

  const params: Anthropic.MessageCreateParams = {
    model,
    max_tokens: opts.max_tokens ?? 16384,
    messages,
    ...(systemParts.length > 0 ? { system: systemParts.join('\n\n') } : {}),
    ...(opts.tools && opts.tools.length > 0 ? { tools: opts.tools } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
  }

  // Enable extended thinking for high/max reasoning effort
  if (opts.reasoning_effort === 'high' || opts.reasoning_effort === 'max') {
    const thinkingBudget = opts.reasoning_effort === 'max' ? 16384 : 8192
    ;(params as any).thinking = {
      type: 'enabled',
      budget_tokens: thinkingBudget,
    }
    params.temperature = 1 // Required by Anthropic when thinking is enabled
    params.max_tokens = (params.max_tokens ?? 16384) + thinkingBudget
  }

  const response = await client.messages.create(
    params,
    opts.signal ? { signal: opts.signal } : undefined,
  )

  const textBlocks = response.content.filter(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  )
  const toolUseBlocks = response.content.filter(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  )

  const usage = (response as any).usage ?? {}

  return {
    text: textBlocks.map(b => b.text).join('\n'),
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cost_usd: estimateCost(
      usage.input_tokens ?? 0,
      usage.output_tokens ?? 0,
      model,
    ),
    tool_calls:
      toolUseBlocks.length > 0
        ? toolUseBlocks.map(b => ({
            id: b.id,
            name: b.name,
            input: b.input as Record<string, unknown>,
          }))
        : undefined,
    stop_reason: response.stop_reason ?? 'end_turn',
  }
}

async function chatCompletionOpenAICompat(
  provider: PaperProvider,
  model: string,
  opts: UnifiedChatOptions,
): Promise<UnifiedChatResult> {
  const client =
    provider === 'openai'
      ? getOpenAIClient()
      : getOpenAICompatibleClient(provider)

  // Build OpenAI messages
  const messages: OpenAI.ChatCompletionMessageParam[] = []

  // System message
  const systemParts: string[] = []
  if (opts.system) systemParts.push(opts.system)
  for (const m of opts.messages) {
    if (m.role === 'system') systemParts.push(m.content)
  }
  if (systemParts.length > 0) {
    messages.push({ role: 'system', content: systemParts.join('\n\n') })
  }

  // Conversation messages
  for (const m of opts.messages) {
    if (m.role === 'system') continue
    messages.push({ role: m.role, content: m.content })
  }

  // Convert Anthropic tools to OpenAI format
  let tools: OpenAI.ChatCompletionTool[] | undefined
  if (opts.tools && opts.tools.length > 0) {
    tools = opts.tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description ?? '',
        parameters: t.input_schema ?? {},
      },
    }))
  }

  const params: OpenAI.ChatCompletionCreateParams = {
    model,
    messages,
    max_completion_tokens: opts.max_tokens ?? 16384,
    ...(tools ? { tools } : {}),
    ...(opts.temperature !== undefined
      ? { temperature: opts.temperature }
      : {}),
  }

  const t0Chat = Date.now()
  const response = await client.chat.completions.create(
    params,
    opts.signal ? { signal: opts.signal } : undefined,
  )
  const chatDuration = Date.now() - t0Chat

  const usage = response.usage
  const inputTokens = usage?.prompt_tokens ?? 0
  const outputTokens = usage?.completion_tokens ?? 0

  trackOpenAIResponse(response, model, chatDuration)

  const choice = response.choices[0]
  const text = choice?.message?.content ?? ''

  // Convert OpenAI tool calls to unified format
  let tool_calls: UnifiedChatResult['tool_calls']
  if (choice?.message?.tool_calls && choice.message.tool_calls.length > 0) {
    tool_calls = choice.message.tool_calls
      .map(tc => {
        let input: Record<string, unknown>
        try {
          input = JSON.parse(tc.function.arguments || '{}')
        } catch {
          // When response is truncated by max_tokens, tool arguments may be
          // incomplete JSON (e.g. "Unterminated string"). Try to salvage by
          // closing braces, otherwise return a marker so the caller can retry.
          const raw = tc.function.arguments || ''
          try {
            input = JSON.parse(raw + '"}')
          } catch {
            try {
              input = JSON.parse(raw + '"}}')
            } catch {
              input = {
                _parse_error: true,
                _raw_truncated: raw.slice(0, 500),
              }
            }
          }
        }
        return { id: tc.id, name: tc.function.name, input }
      })
      .filter(tc => !tc.input._parse_error)
  }

  // Detect truncation: finish_reason 'length' means max_tokens was hit
  const wasTruncated = choice?.finish_reason === 'length'

  return {
    text: wasTruncated
      ? text + '\n[WARNING: Response truncated by max_tokens limit]'
      : text,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: estimateCost(inputTokens, outputTokens, model),
    tool_calls,
    stop_reason:
      choice?.finish_reason === 'tool_calls' ? 'tool_use'
      : choice?.finish_reason === 'length' ? 'max_tokens'
      : 'end_turn',
  }
}

// ── OpenAI Responses API ────────────────────────────────

/**
 * Models that require the Responses API (not available via Chat Completions).
 * GPT-5.4-pro is Responses-only per OpenAI docs (March 2026).
 */
function needsResponsesAPI(model: string): boolean {
  return model.includes('gpt-5.4-pro')
}

/**
 * Chat completion via OpenAI's Responses API.
 * Used for models like gpt-5.4-pro that aren't available on Chat Completions.
 */
async function chatCompletionOpenAIResponses(
  model: string,
  opts: UnifiedChatOptions,
): Promise<UnifiedChatResult> {
  const client = getOpenAIClient()

  // Build instructions from system messages
  const systemParts: string[] = []
  if (opts.system) systemParts.push(opts.system)
  for (const m of opts.messages) {
    if (m.role === 'system') systemParts.push(m.content)
  }

  // Build input from conversation messages
  const input: Array<{ role: string; content: string }> = []
  for (const m of opts.messages) {
    if (m.role === 'system') continue
    input.push({ role: m.role, content: m.content })
  }

  // Convert Anthropic tool format to Responses API format
  let tools: Array<{
    type: 'function'
    name: string
    description?: string
    parameters: Record<string, unknown>
    strict: boolean
  }> = []
  if (opts.tools && opts.tools.length > 0) {
    tools = opts.tools.map(t => ({
      type: 'function' as const,
      name: t.name,
      description: t.description ?? '',
      parameters: t.input_schema ?? {},
      strict: false,
    }))
  }

  // Responses API max_output_tokens covers BOTH reasoning + message tokens.
  // Reasoning can consume 70-83% of the budget depending on effort level.
  // Scale output budget based on effort to prevent truncation.
  const effortRaw = opts.reasoning_effort ?? 'medium'
  // OpenAI ReasoningEffort only accepts 'low' | 'medium' | 'high' — map 'max' to 'high'
  const effort: 'low' | 'medium' | 'high' =
    effortRaw === 'max' ? 'high' : (effortRaw as 'low' | 'medium' | 'high')
  const callerMax = opts.max_tokens ?? 16384
  const effortMultiplier =
    effortRaw === 'max' || effort === 'high' ? 4 : effort === 'medium' ? 2 : 1.5
  const outputBudget = Math.max(Math.round(callerMax * effortMultiplier), 16384)

  const t0Resp = Date.now()
  const respParams = {
    model,
    input: input as any,
    ...(systemParts.length > 0
      ? { instructions: systemParts.join('\n\n') }
      : {}),
    max_output_tokens: outputBudget,
    ...(tools.length > 0 ? { tools } : {}),
    ...(opts.temperature !== undefined
      ? { temperature: opts.temperature }
      : {}),
    reasoning: { effort },
    store: false,
  }
  const response = await client.responses.create(
    respParams,
    opts.signal ? { signal: opts.signal } : undefined,
  )
  const respDuration = Date.now() - t0Resp

  const usage = response.usage
  const inputTokens = usage?.input_tokens ?? 0
  const outputTokens = usage?.output_tokens ?? 0

  // Track usage using the same format as Chat Completions tracker
  trackOpenAIResponse(
    {
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
      },
    },
    model,
    respDuration,
  )

  const text = response.output_text ?? ''

  // Detect empty response: reasoning consumed all output tokens
  if (!text) {
    const outputTypes = response.output.map((item: any) => item.type).join(', ')
    const reason =
      response.status === 'incomplete'
        ? `status: incomplete (${(response as any).incomplete_details?.reason ?? 'unknown'})`
        : `status: ${response.status}`
    throw new Error(
      `OpenAI Responses API returned empty output_text (${reason}, output types: [${outputTypes}], ` +
        `output_budget: ${outputBudget}, output_tokens_used: ${outputTokens}). ` +
        `Reasoning likely consumed the entire token budget. Increase max_output_tokens or lower reasoning effort.`,
    )
  }

  // Extract function tool calls from response output
  let tool_calls: UnifiedChatResult['tool_calls']
  const funcCalls = response.output.filter(
    (
      item,
    ): item is {
      type: 'function_call'
      call_id: string
      name: string
      arguments: string
    } => item.type === 'function_call',
  )
  if (funcCalls.length > 0) {
    tool_calls = funcCalls
      .map(fc => {
        let parsedInput: Record<string, unknown>
        try {
          parsedInput = JSON.parse(fc.arguments || '{}')
        } catch {
          const raw = fc.arguments || ''
          try {
            parsedInput = JSON.parse(raw + '"}')
          } catch {
            try {
              parsedInput = JSON.parse(raw + '"}}')
            } catch {
              parsedInput = {
                _parse_error: true,
                _raw_truncated: raw.slice(0, 500),
              }
            }
          }
        }
        return { id: fc.call_id, name: fc.name, input: parsedInput }
      })
      .filter(tc => !tc.input._parse_error)
  }

  const wasTruncated = response.status === 'incomplete'

  return {
    text: wasTruncated
      ? text + '\n[WARNING: Response truncated by max_output_tokens limit]'
      : text,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: estimateCost(inputTokens, outputTokens, model),
    tool_calls,
    stop_reason: funcCalls.length > 0 ? 'tool_use'
      : wasTruncated ? 'max_tokens'
      : 'end_turn',
  }
}
