import { useState, useEffect } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { fetchAvailableKnowledgePacks } from '../../api/client'
import Card from '../shared/Card'

export default function KnowledgePackCard() {
  const knowledgePack = useSessionStore(s => s.knowledgePack)
  const loadKnowledgePack = useSessionStore(s => s.loadKnowledgePack)
  const unloadKnowledgePack = useSessionStore(s => s.unloadKnowledgePack)
  const [showPicker, setShowPicker] = useState(false)
  const [availablePacks, setAvailablePacks] = useState<any[]>([])
  const [loadingPacks, setLoadingPacks] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    if (showPicker) {
      setLoadingPacks(true)
      fetchAvailableKnowledgePacks()
        .then(setAvailablePacks)
        .catch(() => setAvailablePacks([]))
        .finally(() => setLoadingPacks(false))
    }
  }, [showPicker])

  const handleLoad = async (packId: string) => {
    setActionLoading(true)
    try {
      await loadKnowledgePack(packId)
      setShowPicker(false)
    } catch {
      // Error handled by store
    } finally {
      setActionLoading(false)
    }
  }

  const handleUnload = async () => {
    setActionLoading(true)
    try {
      await unloadKnowledgePack()
    } finally {
      setActionLoading(false)
    }
  }

  // ── Loaded state ──────────────────────────────────────

  if (knowledgePack.loaded && knowledgePack.manifest) {
    const m = knowledgePack.manifest
    return (
      <Card
        title="Knowledge Base"
        action={
          <button
            onClick={handleUnload}
            disabled={actionLoading}
            className="text-xs text-gray-500 hover:text-red-400 transition-colors disabled:opacity-50"
          >
            Unload
          </button>
        }
      >
        <div className="space-y-2.5">
          <div>
            <div className="text-sm text-white font-medium">{m.name}</div>
            {m.description && (
              <div className="text-xs text-gray-500 mt-0.5">{m.description}</div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <StatRow label="Theorems" value={m.stats?.theorems} />
            <StatRow label="Definitions" value={m.stats?.definitions} />
            <StatRow label="Algorithms" value={m.stats?.algorithms} />
            <StatRow label="Results" value={m.stats?.results} />
            {m.stats?.datasets > 0 && <StatRow label="Datasets" value={m.stats.datasets} />}
            {m.stats?.benchmarks > 0 && <StatRow label="Benchmarks" value={m.stats.benchmarks} />}
          </div>
          <div className="text-xs text-gray-600">
            {m.stats?.entries_total} entries total
          </div>
        </div>
      </Card>
    )
  }

  // ── Picker state ──────────────────────────────────────

  if (showPicker) {
    return (
      <Card title="Knowledge Base">
        <div className="space-y-2">
          {loadingPacks ? (
            <div className="text-xs text-gray-500 py-2">Loading packs...</div>
          ) : availablePacks.length === 0 ? (
            <div className="text-xs text-gray-500 py-2">
              No knowledge packs found.
              <br />
              <span className="text-gray-600">
                Build one with <code className="text-gray-500">claude-paper build-dkp</code>
              </span>
            </div>
          ) : (
            availablePacks.map((p: any) => (
              <button
                key={p.id}
                onClick={() => handleLoad(p.id)}
                disabled={actionLoading}
                className="w-full text-left p-2.5 rounded-md bg-surface-2 hover:bg-surface-3 transition-colors disabled:opacity-50"
              >
                <div className="text-sm text-white">{p.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {p.stats?.entries_total ?? 0} entries
                  {p.description ? ` · ${p.description.slice(0, 60)}` : ''}
                </div>
              </button>
            ))
          )}
          <button
            onClick={() => setShowPicker(false)}
            className="text-xs text-gray-500 hover:text-gray-400 transition-colors"
          >
            Cancel
          </button>
        </div>
      </Card>
    )
  }

  // ── Default state ─────────────────────────────────────

  return (
    <Card title="Knowledge Base">
      <p className="text-xs text-gray-500 mb-3">
        Load a domain knowledge pack to enable structured knowledge search in chat.
      </p>
      <button
        onClick={() => setShowPicker(true)}
        className="w-full px-3 py-2 bg-surface-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-surface-3 transition-colors"
      >
        Load Knowledge Pack
      </button>
    </Card>
  )
}

function StatRow({ label, value }: { label: string; value?: number }) {
  if (value === undefined || value === 0) return null
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="text-white font-mono">{value}</span>
    </div>
  )
}
