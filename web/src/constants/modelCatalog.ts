/**
 * Hardcoded model catalog for the Web UI settings page.
 * Only includes providers supported by llm-client.ts (anthropic, openai, deepseek, qwen, glm).
 */

export interface ModelEntry {
  id: string
  name: string
  context: string
  reasoning?: boolean
  note?: string
}

export interface AuthMethod {
  id: string
  name: string
  configKey: string    // key in config.api_keys, e.g. "anthropic" or "anthropic_auth_token"
  placeholder: string
  helpText?: string
  helpUrl?: string
}

export interface ProviderInfo {
  id: string
  name: string
  authMethods: AuthMethod[]
  models: ModelEntry[]
}

export const MODEL_ROLES = [
  { key: 'research', label: 'Research', description: 'Literature review, analysis, and synthesis' },
  { key: 'reasoning', label: 'Reasoning', description: 'Logic, proofs, and structured analysis' },
  { key: 'reasoning_deep', label: 'Deep Reasoning', description: 'Extended thinking for complex problems' },
  { key: 'coding', label: 'Coding', description: 'Code generation, experiments, and tooling' },
  { key: 'writing', label: 'Writing', description: 'Paper drafting and document composition' },
  { key: 'review', label: 'Review', description: 'Peer review simulation and critique' },
  { key: 'quick', label: 'Quick', description: 'Fast, lightweight tasks (summaries, formatting)' },
] as const

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    authMethods: [
      {
        id: 'api_key',
        name: 'API Key',
        configKey: 'anthropic',
        placeholder: 'sk-ant-api03-...',
        helpUrl: 'https://console.anthropic.com/settings/keys',
      },
      {
        id: 'setup_token',
        name: 'Setup Token (Subscription)',
        configKey: 'anthropic_auth_token',
        placeholder: 'sk-ant-oat01-...',
        helpText: 'Run "claude setup-token" in terminal to generate',
      },
    ],
    models: [
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', context: '200K' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', context: '200K' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', context: '200K' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    authMethods: [
      {
        id: 'api_key',
        name: 'API Key',
        configKey: 'openai',
        placeholder: 'sk-...',
        helpUrl: 'https://platform.openai.com/api-keys',
      },
    ],
    models: [
      { id: 'gpt-5.4', name: 'GPT-5.4', context: '200K' },
      { id: 'gpt-5.4-pro', name: 'GPT-5.4 Pro', context: '200K', reasoning: true, note: 'Responses API' },
      { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', context: '128K' },
      { id: 'gpt-5', name: 'GPT-5', context: '200K' },
      { id: 'gpt-4o', name: 'GPT-4o', context: '128K' },
      { id: 'o3-mini', name: 'o3-mini', context: '200K', reasoning: true },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    authMethods: [
      {
        id: 'api_key',
        name: 'API Key',
        configKey: 'deepseek',
        placeholder: 'sk-...',
        helpUrl: 'https://platform.deepseek.com/api_keys',
      },
    ],
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek V3', context: '64K' },
      { id: 'deepseek-reasoner', name: 'DeepSeek R1', context: '64K', reasoning: true },
    ],
  },
  {
    id: 'qwen',
    name: 'Qwen (DashScope)',
    authMethods: [
      {
        id: 'api_key',
        name: 'API Key',
        configKey: 'qwen',
        placeholder: 'sk-...',
        helpUrl: 'https://dashscope.console.aliyun.com/apiKey',
      },
    ],
    models: [
      { id: 'qwen-max', name: 'Qwen Max', context: '32K' },
      { id: 'qwen-plus', name: 'Qwen Plus', context: '128K' },
      { id: 'qwen-turbo', name: 'Qwen Turbo', context: '128K' },
      { id: 'qwen-long', name: 'Qwen Long', context: '10M' },
    ],
  },
  {
    id: 'glm',
    name: 'GLM (Zhipu AI)',
    authMethods: [
      {
        id: 'api_key',
        name: 'API Key',
        configKey: 'glm',
        placeholder: 'sk-...',
        helpUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
      },
    ],
    models: [
      { id: 'glm-4-plus', name: 'GLM-4 Plus', context: '128K' },
      { id: 'glm-4-flash', name: 'GLM-4 Flash', context: '128K' },
      { id: 'glm-4-long', name: 'GLM-4 Long', context: '1M' },
    ],
  },
]

/** Get the primary config key for a provider (first auth method) */
export function getProviderPrimaryConfigKey(providerId: string): string {
  const provider = PROVIDERS.find(p => p.id === providerId)
  return provider?.authMethods[0]?.configKey ?? providerId
}

/** Get all config keys for a provider */
export function getProviderConfigKeys(providerId: string): string[] {
  const provider = PROVIDERS.find(p => p.id === providerId)
  return provider?.authMethods.map(m => m.configKey) ?? [providerId]
}
