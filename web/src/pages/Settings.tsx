import { useEffect, useState, useMemo } from 'react'
import { fetchConfig, updateConfig } from '../api/client'
import { PROVIDERS, MODEL_ROLES, type AuthMethod } from '../constants/modelCatalog'

// Per-credential state: each auth method has its own display/edit state
type CredState = { display: string; edited: boolean; newValue: string }
// Key = auth method configKey (e.g. "anthropic", "anthropic_auth_token", "openai")
type ApiKeyState = Record<string, CredState>
// Track which auth method is selected per provider (for providers with multiple methods)
type AuthMethodSelection = Record<string, string> // providerId → authMethod.id

export default function Settings() {
  const [config, setConfig] = useState<Record<string, any> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [apiKeys, setApiKeys] = useState<ApiKeyState>({})
  const [authMethodSelections, setAuthMethodSelections] = useState<AuthMethodSelection>({})
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({})
  const [showCustom, setShowCustom] = useState<Record<string, boolean>>({})

  useEffect(() => {
    fetchConfig()
      .then(c => {
        setConfig(c)
        initApiKeysFromConfig(c)
        setLoading(false)
      })
      .catch(e => {
        setError(e.message)
        setLoading(false)
      })
  }, [])

  function initApiKeysFromConfig(c: Record<string, any>) {
    const keys: ApiKeyState = {}
    const selections: AuthMethodSelection = {}

    for (const p of PROVIDERS) {
      // Determine which auth method is active based on configured keys
      let activeMethodId = p.authMethods[0].id
      for (const method of p.authMethods) {
        const redacted = c.api_keys?.[method.configKey]
        const hasValue = typeof redacted === 'string' && redacted.length > 3
        keys[method.configKey] = {
          display: hasValue ? redacted : '',
          edited: false,
          newValue: '',
        }
        // If this method has a configured value, select it
        if (hasValue) {
          activeMethodId = method.id
        }
      }
      selections[p.id] = activeMethodId
    }

    setApiKeys(keys)
    setAuthMethodSelections(selections)
  }

  // Determine which providers have configured credentials
  const configuredProviders = useMemo(() => {
    const set = new Set<string>()
    for (const p of PROVIDERS) {
      for (const method of p.authMethods) {
        const ks = apiKeys[method.configKey]
        if (ks && (ks.display || ks.newValue)) {
          set.add(p.id)
          break
        }
      }
    }
    return set
  }, [apiKeys])

  const handleSave = async () => {
    if (!config) return
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const apiKeysPayload: Record<string, string> = {}
      for (const p of PROVIDERS) {
        for (const method of p.authMethods) {
          const ks = apiKeys[method.configKey]
          if (ks?.edited && ks.newValue) {
            apiKeysPayload[method.configKey] = ks.newValue
          } else {
            apiKeysPayload[method.configKey] = ks?.display || ''
          }
        }
      }

      await updateConfig({ ...config, api_keys: apiKeysPayload })
      setSuccess(true)

      const fresh = await fetchConfig()
      setConfig(fresh)
      initApiKeysFromConfig(fresh)

      setTimeout(() => setSuccess(false), 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setSaving(false)
  }

  const handleModelChange = (role: string, value: string) => {
    if (value === '__custom__') {
      setShowCustom(prev => ({ ...prev, [role]: true }))
      return
    }
    setShowCustom(prev => ({ ...prev, [role]: false }))
    setConfig(prev => prev ? { ...prev, models: { ...prev.models, [role]: value } } : prev)
  }

  const handleCustomConfirm = (role: string) => {
    const val = customInputs[role]?.trim()
    if (val) {
      setConfig(prev => prev ? { ...prev, models: { ...prev.models, [role]: val } } : prev)
    }
    setShowCustom(prev => ({ ...prev, [role]: false }))
  }

  if (loading) return <div className="p-6 text-gray-500">Loading configuration...</div>
  if (!config) return <div className="p-6 text-red-400">Failed to load configuration.</div>

  return (
    <div className="p-6 max-w-4xl mx-auto h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Settings</h2>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 bg-accent-cyan/20 text-accent-cyan rounded-lg text-sm font-medium hover:bg-accent-cyan/30 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 mb-4 text-red-300 text-sm">{error}</div>
      )}
      {success && (
        <div className="bg-green-900/30 border border-green-800 rounded-lg p-3 mb-4 text-green-300 text-sm">Configuration saved successfully.</div>
      )}

      {/* API Keys */}
      <Section title="API Keys" description="Configure credentials for each LLM provider. Only providers with credentials will appear in model selection.">
        <div className="space-y-4">
          {PROVIDERS.map(provider => {
            const selectedMethodId = authMethodSelections[provider.id] ?? provider.authMethods[0].id
            const selectedMethod = provider.authMethods.find(m => m.id === selectedMethodId) ?? provider.authMethods[0]
            const hasMultipleMethods = provider.authMethods.length > 1

            return (
              <div key={provider.id} className="bg-surface-2 rounded-lg p-3">
                <div className="flex items-center gap-3 mb-2">
                  <div className="text-sm font-medium text-white">{provider.name}</div>
                  {hasMultipleMethods && (
                    <div className="flex gap-1">
                      {provider.authMethods.map(method => (
                        <button
                          key={method.id}
                          onClick={() => setAuthMethodSelections(prev => ({ ...prev, [provider.id]: method.id }))}
                          className={`px-2.5 py-1 rounded text-xs transition-colors ${
                            method.id === selectedMethodId
                              ? 'bg-accent-cyan/20 text-accent-cyan'
                              : 'bg-surface-0 text-gray-500 hover:text-gray-300'
                          }`}
                        >
                          {method.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <CredentialInput
                  method={selectedMethod}
                  state={apiKeys[selectedMethod.configKey]}
                  onChange={(edited, newValue) => {
                    setApiKeys(prev => ({
                      ...prev,
                      [selectedMethod.configKey]: { ...prev[selectedMethod.configKey], edited, newValue },
                    }))
                  }}
                />
              </div>
            )
          })}
        </div>
      </Section>

      {/* Model Assignments */}
      <Section title="Model Assignments" description="Assign a model to each research role. Only providers with configured credentials are shown.">
        <div className="space-y-4">
          {MODEL_ROLES.map(role => {
            const currentValue = config.models?.[role.key] || ''
            const isCustom = showCustom[role.key]

            return (
              <div key={role.key} className="bg-surface-2 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-sm font-medium text-white">{role.label}</div>
                  <div className="text-xs text-gray-600 font-mono">{role.key}</div>
                </div>
                <div className="text-xs text-gray-500 mb-2">{role.description}</div>

                {isCustom ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="provider:model-id"
                      value={customInputs[role.key] || currentValue}
                      onChange={e => setCustomInputs(prev => ({ ...prev, [role.key]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') handleCustomConfirm(role.key) }}
                      className="flex-1 bg-surface-0 border border-gray-700 rounded px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-accent-cyan/50"
                      autoFocus
                    />
                    <button onClick={() => handleCustomConfirm(role.key)} className="px-3 py-1.5 bg-accent-cyan/15 text-accent-cyan rounded text-sm hover:bg-accent-cyan/25 transition-colors">OK</button>
                    <button onClick={() => setShowCustom(prev => ({ ...prev, [role.key]: false }))} className="px-3 py-1.5 bg-surface-0 text-gray-400 rounded text-sm hover:bg-surface-3 transition-colors">Cancel</button>
                  </div>
                ) : (
                  <ModelSelect
                    value={currentValue}
                    configuredProviders={configuredProviders}
                    onChange={value => handleModelChange(role.key, value)}
                  />
                )}
              </div>
            )
          })}
        </div>
      </Section>

      {/* Paper Settings */}
      {config.paper && (
        <Section title="Paper">
          <ConfigRow label="Template" value={config.paper.template} onChange={v => setConfig({ ...config, paper: { ...config.paper, template: v } })} />
          <ConfigRow label="Compiler" value={config.paper.compiler} onChange={v => setConfig({ ...config, paper: { ...config.paper, compiler: v } })} />
          <ConfigRow label="Language" value={config.paper.language} onChange={v => setConfig({ ...config, paper: { ...config.paper, language: v } })} />
          <ConfigRow label="Max Pages" value={String(config.paper.max_pages)} onChange={v => setConfig({ ...config, paper: { ...config.paper, max_pages: Number(v) } })} />
        </Section>
      )}

      {/* Review Settings */}
      {config.review && (
        <Section title="Review">
          <ConfigRow label="Reviewers" value={String(config.review.num_reviewers)} onChange={v => setConfig({ ...config, review: { ...config.review, num_reviewers: Number(v) } })} />
          <ConfigRow label="Strength" value={config.review.strength} onChange={v => setConfig({ ...config, review: { ...config.review, strength: v } })} />
          <ConfigRow label="Threshold" value={String(config.review.acceptance_threshold)} onChange={v => setConfig({ ...config, review: { ...config.review, acceptance_threshold: Number(v) } })} />
        </Section>
      )}
    </div>
  )
}

// ── Credential Input ────────────────────────────────────────

/** Turn backend redacted format "***...abc4" into "••••••••••••abc4" */
function formatRedacted(display: string): string {
  const match = display.match(/^\*{3}\.{3}(.+)$/)
  if (match) return '••••••••••••' + match[1]
  return display
}

function CredentialInput({
  method,
  state,
  onChange,
}: {
  method: AuthMethod
  state: CredState | undefined
  onChange: (edited: boolean, newValue: string) => void
}) {
  const hasKey = !!(state?.display)
  const isEditing = !!state?.edited

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          {isEditing ? (
            <input
              type="text"
              autoFocus
              placeholder={method.placeholder}
              value={state?.newValue ?? ''}
              onChange={e => onChange(true, e.target.value)}
              onBlur={() => {
                // If user didn't type anything, cancel editing
                if (!state?.newValue) {
                  onChange(false, '')
                }
              }}
              className="w-full bg-surface-0 border border-accent-cyan/50 rounded px-3 py-2 text-sm font-mono text-white focus:outline-none"
            />
          ) : (
            <div
              onClick={() => onChange(true, '')}
              className={`w-full bg-surface-0 border rounded px-3 py-2 text-sm font-mono cursor-text transition-colors ${
                hasKey ? 'border-gray-700 text-gray-400' : 'border-gray-800 text-gray-600'
              } hover:border-gray-600`}
            >
              {hasKey ? formatRedacted(state!.display) : method.placeholder}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {hasKey ? (
            <span className="w-2 h-2 rounded-full bg-green-500" title="Configured" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-gray-700" title="Not configured" />
          )}
          {method.helpUrl && (
            <a href={method.helpUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-600 hover:text-accent-cyan transition-colors">
              Get key
            </a>
          )}
        </div>
      </div>
      {method.helpText && (
        <div className="mt-1.5 text-xs text-gray-600">
          {method.helpText}
        </div>
      )}
    </div>
  )
}

// ── Model Select ────────────────────────────────────────────

function ModelSelect({
  value,
  configuredProviders,
  onChange,
}: {
  value: string
  configuredProviders: Set<string>
  onChange: (value: string) => void
}) {
  const isKnown = PROVIDERS.some(p => p.models.some(m => `${p.id}:${m.id}` === value))

  return (
    <select
      value={isKnown ? value : '__current__'}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-surface-0 border border-gray-700 rounded px-3 py-2 text-sm text-white font-mono appearance-none cursor-pointer focus:outline-none focus:border-accent-cyan/50 transition-colors"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%236b7280' d='M3 5l3 3 3-3'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 12px center',
        paddingRight: '32px',
      }}
    >
      {!isKnown && value && <option value="__current__">{value} (custom)</option>}

      {PROVIDERS.filter(p => configuredProviders.has(p.id)).map(provider => (
        <optgroup key={provider.id} label={provider.name}>
          {provider.models.map(model => (
            <option key={model.id} value={`${provider.id}:${model.id}`}>
              {model.name} ({model.context}){model.reasoning ? ' [reasoning]' : ''}{model.note ? ` — ${model.note}` : ''}
            </option>
          ))}
        </optgroup>
      ))}

      {PROVIDERS.filter(p => !configuredProviders.has(p.id)).map(provider => (
        <optgroup key={provider.id} label={`${provider.name} (no credentials)`}>
          {provider.models.map(model => (
            <option key={model.id} value={`${provider.id}:${model.id}`} disabled>
              {model.name} ({model.context})
            </option>
          ))}
        </optgroup>
      ))}

      <option value="__custom__">Custom model...</option>
    </select>
  )
}

// ── Shared Components ───────────────────────────────────────

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-1 border border-gray-800 rounded-lg p-5 mb-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-1">{title}</h3>
      {description && <p className="text-xs text-gray-600 mb-4">{description}</p>}
      {children}
    </div>
  )
}

function ConfigRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-4 mb-2">
      <label className="text-sm text-gray-400 w-32">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="flex-1 bg-surface-2 border border-gray-700 rounded px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-accent-cyan/50"
      />
    </div>
  )
}
