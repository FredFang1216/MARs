import { useEffect, useState } from 'react'
import { fetchConfig, updateConfig } from '../api/client'

export default function Settings() {
  const [config, setConfig] = useState<Record<string, any> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    fetchConfig()
      .then(c => {
        setConfig(c)
        setLoading(false)
      })
      .catch(e => {
        setError(e.message)
        setLoading(false)
      })
  }, [])

  const handleSave = async () => {
    if (!config) return
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      await updateConfig(config)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (e: any) {
      setError(e.message)
    }
    setSaving(false)
  }

  if (loading) {
    return <div className="p-6 text-gray-500">Loading configuration...</div>
  }

  if (!config) {
    return (
      <div className="p-6 text-red-400">Failed to load configuration.</div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Settings</h2>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-accent-cyan/20 text-accent-cyan rounded text-sm hover:bg-accent-cyan/30 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded p-3 mb-4 text-red-300 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-900/30 border border-green-800 rounded p-3 mb-4 text-green-300 text-sm">
          Configuration saved.
        </div>
      )}

      {/* Model Assignments */}
      <Section title="Model Assignments">
        {config.models &&
          Object.entries(config.models).map(([role, model]) => (
            <div key={role} className="flex items-center gap-4 mb-2">
              <label className="text-sm text-gray-400 w-32">{role}</label>
              <input
                type="text"
                value={model as string}
                onChange={e => {
                  setConfig({
                    ...config,
                    models: { ...config.models, [role]: e.target.value },
                  })
                }}
                className="flex-1 bg-surface-2 border border-gray-700 rounded px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-accent-cyan/50"
              />
            </div>
          ))}
      </Section>

      {/* Paper Settings */}
      {config.paper && (
        <Section title="Paper">
          <ConfigRow label="Template" value={config.paper.template} onChange={v => setConfig({ ...config, paper: { ...config.paper, template: v } })} />
          <ConfigRow label="Compiler" value={config.paper.compiler} onChange={v => setConfig({ ...config, paper: { ...config.paper, compiler: v } })} />
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

      {/* Raw JSON fallback */}
      <Section title="Raw Configuration">
        <textarea
          value={JSON.stringify(config, null, 2)}
          onChange={e => {
            try {
              setConfig(JSON.parse(e.target.value))
              setError(null)
            } catch {
              setError('Invalid JSON')
            }
          }}
          rows={20}
          className="w-full bg-surface-2 border border-gray-700 rounded p-3 text-xs font-mono text-gray-300 focus:outline-none focus:border-accent-cyan/50"
        />
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-1 border border-gray-800 rounded-lg p-4 mb-4">
      <h3 className="text-sm font-semibold text-gray-400 mb-3">{title}</h3>
      {children}
    </div>
  )
}

function ConfigRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
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
