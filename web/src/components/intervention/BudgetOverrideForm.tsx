import { useState } from 'react'
import * as ws from '../../api/ws'

interface Props {
  currentBudget: number
  onClose: () => void
}

export default function BudgetOverrideForm({ currentBudget, onClose }: Props) {
  const [newBudget, setNewBudget] = useState(String(currentBudget))
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    const parsed = Number(newBudget)
    if (!Number.isFinite(parsed) || parsed <= 0) return
    setSubmitting(true)
    try {
      await ws.request('research/update-budget', { budget_usd: parsed })
      onClose()
    } catch {
      // handled elsewhere
    }
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center panel-overlay" onClick={onClose}>
      <div
        className="bg-surface-1 border border-gray-700 rounded-xl w-full max-w-sm mx-4 shadow-2xl animate-fade-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-white">Override Budget</h3>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">New Budget (USD)</label>
            <input
              type="number"
              value={newBudget}
              onChange={e => setNewBudget(e.target.value)}
              className="w-full bg-surface-2 border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-accent-cyan/50"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-gray-800">
          <button onClick={onClose} className="px-4 py-1.5 bg-surface-2 text-gray-400 rounded text-sm hover:bg-surface-3">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-1.5 bg-accent-cyan/20 text-accent-cyan rounded text-sm font-medium hover:bg-accent-cyan/30 disabled:opacity-50"
          >
            {submitting ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
