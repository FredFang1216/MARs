import { useState } from 'react'
import { useUiStore } from '../../stores/uiStore'
import * as ws from '../../api/ws'

export default function InterventionModal() {
  const open = useUiStore(s => s.interventionModalOpen)
  const data = useUiStore(s => s.interventionModalData)
  const closeModal = useUiStore(s => s.closeInterventionModal)

  const [actionType, setActionType] = useState(data?.action?.type ?? '')
  const [delegateTo, setDelegateTo] = useState(data?.action?.delegate_to ?? '')
  const [priority, setPriority] = useState(data?.action?.priority ?? 'normal')
  const [context, setContext] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!open || !data) return null

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      await ws.request('orchestrator/decide', {
        choice: 'edit',
        edits: {
          action_type: actionType,
          delegate_to: delegateTo,
          priority,
          context,
        },
      })
      closeModal()
    } catch {
      // handled elsewhere
    }
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center panel-overlay" onClick={closeModal}>
      <div
        className="bg-surface-1 border border-gray-700 rounded-xl w-full max-w-lg mx-4 shadow-2xl animate-fade-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-white">Edit Decision</h3>
          <button
            onClick={closeModal}
            className="p-1 rounded text-gray-500 hover:text-white hover:bg-surface-3"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Original reasoning */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Original Reasoning</label>
            <p className="text-xs text-gray-400 bg-surface-2 rounded p-2 line-clamp-3">
              {data.reasoning}
            </p>
          </div>

          {/* Action type */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Action Type</label>
            <input
              type="text"
              value={actionType}
              onChange={e => setActionType(e.target.value)}
              className="w-full bg-surface-2 border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-accent-cyan/50"
            />
          </div>

          {/* Delegate to */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Delegate To</label>
            <input
              type="text"
              value={delegateTo}
              onChange={e => setDelegateTo(e.target.value)}
              className="w-full bg-surface-2 border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-accent-cyan/50"
            />
          </div>

          {/* Priority */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Priority</label>
            <div className="flex gap-2">
              {['low', 'normal', 'high', 'urgent'].map(p => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={`flex-1 px-3 py-1.5 rounded text-xs border transition-colors ${
                    priority === p
                      ? 'bg-accent-cyan/15 text-accent-cyan border-accent-cyan/30'
                      : 'bg-surface-2 text-gray-500 border-gray-700 hover:border-gray-600'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Additional context */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Additional Context</label>
            <textarea
              value={context}
              onChange={e => setContext(e.target.value)}
              rows={3}
              placeholder="Explain why you're modifying this decision..."
              className="w-full bg-surface-2 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent-cyan/50 resize-none"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-gray-800">
          <button
            onClick={closeModal}
            className="px-4 py-1.5 bg-surface-2 text-gray-400 rounded text-sm hover:bg-surface-3"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-1.5 bg-accent-cyan/20 text-accent-cyan rounded text-sm font-medium hover:bg-accent-cyan/30 disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit Edit'}
          </button>
        </div>
      </div>
    </div>
  )
}
