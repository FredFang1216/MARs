import React, { useState, useRef } from 'react'
import { Box, Newline, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import os from 'os'
import { PAPER_ASCII_LOGO } from '@constants/product'
import modelCatalog from '@constants/models'

type Props = { onDone(): void }

// ── Types ────────────────────────────────────────────────────────

interface LatexToolStatus {
  name: string
  available: boolean | null
}

interface ComputeInfo {
  os_name: string
  cpu: string
  cores: number
  ram_gb: number
  available_ram_gb: number
  disk_free_gb: number
  gpu: string
  python: string
  uv: boolean
  docker: boolean
}

interface AdvancedModelConfig {
  api_key?: string
  base_url?: string
  max_output_tokens?: number
  thinking_effort?: 'low' | 'medium' | 'high' | 'max'
  temperature?: number
}

interface WizardConfig {
  api_keys: { anthropic: string; anthropic_auth_token: string; openai: string; deepseek: string; qwen: string; glm: string; semantic_scholar: string }
  models: Record<string, string>
  advanced_models?: Record<string, AdvancedModelConfig>
  paper: { template: string; language: string }
  proposals: { count: number }
  review: { num_reviewers: number; max_rounds: number; threshold: number }
  access: {
    arxiv: boolean
    semantic_scholar: boolean
    unpaywall: boolean
    core: boolean
    scihub: boolean
    scihub_accepted: boolean
    ezproxy_url: string
    shibboleth: boolean
    zotero_path: string
    pdf_folder: string
  }
  auto_mode: boolean
}

// ── Helpers ──────────────────────────────────────────────────────

const ANTHROPIC_SETUP_TOKEN_PREFIX = 'sk-ant-oat01-'

/** Route anthropic input to the correct api_keys fields based on prefix detection */
function routeAnthropicKey(value: string): { anthropic: string; anthropic_auth_token: string } {
  if (value.startsWith(ANTHROPIC_SETUP_TOKEN_PREFIX)) {
    return { anthropic: '', anthropic_auth_token: value }
  }
  return { anthropic: value, anthropic_auth_token: '' }
}

/** Resolve the effective anthropic credential from input + env */
function resolveAnthropicInput(input: string): string {
  return input || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || ''
}

const CONFIG_DIR = `${os.homedir()}/.claude-paper`
const CONFIG_PATH = `${CONFIG_DIR}/config.json`
const ACCESS_PATH = `${CONFIG_DIR}/access.json`

import { TemplateResolver } from '../../paper/writing/template-resolver'

const _resolver = new TemplateResolver()
const TEMPLATES = _resolver.listTemplates().map(t => t.id)
const LANGUAGES = ['english', 'chinese']

function defaultConfig(): WizardConfig {
  return {
    api_keys: { anthropic: '', anthropic_auth_token: '', openai: '', deepseek: '', qwen: '', glm: '', semantic_scholar: '' },
    models: {
      research: 'anthropic:claude-opus-4-6',
      reasoning: 'openai:gpt-5.4',
      reasoning_deep: 'openai:gpt-5.4-pro',
      coding: 'anthropic:claude-opus-4-6',
      writing: 'anthropic:claude-opus-4-6',
      review: 'openai:gpt-5.4',
      quick: 'anthropic:claude-haiku-4-5-20251001',
    },
    paper: { template: 'neurips', language: 'english' },
    proposals: { count: 3 },
    review: { num_reviewers: 3, max_rounds: 3, threshold: 7.0 },
    access: {
      arxiv: true,
      semantic_scholar: true,
      unpaywall: true,
      core: true,
      scihub: false,
      scihub_accepted: false,
      ezproxy_url: '',
      shibboleth: false,
      zotero_path: '',
      pdf_folder: '',
    },
    auto_mode: false,
  }
}

async function saveWizardConfig(cfg: WizardConfig): Promise<void> {
  // Save paper-specific config (without access — that goes to access.json)
  mkdirSync(CONFIG_DIR, { recursive: true })
  let existing: Record<string, any> = {}
  try {
    if (existsSync(CONFIG_PATH))
      existing = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
  } catch {
    /* ignore */
  }
  const { access, ...configWithoutAccess } = cfg
  const merged = { ...existing, ...configWithoutAccess }
  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf-8')

  // Save access config separately to ~/.claude-paper/access.json
  writeFileSync(ACCESS_PATH, JSON.stringify(access, null, 2) + '\n', 'utf-8')

  // Set env vars for current session — clear opposing var to prevent stale precedence
  if (cfg.api_keys.anthropic_auth_token) {
    process.env.ANTHROPIC_AUTH_TOKEN = cfg.api_keys.anthropic_auth_token
    delete process.env.ANTHROPIC_API_KEY
  } else if (cfg.api_keys.anthropic) {
    process.env.ANTHROPIC_API_KEY = cfg.api_keys.anthropic
    delete process.env.ANTHROPIC_AUTH_TOKEN
  }
  if (cfg.api_keys.openai) process.env.OPENAI_API_KEY = cfg.api_keys.openai
  if (cfg.api_keys.deepseek)
    process.env.DEEPSEEK_API_KEY = cfg.api_keys.deepseek
  if (cfg.api_keys.qwen) process.env.DASHSCOPE_API_KEY = cfg.api_keys.qwen
  if (cfg.api_keys.glm) process.env.ZHIPU_API_KEY = cfg.api_keys.glm
  if (cfg.api_keys.semantic_scholar)
    process.env.S2_API_KEY = cfg.api_keys.semantic_scholar

  // Also register model profile in Claude Paper's global config so /deep-research etc work
  try {
    const { getGlobalConfig, saveGlobalConfig } = await import('@utils/config')
    const globalConfig = getGlobalConfig()

    const anthropicKey =
      cfg.api_keys.anthropic_auth_token || cfg.api_keys.anthropic || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || ''
    if (anthropicKey) {
      const modelName = 'claude-sonnet-4-6'
      const profileName = 'Claude Sonnet 4.6'
      const existingProfiles = globalConfig.modelProfiles ?? []
      const alreadyExists = existingProfiles.some(
        (p: any) => p.modelName === modelName,
      )
      if (!alreadyExists) {
        const newProfile = {
          name: profileName,
          provider: 'anthropic',
          modelName,
          apiKey: anthropicKey,
          maxTokens: 16384,
          contextLength: 200000,
          reasoningEffort: 'high',
          isActive: true,
          createdAt: Date.now(),
        }
        existingProfiles.push(newProfile)
      }

      saveGlobalConfig({
        ...globalConfig,
        modelProfiles: existingProfiles,
        modelPointers: {
          main: modelName,
          task: modelName,
          compact: modelName,
          quick: modelName,
          ...(globalConfig.modelPointers ?? {}),
        },
      })
    }
  } catch {
    // If config utils fail, still save paper config
  }
}

async function checkTool(name: string): Promise<boolean> {
  try {
    const p = Bun.spawn(['which', name], { stdout: 'pipe', stderr: 'pipe' })
    return (await p.exited) === 0
  } catch {
    return false
  }
}

async function runCmd(cmd: string): Promise<string> {
  try {
    const p = Bun.spawn(cmd.split(' '), { stdout: 'pipe', stderr: 'pipe' })
    return (await new Response(p.stdout).text()).trim()
  } catch {
    return ''
  }
}

async function probeCompute(): Promise<ComputeInfo> {
  const mac = process.platform === 'darwin'
  const [osN, cpuM, cpuC, memS, vmS, freeR, dfR, nv, py, uv, dk] =
    await Promise.all([
      runCmd('uname -s'),
      runCmd('sysctl -n machdep.cpu.brand_string'),
      runCmd('sysctl -n hw.physicalcpu'),
      runCmd('sysctl -n hw.memsize'),
      runCmd('vm_stat'),
      runCmd('free -b'),
      runCmd('df -k /'),
      runCmd(
        'nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits',
      ),
      runCmd('python3 --version'),
      runCmd('uv --version'),
      runCmd('docker --version'),
    ])
  let cpu = mac ? cpuM || 'Apple Silicon' : 'unknown'
  let cores = mac ? parseInt(cpuC, 10) || 0 : 0
  let totalRam = 0
  let availRam = 0
  if (mac) {
    totalRam = parseInt(memS, 10) || 0
    const pF = vmS.match(/Pages free:\s+(\d+)/)
    const pI = vmS.match(/Pages inactive:\s+(\d+)/)
    availRam =
      ((parseInt(pF?.[1] ?? '0', 10) || 0) +
        (parseInt(pI?.[1] ?? '0', 10) || 0)) *
      16384
  } else {
    const m = freeR.split('\n').find(l => l.startsWith('Mem:'))
    if (m) {
      const c = m.trim().split(/\s+/)
      totalRam = parseInt(c[1], 10) || 0
      availRam = parseInt(c[6] ?? c[3], 10) || 0
    }
  }
  let diskFree = 0
  for (const l of dfR.split('\n').slice(1)) {
    if (!l.trim()) continue
    const c = l.trim().split(/\s+/)
    if (c.length >= 4) diskFree = (parseInt(c[3], 10) || 0) / 1e6
  }
  return {
    os_name: osN || process.platform,
    cpu,
    cores,
    ram_gb: +(totalRam / 1e9).toFixed(1),
    available_ram_gb: +(availRam / 1e9).toFixed(1),
    disk_free_gb: +diskFree.toFixed(1),
    gpu: nv ? (nv.split('\n')[0]?.trim() ?? 'none') : 'none',
    python: py.replace('Python ', '') || 'not found',
    uv: uv.length > 0,
    docker: dk.length > 0,
  }
}

// ── Advanced Mode: Model Selection Helpers ──────────────────────

interface FlatModelEntry {
  type: 'provider-header' | 'model'
  provider: string
  displayName?: string
  model?: string
  modelSpec?: string
  supports_reasoning_effort?: boolean
  max_output_tokens?: number
  max_input_tokens?: number
}

const PROVIDER_INFO: Record<string, { label: string; modelsUrl?: string }> = {
  anthropic: { label: 'Anthropic' },
  openai:    { label: 'OpenAI',   modelsUrl: 'https://api.openai.com/v1/models' },
  deepseek:  { label: 'DeepSeek', modelsUrl: 'https://api.deepseek.com/v1/models' },
  qwen:      { label: 'Qwen',    modelsUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models' },
  glm:       { label: 'GLM',     modelsUrl: 'https://open.bigmodel.cn/api/paas/v4/models' },
}

const SUPPORTED_PROVIDERS = ['anthropic', 'openai', 'deepseek', 'qwen', 'glm'] as const

function buildFlatModelList(
  cfg: WizardConfig,
  dynamicModels: Record<string, string[]>,
): FlatModelEntry[] {
  const providerHasKey: Record<string, boolean> = {
    anthropic: !!(cfg.api_keys.anthropic || cfg.api_keys.anthropic_auth_token || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    openai: !!(cfg.api_keys.openai || process.env.OPENAI_API_KEY),
    deepseek: !!(cfg.api_keys.deepseek || process.env.DEEPSEEK_API_KEY),
    qwen: !!(cfg.api_keys.qwen || process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY),
    glm: !!(cfg.api_keys.glm || process.env.ZHIPU_API_KEY || process.env.GLM_API_KEY),
  }
  const entries: FlatModelEntry[] = []
  for (const p of SUPPORTED_PROVIDERS) {
    if (!providerHasKey[p]) continue
    const staticModels = (modelCatalog as Record<string, any[]>)[p] ?? []
    const staticIds = new Set(staticModels.map((m: any) => m.model))
    const dynamicOnly = (dynamicModels[p] ?? []).filter((id: string) => !staticIds.has(id))
    if (staticModels.length === 0 && dynamicOnly.length === 0) continue
    entries.push({ type: 'provider-header', provider: p, displayName: PROVIDER_INFO[p]?.label ?? p })
    for (const m of staticModels) {
      entries.push({
        type: 'model', provider: p, model: m.model,
        modelSpec: `${p}:${m.model}`,
        supports_reasoning_effort: !!m.supports_reasoning_effort,
        max_output_tokens: m.max_output_tokens,
        max_input_tokens: m.max_input_tokens,
      })
    }
    for (const id of dynamicOnly) {
      entries.push({ type: 'model', provider: p, model: id, modelSpec: `${p}:${id}` })
    }
  }
  return entries
}

async function fetchProviderModels(provider: string, apiKey: string): Promise<string[]> {
  const info = PROVIDER_INFO[provider]
  if (!info?.modelsUrl || !apiKey) return []
  try {
    const res = await fetch(info.modelsUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    const json = await res.json()
    return (json.data ?? []).map((m: any) => m.id).filter(Boolean)
  } catch {
    return []
  }
}

function nextModelIdx(list: FlatModelEntry[], current: number, dir: 1 | -1): number {
  let idx = current + dir
  while (idx >= 0 && idx < list.length) {
    if (list[idx].type === 'model') return idx
    idx += dir
  }
  return current
}

function fmtCtx(n?: number): string {
  if (n == null || n <= 0) return ''
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M ctx`
  return `${Math.round(n / 1000)}K ctx`
}

function getParamFields(role: string, cfg: WizardConfig, flatList: FlatModelEntry[]): Array<{ label: string; key: string; value: string }> {
  const modelSpec = cfg.models[role]
  const entry = flatList.find(e => e.modelSpec === modelSpec)
  const adv = cfg.advanced_models?.[role] ?? {}
  const fields: Array<{ label: string; key: string; value: string }> = [
    { label: 'Max Output Tokens', key: 'max_output_tokens', value: adv.max_output_tokens != null ? String(adv.max_output_tokens) : `(default: ${entry?.max_output_tokens ?? 8192})` },
    { label: 'Temperature', key: 'temperature', value: adv.temperature != null ? String(adv.temperature) : '(default)' },
  ]
  if (entry?.supports_reasoning_effort) {
    fields.push({ label: 'Thinking Effort', key: 'thinking_effort', value: adv.thinking_effort ?? '(default)' })
  }
  fields.push(
    { label: 'Base URL Override', key: 'base_url', value: adv.base_url || '(default)' },
    { label: 'API Key Override', key: 'api_key', value: adv.api_key ? '****' + adv.api_key.slice(-4) : '(default)' },
  )
  return fields
}

// ── Step 0: Welcome ──────────────────────────────────────────────

function WelcomeStep(): React.ReactNode {
  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text color="cyan">{PAPER_ASCII_LOGO}</Text>
      <Text bold>End-to-end Autonomous Research System v0.1.0</Text>
      <Text>Let&apos;s set up your research environment.</Text>
      <Newline />
      <Text dimColor>Press Enter to continue</Text>
    </Box>
  )
}

// ── Step 1: LLM Provider Config ──────────────────────────────────

const MODEL_ROLES = [
  { key: 'research', icon: '🔬', label: 'Research' },
  { key: 'reasoning', icon: '🧮', label: 'Reasoning' },
  { key: 'coding', icon: '💻', label: 'Coding' },
  { key: 'writing', icon: '✍️', label: 'Writing' },
  { key: 'review', icon: '📝', label: 'Review' },
  { key: 'quick', icon: '⚡', label: 'Quick' },
]

type ApiKeyField = 'anthropic' | 'openai' | 'deepseek' | 'qwen' | 'glm' | 'none'

function ModelConfigStep({
  cfg,
  apiKey,
  onApiKeyChange,
  openaiKey,
  onOpenaiKeyChange,
  deepseekKey,
  onDeepseekKeyChange,
  qwenKey,
  onQwenKeyChange,
  glmKey,
  onGlmKeyChange,
  activeField,
  advancedMode,
  advancedSubScreen,
  advancedRole,
  flatModelList,
  modelListCursor,
  paramCursor,
  paramEditing,
  paramValue,
  onParamValueChange,
  advancedSelected,
  fetchingModels,
}: {
  cfg: WizardConfig
  apiKey: string
  onApiKeyChange: (v: string) => void
  openaiKey: string
  onOpenaiKeyChange: (v: string) => void
  deepseekKey: string
  onDeepseekKeyChange: (v: string) => void
  qwenKey: string
  onQwenKeyChange: (v: string) => void
  glmKey: string
  onGlmKeyChange: (v: string) => void
  activeField: ApiKeyField
  advancedMode: boolean
  advancedSubScreen: 'model-select' | 'param-config'
  advancedRole: string
  flatModelList: FlatModelEntry[]
  modelListCursor: number
  paramCursor: number
  paramEditing: boolean
  paramValue: string
  onParamValueChange: (v: string) => void
  advancedSelected: boolean
  fetchingModels: boolean
}): React.ReactNode {
  const envAnth = process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? ''
  const envOai = process.env.OPENAI_API_KEY ?? ''
  const envDs = process.env.DEEPSEEK_API_KEY ?? ''
  const envQwen = process.env.DASHSCOPE_API_KEY ?? process.env.QWEN_API_KEY ?? ''
  const envGlm = process.env.ZHIPU_API_KEY ?? process.env.GLM_API_KEY ?? ''
  const effectiveAnth = apiKey || envAnth
  const effectiveOai = openaiKey || envOai
  const effectiveDs = deepseekKey || envDs
  const effectiveQwen = qwenKey || envQwen
  const effectiveGlm = glmKey || envGlm

  const roleLabel = MODEL_ROLES.find(r => r.key === advancedRole)?.label ?? advancedRole
  const currentModelSpec = cfg.models[advancedRole]

  if (advancedMode && advancedSubScreen === 'model-select') {
    // Windowed display: show ~14 items centered on cursor
    const WINDOW_SIZE = 14
    const half = Math.floor(WINDOW_SIZE / 2)
    let start = Math.max(0, modelListCursor - half)
    let end = Math.min(flatModelList.length, start + WINDOW_SIZE)
    if (end - start < WINDOW_SIZE) start = Math.max(0, end - WINDOW_SIZE)
    const visible = flatModelList.slice(start, end)

    return (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold>Step 1/6: Advanced Config — Model Selection</Text>
        <Box>
          <Text>  Role: </Text>
          <Text color="cyan" bold>◀ {roleLabel} ▶</Text>
          <Text dimColor>            Current: {currentModelSpec}</Text>
        </Box>
        {fetchingModels && <Text dimColor>  (fetching latest models...)</Text>}
        <Box flexDirection="column">
          {start > 0 && <Text dimColor>  ↑ more</Text>}
          {visible.map((entry, vi) => {
            const globalIdx = start + vi
            if (entry.type === 'provider-header') {
              return (
                <Box key={`hdr-${entry.provider}`}>
                  <Text bold color="yellow">  {entry.displayName}</Text>
                </Box>
              )
            }
            const isCursor = globalIdx === modelListCursor
            const isSelected = entry.modelSpec === currentModelSpec
            const ctx = fmtCtx(entry.max_input_tokens)
            return (
              <Box key={entry.modelSpec}>
                <Box width={2}><Text>{isCursor ? '>' : ' '}</Text></Box>
                <Box width={36}>
                  <Text bold={isCursor} color={isCursor ? 'cyan' : undefined}>
                    {entry.model}
                  </Text>
                </Box>
                <Box width={12}>
                  <Text dimColor>{ctx}</Text>
                </Box>
                {isSelected && <Text color="green">✓</Text>}
              </Box>
            )
          })}
          {end < flatModelList.length && <Text dimColor>  ↓ more</Text>}
        </Box>
        <Text dimColor>
          Up/Down: select | Enter: confirm | Left/Right: switch role
        </Text>
        <Text dimColor>
          Tab: configure params | Esc: back
        </Text>
      </Box>
    )
  }

  if (advancedMode && advancedSubScreen === 'param-config') {
    const fields = getParamFields(advancedRole, cfg, flatModelList)

    return (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold>Step 1/6: Advanced Config — Parameters ({roleLabel})</Text>
        <Text dimColor>  Model: {currentModelSpec}</Text>
        <Box flexDirection="column">
          {fields.map((f, i) => (
            <Box key={f.key}>
              <Box width={2}>
                <Text>{paramCursor === i ? '>' : ' '}</Text>
              </Box>
              <Box width={22}>
                <Text dimColor>{f.label}:</Text>
              </Box>
              {paramEditing && paramCursor === i ? (
                <TextInput
                  value={paramValue}
                  onChange={onParamValueChange}
                  placeholder={f.value}
                />
              ) : (
                <Text
                  bold={paramCursor === i}
                  color={paramCursor === i ? 'cyan' : undefined}
                >
                  {f.value}
                </Text>
              )}
            </Box>
          ))}
        </Box>
        <Text dimColor>
          Up/Down: navigate | Enter: edit/save | Left/Right: switch role
        </Text>
        <Text dimColor>
          Tab: back to model list | Esc: back
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>Step 1/6: Configure AI Models</Text>

      {/* API Keys */}
      <Box flexDirection="column">
        <Box>
          <Box width={22}>
            <Text
              bold={activeField === 'anthropic'}
              color={activeField === 'anthropic' ? 'cyan' : undefined}
            >
              Anthropic Key/Token:
            </Text>
          </Box>
          {envAnth && !apiKey ? (
            <Text color="green">[from env ✓]</Text>
          ) : activeField === 'anthropic' ? (
            <TextInput
              value={apiKey}
              onChange={onApiKeyChange}
              mask="*"
              placeholder="sk-ant-api... or sk-ant-oat01-..."
            />
          ) : (
            <Text>
              {effectiveAnth ? (
                '****' + effectiveAnth.slice(-4)
              ) : (
                <Text color="red">(required)</Text>
              )}
            </Text>
          )}
        </Box>
        <Box>
          <Box width={22}>
            <Text
              bold={activeField === 'openai'}
              color={activeField === 'openai' ? 'cyan' : undefined}
            >
              OpenAI API Key:
            </Text>
          </Box>
          {envOai && !openaiKey ? (
            <Text color="green">[from env ✓]</Text>
          ) : activeField === 'openai' ? (
            <TextInput
              value={openaiKey}
              onChange={onOpenaiKeyChange}
              mask="*"
              placeholder="sk-... (optional)"
            />
          ) : (
            <Text dimColor>
              {effectiveOai ? '****' + effectiveOai.slice(-4) : '(optional)'}
            </Text>
          )}
        </Box>
        <Box>
          <Box width={22}>
            <Text
              bold={activeField === 'deepseek'}
              color={activeField === 'deepseek' ? 'cyan' : undefined}
            >
              DeepSeek API Key:
            </Text>
          </Box>
          {envDs && !deepseekKey ? (
            <Text color="green">[from env ✓]</Text>
          ) : activeField === 'deepseek' ? (
            <TextInput
              value={deepseekKey}
              onChange={onDeepseekKeyChange}
              mask="*"
              placeholder="sk-... (optional)"
            />
          ) : (
            <Text dimColor>
              {effectiveDs ? '****' + effectiveDs.slice(-4) : '(optional)'}
            </Text>
          )}
        </Box>
        <Box>
          <Box width={22}>
            <Text
              bold={activeField === 'qwen'}
              color={activeField === 'qwen' ? 'cyan' : undefined}
            >
              Qwen API Key:
            </Text>
          </Box>
          {envQwen && !qwenKey ? (
            <Text color="green">[from env ✓]</Text>
          ) : activeField === 'qwen' ? (
            <TextInput
              value={qwenKey}
              onChange={onQwenKeyChange}
              mask="*"
              placeholder="sk-... (optional)"
            />
          ) : (
            <Text dimColor>
              {effectiveQwen ? '****' + effectiveQwen.slice(-4) : '(optional)'}
            </Text>
          )}
        </Box>
        <Box>
          <Box width={22}>
            <Text
              bold={activeField === 'glm'}
              color={activeField === 'glm' ? 'cyan' : undefined}
            >
              GLM API Key:
            </Text>
          </Box>
          {envGlm && !glmKey ? (
            <Text color="green">[from env ✓]</Text>
          ) : activeField === 'glm' ? (
            <TextInput
              value={glmKey}
              onChange={onGlmKeyChange}
              mask="*"
              placeholder="sk-... (optional)"
            />
          ) : (
            <Text dimColor>
              {effectiveGlm ? '****' + effectiveGlm.slice(-4) : '(optional)'}
            </Text>
          )}
        </Box>
      </Box>

      {/* Model Table */}
      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Box width={4}>
            <Text> </Text>
          </Box>
          <Box width={14}>
            <Text bold underline>
              Role
            </Text>
          </Box>
          <Box width={34}>
            <Text bold underline>
              Default Model
            </Text>
          </Box>
        </Box>
        {MODEL_ROLES.map(r => (
          <Box key={r.key}>
            <Box width={4}>
              <Text>{r.icon}</Text>
            </Box>
            <Box width={14}>
              <Text>{r.label}</Text>
            </Box>
            <Box width={34}>
              <Text color="green">{cfg.models[r.key]}</Text>
            </Box>
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text bold={advancedSelected} color={advancedSelected ? 'cyan' : undefined}>
          {advancedSelected ? '> ' : '  '}Advanced Config (per-role overrides)
        </Text>
      </Box>

      <Text dimColor>
        Tab/Shift+Tab: switch field | Enter: {advancedSelected ? 'open advanced' : 'continue'} | Esc: back
      </Text>
    </Box>
  )
}

// ── Step 2: Academic Access ──────────────────────────────────────

function AcademicAccessStep({
  cfg,
  onToggleScihub,
  s2Key,
  onS2KeyChange,
  s2Active,
  ezproxyUrl,
  onEzproxyChange,
  ezproxyActive,
  pdfFolder,
  onPdfFolderChange,
  pdfFolderActive,
}: {
  cfg: WizardConfig
  onToggleScihub: () => void
  s2Key: string
  onS2KeyChange: (v: string) => void
  s2Active: boolean
  ezproxyUrl: string
  onEzproxyChange: (v: string) => void
  ezproxyActive: boolean
  pdfFolder: string
  onPdfFolderChange: (v: string) => void
  pdfFolderActive: boolean
}): React.ReactNode {
  const envS2 = process.env.S2_API_KEY ?? ''

  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>Step 2/6: Academic Paper Access</Text>
      <Text>Claude Paper needs to find and read research papers.</Text>

      <Box flexDirection="column" marginTop={1}>
        <Text bold> Free &amp; Open Access</Text>
        <Text color="green"> ✅ arXiv API (always available, no key)</Text>
        <Text color="green">
          {' '}
          ✅ Semantic Scholar (free tier: 100 req/5min)
        </Text>
        <Box>
          <Text> {'  '}S2 API Key: </Text>
          {envS2 ? (
            <Text color="green">[from S2_API_KEY env ✓]</Text>
          ) : s2Active ? (
            <TextInput
              value={s2Key}
              onChange={onS2KeyChange}
              mask="*"
              placeholder="(optional, for 1000 req/5min)"
            />
          ) : (
            <Text dimColor>
              {s2Key ? '****' + s2Key.slice(-4) : '(optional)'}
            </Text>
          )}
        </Box>
        <Text color="green"> ✅ Unpaywall (free OA PDF discovery)</Text>
        <Text color="green"> ✅ CORE API (open access aggregator)</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold> Institutional Access</Text>
        <Box>
          <Text> {cfg.access.ezproxy_url ? '✅' : '⬜'} EZproxy URL: </Text>
          {ezproxyActive ? (
            <TextInput
              value={ezproxyUrl}
              onChange={onEzproxyChange}
              placeholder="https://proxy.university.edu/login?url="
            />
          ) : (
            <Text dimColor>
              {cfg.access.ezproxy_url || "(press 'p' to configure)"}
            </Text>
          )}
        </Box>
        <Box>
          <Text>
            {' '}
            {cfg.access.shibboleth ? '✅' : '⬜'} OpenAthens/Shibboleth SSO{' '}
          </Text>
          <Text dimColor>(press &apos;h&apos; to toggle)</Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold> Alternative Sources (use at your own legal risk)</Text>
        <Text color="yellow">
          {' '}
          ⚠️ These sources may violate publisher terms.
        </Text>
        <Text color="yellow"> ⚠️ Claude Paper does NOT endorse piracy.</Text>
        <Text color="yellow"> ⚠️ YOU assume all legal responsibility.</Text>
        <Box>
          <Text> {cfg.access.scihub ? '✅' : '⬜'} Sci-Hub mirrors </Text>
          <Text dimColor>(press &apos;s&apos; to toggle)</Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold> Local Papers</Text>
        <Box>
          <Text> ⬜ Import PDF folder: </Text>
          {pdfFolderActive ? (
            <TextInput
              value={pdfFolder}
              onChange={onPdfFolderChange}
              placeholder="/path/to/pdf/folder"
            />
          ) : (
            <Text dimColor>
              {cfg.access.pdf_folder || "(press 'f' to set path)"}
            </Text>
          )}
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          Tab: toggle S2 key | s: Sci-Hub | p: EZproxy | h: Shibboleth | f: PDF
          folder | Enter: continue
        </Text>
      </Box>
    </Box>
  )
}

// ── Step 3: LaTeX ────────────────────────────────────────────────

function LatexStep({
  tools,
  checking,
}: {
  tools: LatexToolStatus[]
  checking: boolean
}): React.ReactNode {
  const missing = tools.filter(t => t.available === false).map(t => t.name)
  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>Step 3/6: LaTeX Environment</Text>
      {checking ? (
        <Text>Checking your LaTeX installation...</Text>
      ) : (
        <Box flexDirection="column">
          {tools.map(t => (
            <Box key={t.name}>
              <Text>
                {' '}
                {t.available === null ? '...' : t.available ? '✅' : '❌'}{' '}
                {t.name}
              </Text>
            </Box>
          ))}
          {missing.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="yellow"> Missing: {missing.join(', ')}</Text>
              {process.platform === 'linux' && (
                <Text dimColor> To install: sudo apt install texlive-full</Text>
              )}
              {process.platform === 'darwin' && (
                <Text dimColor> To install: brew install --cask mactex</Text>
              )}
            </Box>
          )}
        </Box>
      )}
      <Text dimColor>Press Enter to continue</Text>
    </Box>
  )
}

// ── Step 4: Compute Resources ────────────────────────────────────

function ComputeStep({
  info,
  loading,
}: {
  info: ComputeInfo | null
  loading: boolean
}): React.ReactNode {
  if (loading || !info)
    return (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold>Step 4/6: Compute Resources</Text>
        <Text>Detecting your system capabilities...</Text>
      </Box>
    )
  const P = ({ l, v }: { l: string; v: string }) => (
    <Box>
      <Box width={22}>
        <Text dimColor> {l}</Text>
      </Box>
      <Text>{v}</Text>
    </Box>
  )
  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>Step 4/6: Compute Resources</Text>
      <Box flexDirection="column">
        <P l="OS:" v={info.os_name} />
        <P l="CPU:" v={`${info.cpu} (${info.cores} cores)`} />
        <P
          l="RAM:"
          v={`${info.ram_gb} GB total, ${info.available_ram_gb} GB available`}
        />
        <P l="Disk free:" v={`${info.disk_free_gb} GB`} />
        <P l="GPU:" v={info.gpu} />
        <P l="Python:" v={info.python} />
        <P l="uv:" v={info.uv ? 'available' : 'not found'} />
        <P l="Docker:" v={info.docker ? 'available' : 'not found'} />
      </Box>
      <Text dimColor>
        These will be used to estimate experiment feasibility.
      </Text>
      <Text dimColor>You can re-detect anytime with: /system-check</Text>
      <Text dimColor>Press Enter to continue</Text>
    </Box>
  )
}

// ── Step 5: Default Settings ─────────────────────────────────────

function SettingsStep({
  cfg,
  cursor,
}: {
  cfg: WizardConfig
  cursor: number
}): React.ReactNode {
  const items = [
    {
      label: 'Default template',
      value: cfg.paper.template,
      options: TEMPLATES,
    },
    {
      label: 'Default language',
      value: cfg.paper.language,
      options: LANGUAGES,
    },
    { label: 'Proposals per run', value: String(cfg.proposals.count) },
    { label: 'Number of reviewers', value: String(cfg.review.num_reviewers) },
    { label: 'Max review rounds', value: String(cfg.review.max_rounds) },
    { label: 'Acceptance threshold', value: `${cfg.review.threshold}/10` },
    { label: 'Full-auto mode', value: cfg.auto_mode ? 'yes' : 'no' },
  ]
  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>Step 5/6: Default Research Settings</Text>
      <Box flexDirection="column">
        {items.map((item, i) => (
          <Box key={item.label}>
            <Box width={2}>
              <Text>{cursor === i ? '>' : ' '}</Text>
            </Box>
            <Box width={26}>
              <Text dimColor>{item.label}:</Text>
            </Box>
            <Text bold={cursor === i} color={cursor === i ? 'cyan' : undefined}>
              {item.value}
            </Text>
            {cursor === i && item.options && (
              <Text dimColor> (Left/Right to change)</Text>
            )}
          </Box>
        ))}
      </Box>
      <Text dimColor>
        Up/Down: navigate | Left/Right: change value | Enter: accept all
      </Text>
    </Box>
  )
}

// ── Step 6: Complete ─────────────────────────────────────────────

function CompleteStep(): React.ReactNode {
  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold color="green">
        Step 6/6: Setup Complete! 🎓
      </Text>
      <Text>
        Configuration saved to: <Text color="cyan">{CONFIG_PATH}</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Quick start:</Text>
        <Text color="yellow">
          {' '}
          cpaper init &quot;Your research topic&quot; # Start a new project
        </Text>
        <Text color="yellow"> cpaper # Enter interactive mode</Text>
        <Text color="yellow"> cpaper --help # See all commands</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Key commands inside interactive mode:</Text>
        <Text color="yellow">
          {' '}
          /deep-research {'<topic>'} Deep literature research
        </Text>
        <Text color="yellow"> /propose Generate research proposals</Text>
        <Text color="yellow"> /experiment Run experiments</Text>
        <Text color="yellow"> /write Write paper</Text>
        <Text color="yellow"> /review Run peer review</Text>
        <Text color="yellow"> /status Show project progress</Text>
        <Text color="yellow"> /settings Modify settings</Text>
      </Box>
      <Newline />
      <Text dimColor>Press Enter to start</Text>
    </Box>
  )
}

// ── Main Component ──────────────────────────────────────────────

const LATEX_TOOLS = ['pdflatex', 'xelatex', 'lualatex', 'bibtex', 'latexmk']

export function PaperOnboarding({ onDone }: Props): React.ReactNode {
  const [step, setStep] = useState(0)
  const [cfg, setCfg] = useState<WizardConfig>(defaultConfig())

  // Step 1 state
  const [apiKey, setApiKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [deepseekKey, setDeepseekKey] = useState('')
  const [qwenKey, setQwenKey] = useState('')
  const [glmKey, setGlmKey] = useState('')
  const KEY_FIELDS: ApiKeyField[] = ['anthropic', 'openai', 'deepseek', 'qwen', 'glm']
  const [keyFieldIdx, setKeyFieldIdx] = useState(0)
  const keyField: ApiKeyField = KEY_FIELDS[keyFieldIdx] ?? 'none'
  const [apiFieldActive, setApiFieldActive] = useState(true)

  // Step 1 advanced state
  const lastEscRef = useRef(0)
  const [advancedMode, setAdvancedMode] = useState(false)
  const [advancedRoleIdx, setAdvancedRoleIdx] = useState(0)
  const [advancedSubScreen, setAdvancedSubScreen] = useState<'model-select' | 'param-config'>('model-select')
  const [modelListCursor, setModelListCursor] = useState(0)
  const [flatModelList, setFlatModelList] = useState<FlatModelEntry[]>([])
  const [dynamicModels, setDynamicModels] = useState<Record<string, string[]>>({})
  const [fetchingModels, setFetchingModels] = useState(false)
  const [paramCursor, setParamCursor] = useState(0)
  const [paramEditing, setParamEditing] = useState(false)
  const [paramValue, setParamValue] = useState('')

  // Step 2 state
  const [s2Key, setS2Key] = useState('')
  const [s2Active, setS2Active] = useState(false)
  const [ezproxyUrl, setEzproxyUrl] = useState('')
  const [ezproxyActive, setEzproxyActive] = useState(false)
  const [pdfFolder, setPdfFolder] = useState('')
  const [pdfFolderActive, setPdfFolderActive] = useState(false)

  // Step 3 state
  const [latexTools, setLatexTools] = useState<LatexToolStatus[]>(
    LATEX_TOOLS.map(name => ({ name, available: null })),
  )
  const [latexChecking, setLatexChecking] = useState(false)
  const [latexChecked, setLatexChecked] = useState(false)

  // Step 4 state
  const [computeInfo, setComputeInfo] = useState<ComputeInfo | null>(null)
  const [computeLoading, setComputeLoading] = useState(false)

  // Step 5 state
  const [settingsCursor, setSettingsCursor] = useState(0)

  const hasTextInput =
    (step === 1 && !advancedMode && apiFieldActive && keyField !== 'none') ||
    (step === 1 && advancedMode && advancedSubScreen === 'param-config' && paramEditing) ||
    (step === 2 && (s2Active || ezproxyActive || pdfFolderActive))

  async function runLatexCheck() {
    setLatexChecking(true)
    const r = await Promise.all(
      LATEX_TOOLS.map(async n => ({ name: n, available: await checkTool(n) })),
    )
    setLatexTools(r)
    setLatexChecking(false)
    setLatexChecked(true)
  }

  async function runComputeProbe() {
    setComputeLoading(true)
    try {
      setComputeInfo(await probeCompute())
    } catch {
      setComputeInfo({
        os_name: process.platform,
        cpu: 'unknown',
        cores: 0,
        ram_gb: 0,
        available_ram_gb: 0,
        disk_free_gb: 0,
        gpu: 'unknown',
        python: 'unknown',
        uv: false,
        docker: false,
      })
    }
    setComputeLoading(false)
  }

  // Step 5 setting changes
  function changeSetting(direction: number) {
    const c = { ...cfg }
    switch (settingsCursor) {
      case 0: {
        // template
        const idx = TEMPLATES.indexOf(c.paper.template)
        c.paper = {
          ...c.paper,
          template:
            TEMPLATES[(idx + direction + TEMPLATES.length) % TEMPLATES.length],
        }
        break
      }
      case 1: {
        // language
        const idx = LANGUAGES.indexOf(c.paper.language)
        c.paper = {
          ...c.paper,
          language:
            LANGUAGES[(idx + direction + LANGUAGES.length) % LANGUAGES.length],
        }
        break
      }
      case 2:
        c.proposals = {
          ...c.proposals,
          count: Math.max(1, Math.min(10, c.proposals.count + direction)),
        }
        break
      case 3:
        c.review = {
          ...c.review,
          num_reviewers: Math.max(
            1,
            Math.min(5, c.review.num_reviewers + direction),
          ),
        }
        break
      case 4:
        c.review = {
          ...c.review,
          max_rounds: Math.max(1, Math.min(5, c.review.max_rounds + direction)),
        }
        break
      case 5:
        c.review = {
          ...c.review,
          threshold: Math.max(
            1,
            Math.min(10, +(c.review.threshold + direction * 0.5).toFixed(1)),
          ),
        }
        break
      case 6:
        c.auto_mode = !c.auto_mode
        break
    }
    setCfg(c)
  }

  useInput(
    async (input, key) => {
      // Step 1 advanced: navigation
      if (step === 1 && advancedMode) {
        if (advancedSubScreen === 'model-select') {
          if (key.escape) {
            lastEscRef.current = Date.now()
            setAdvancedMode(false)
            return
          }
          if (key.upArrow) {
            setModelListCursor(c => nextModelIdx(flatModelList, c, -1))
            return
          }
          if (key.downArrow) {
            setModelListCursor(c => nextModelIdx(flatModelList, c, 1))
            return
          }
          if (key.leftArrow) {
            setAdvancedRoleIdx(i => {
              const newIdx = (i - 1 + MODEL_ROLES.length) % MODEL_ROLES.length
              const newRole = MODEL_ROLES[newIdx].key
              const curModel = cfg.models[newRole]
              const idx = flatModelList.findIndex(e => e.modelSpec === curModel)
              setModelListCursor(idx >= 0 ? idx : Math.max(0, flatModelList.findIndex(e => e.type === 'model')))
              return newIdx
            })
            return
          }
          if (key.rightArrow) {
            setAdvancedRoleIdx(i => {
              const newIdx = (i + 1) % MODEL_ROLES.length
              const newRole = MODEL_ROLES[newIdx].key
              const curModel = cfg.models[newRole]
              const idx = flatModelList.findIndex(e => e.modelSpec === curModel)
              setModelListCursor(idx >= 0 ? idx : Math.max(0, flatModelList.findIndex(e => e.type === 'model')))
              return newIdx
            })
            return
          }
          if (key.return) {
            const entry = flatModelList[modelListCursor]
            if (entry?.type === 'model' && entry.modelSpec) {
              const role = MODEL_ROLES[advancedRoleIdx].key
              setCfg(prev => ({
                ...prev,
                models: { ...prev.models, [role]: entry.modelSpec! },
              }))
            }
            return
          }
          if (key.tab) {
            setAdvancedSubScreen('param-config')
            setParamCursor(0)
            return
          }
          return
        }
        if (advancedSubScreen === 'param-config' && !paramEditing) {
          if (key.escape) {
            lastEscRef.current = Date.now()
            setAdvancedMode(false)
            return
          }
          if (key.upArrow) {
            setParamCursor(c => Math.max(0, c - 1))
            return
          }
          if (key.downArrow) {
            const role = MODEL_ROLES[advancedRoleIdx].key
            const maxIdx = getParamFields(role, cfg, flatModelList).length - 1
            setParamCursor(c => Math.min(maxIdx, c + 1))
            return
          }
          if (key.leftArrow) {
            setAdvancedRoleIdx(i => (i - 1 + MODEL_ROLES.length) % MODEL_ROLES.length)
            setParamCursor(0)
            return
          }
          if (key.rightArrow) {
            setAdvancedRoleIdx(i => (i + 1) % MODEL_ROLES.length)
            setParamCursor(0)
            return
          }
          if (key.return) {
            const role = MODEL_ROLES[advancedRoleIdx].key
            const fields = getParamFields(role, cfg, flatModelList)
            const field = fields[paramCursor]
            if (field) {
              setParamEditing(true)
              const adv = cfg.advanced_models?.[role] ?? {}
              const k = field.key as keyof AdvancedModelConfig
              setParamValue(adv[k] != null ? String(adv[k]) : '')
            }
            return
          }
          if (key.tab) {
            setAdvancedSubScreen('model-select')
            // Position cursor on current role's model
            const role = MODEL_ROLES[advancedRoleIdx].key
            const curModel = cfg.models[role]
            const idx = flatModelList.findIndex(e => e.modelSpec === curModel)
            setModelListCursor(idx >= 0 ? idx : Math.max(0, flatModelList.findIndex(e => e.type === 'model')))
            return
          }
          return
        }
        return
      }
      // Step 2: toggle Sci-Hub with 's'
      if (step === 2 && input === 's') {
        setCfg(prev => ({
          ...prev,
          access: {
            ...prev.access,
            scihub: !prev.access.scihub,
            scihub_accepted: !prev.access.scihub,
          },
        }))
        return
      }
      // Step 2: 'p' toggles EZproxy input
      if (step === 2 && input === 'p') {
        setEzproxyActive(a => !a)
        return
      }
      // Step 2: 'h' toggles Shibboleth
      if (step === 2 && input === 'h') {
        setCfg(prev => ({
          ...prev,
          access: { ...prev.access, shibboleth: !prev.access.shibboleth },
        }))
        return
      }
      // Step 2: 'f' toggles PDF folder input
      if (step === 2 && input === 'f') {
        setPdfFolderActive(a => !a)
        return
      }
      // Step 2: Tab toggles S2 key input
      if (step === 2 && key.tab) {
        setS2Active(a => !a)
        return
      }
      // Step 1: Tab/Shift+Tab cycles key fields + advanced config
      if (step === 1 && key.tab) {
        const total = KEY_FIELDS.length + 1
        setKeyFieldIdx(i => key.shift ? (i - 1 + total) % total : (i + 1) % total)
        return
      }

      // Escape: go back to previous step
      if (key.escape && step > 0) {
        if (Date.now() - lastEscRef.current < 300) return
        setStep(s => s - 1)
        return
      }

      // Step 5: navigation
      if (step === 5) {
        if (key.upArrow) {
          setSettingsCursor(c => Math.max(0, c - 1))
          return
        }
        if (key.downArrow) {
          setSettingsCursor(c => Math.min(6, c + 1))
          return
        }
        if (key.leftArrow) {
          changeSetting(-1)
          return
        }
        if (key.rightArrow) {
          changeSetting(1)
          return
        }
      }

      if (!key.return) return

      switch (step) {
        case 0:
          setStep(1)
          break
        case 1:
          if (keyFieldIdx >= KEY_FIELDS.length) {
            // Sync input state vars to cfg BEFORE building model list
            const updatedCfg = {
              ...cfg,
              api_keys: {
                ...cfg.api_keys,
                ...routeAnthropicKey(resolveAnthropicInput(apiKey)),
                openai: openaiKey || process.env.OPENAI_API_KEY || '',
                deepseek: deepseekKey || process.env.DEEPSEEK_API_KEY || '',
                qwen: qwenKey || process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY || '',
                glm: glmKey || process.env.ZHIPU_API_KEY || process.env.GLM_API_KEY || '',
              },
            }
            setCfg(updatedCfg)

            setAdvancedMode(true)
            setAdvancedSubScreen('model-select')
            setAdvancedRoleIdx(0)
            // Build flat model list from static catalog + any dynamic models
            const list = buildFlatModelList(updatedCfg, dynamicModels)
            setFlatModelList(list)
            // Position cursor on current role's selected model
            const currentModel = updatedCfg.models[MODEL_ROLES[0].key]
            const idx = list.findIndex(e => e.modelSpec === currentModel)
            setModelListCursor(idx >= 0 ? idx : Math.max(0, list.findIndex(e => e.type === 'model')))
            // Background fetch dynamic models (only first time)
            if (!fetchingModels && Object.keys(dynamicModels).length === 0) {
              setFetchingModels(true)
              // Snapshot keys before async to avoid stale closure
              const keysSnapshot = { ...updatedCfg.api_keys }
              const cfgSnapshot = { ...updatedCfg }
              void (async () => {
                const keys: Record<string, string> = {
                  openai: keysSnapshot.openai || process.env.OPENAI_API_KEY || '',
                  deepseek: keysSnapshot.deepseek || process.env.DEEPSEEK_API_KEY || '',
                  qwen: keysSnapshot.qwen || process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY || '',
                  glm: keysSnapshot.glm || process.env.ZHIPU_API_KEY || process.env.GLM_API_KEY || '',
                }
                const results: Record<string, string[]> = {}
                await Promise.all(
                  Object.entries(keys).map(async ([p, k]) => {
                    if (k) results[p] = await fetchProviderModels(p, k)
                  })
                )
                setDynamicModels(results)
                setFlatModelList(buildFlatModelList(cfgSnapshot, results))
                setFetchingModels(false)
              })()
            }
          } else {
            setCfg(prev => ({
              ...prev,
              api_keys: {
                ...prev.api_keys,
                ...routeAnthropicKey(resolveAnthropicInput(apiKey)),
                openai: openaiKey || process.env.OPENAI_API_KEY || '',
                deepseek: deepseekKey || process.env.DEEPSEEK_API_KEY || '',
                qwen: qwenKey || process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY || '',
                glm: glmKey || process.env.ZHIPU_API_KEY || process.env.GLM_API_KEY || '',
              },
            }))
            setStep(2)
          }
          break
        case 2:
          setCfg(prev => ({
            ...prev,
            api_keys: {
              ...prev.api_keys,
              semantic_scholar: s2Key || process.env.S2_API_KEY || '',
            },
            access: {
              ...prev.access,
              ezproxy_url: ezproxyUrl || prev.access.ezproxy_url,
              pdf_folder: pdfFolder || prev.access.pdf_folder,
            },
          }))
          setStep(3)
          if (!latexChecked) void runLatexCheck()
          break
        case 3:
          setStep(4)
          void runComputeProbe()
          break
        case 4:
          setStep(5)
          break
        case 5:
          try {
            await saveWizardConfig(cfg)
          } catch {
            /* best effort */
          }
          setStep(6)
          break
        case 6:
          onDone()
          break
      }
    },
    { isActive: !hasTextInput },
  )

  // Separate handler for text input active steps
  useInput(
    async (_input, key) => {
      // Step 1 advanced: param editing (Enter to save, Esc to cancel)
      if (step === 1 && advancedMode && advancedSubScreen === 'param-config' && paramEditing) {
        if (key.return) {
          const role = MODEL_ROLES[advancedRoleIdx].key
          const fields = getParamFields(role, cfg, flatModelList)
          const field = fields[paramCursor]
          if (field) {
            const k = field.key
            setCfg(prev => {
              const existing = prev.advanced_models?.[role] ?? {}
              let val: any = paramValue
              if (k === 'max_output_tokens') {
                const parsed = parseInt(paramValue, 10)
                val = Number.isNaN(parsed) ? undefined : parsed
              }
              if (k === 'temperature') {
                const parsed = parseFloat(paramValue)
                val = Number.isNaN(parsed) ? undefined : parsed
              }
              if (k === 'thinking_effort') {
                const allowed = ['low', 'medium', 'high', 'max']
                val = allowed.includes(paramValue) ? paramValue : undefined
              }
              if (!paramValue) val = undefined
              return {
                ...prev,
                advanced_models: {
                  ...(prev.advanced_models ?? {}),
                  [role]: { ...existing, [k]: val },
                },
              }
            })
          }
          setParamEditing(false)
          setParamValue('')
          return
        }
        if (key.escape) {
          setParamEditing(false)
          setParamValue('')
          return
        }
        return
      }
      if (step === 1 && key.tab) {
        const total = KEY_FIELDS.length + 1
        setKeyFieldIdx(i => key.shift ? (i - 1 + total) % total : (i + 1) % total)
        return
      }
      if (step === 2 && key.tab) {
        setS2Active(a => !a)
        return
      }
      if (step === 2 && _input === 's') {
        setCfg(prev => ({
          ...prev,
          access: { ...prev.access, scihub: !prev.access.scihub },
        }))
        return
      }
      if (key.escape && step > 0) {
        if (Date.now() - lastEscRef.current < 300) return
        setStep(s => s - 1)
        return
      }
      if (key.return) {
        if (step === 1) {
          setCfg(prev => ({
            ...prev,
            api_keys: {
              ...prev.api_keys,
              ...routeAnthropicKey(resolveAnthropicInput(apiKey)),
              openai: openaiKey || process.env.OPENAI_API_KEY || '',
              deepseek: deepseekKey || process.env.DEEPSEEK_API_KEY || '',
              qwen: qwenKey || process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY || '',
              glm: glmKey || process.env.ZHIPU_API_KEY || process.env.GLM_API_KEY || '',
            },
          }))
          setStep(2)
        } else if (step === 2) {
          setCfg(prev => ({
            ...prev,
            api_keys: {
              ...prev.api_keys,
              semantic_scholar: s2Key || process.env.S2_API_KEY || '',
            },
          }))
          setStep(3)
          if (!latexChecked) void runLatexCheck()
        }
      }
    },
    { isActive: hasTextInput },
  )

  const content: Record<number, React.ReactNode> = {
    0: <WelcomeStep />,
    1: (
      <ModelConfigStep
        cfg={cfg}
        apiKey={apiKey}
        onApiKeyChange={setApiKey}
        openaiKey={openaiKey}
        onOpenaiKeyChange={setOpenaiKey}
        deepseekKey={deepseekKey}
        onDeepseekKeyChange={setDeepseekKey}
        qwenKey={qwenKey}
        onQwenKeyChange={setQwenKey}
        glmKey={glmKey}
        onGlmKeyChange={setGlmKey}
        activeField={apiFieldActive ? keyField : 'none'}
        advancedMode={advancedMode}
        advancedSubScreen={advancedSubScreen}
        advancedRole={MODEL_ROLES[advancedRoleIdx]?.key ?? 'research'}
        flatModelList={flatModelList}
        modelListCursor={modelListCursor}
        paramCursor={paramCursor}
        paramEditing={paramEditing}
        paramValue={paramValue}
        onParamValueChange={setParamValue}
        advancedSelected={keyFieldIdx >= KEY_FIELDS.length && !advancedMode}
        fetchingModels={fetchingModels}
      />
    ),
    2: (
      <AcademicAccessStep
        cfg={cfg}
        onToggleScihub={() =>
          setCfg(prev => ({
            ...prev,
            access: { ...prev.access, scihub: !prev.access.scihub },
          }))
        }
        s2Key={s2Key}
        onS2KeyChange={setS2Key}
        s2Active={s2Active}
        ezproxyUrl={ezproxyUrl}
        onEzproxyChange={setEzproxyUrl}
        ezproxyActive={ezproxyActive}
        pdfFolder={pdfFolder}
        onPdfFolderChange={setPdfFolder}
        pdfFolderActive={pdfFolderActive}
      />
    ),
    3: <LatexStep tools={latexTools} checking={latexChecking} />,
    4: <ComputeStep info={computeInfo} loading={computeLoading} />,
    5: <SettingsStep cfg={cfg} cursor={settingsCursor} />,
    6: <CompleteStep />,
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text dimColor>Step {Math.min(step + 1, 6)} of 6</Text>
      {content[step]}
    </Box>
  )
}
