import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSessionStore } from '../stores/sessionStore'

export default function Sessions() {
  const { sessions, loading, error, loadSessions } = useSessionStore()
  const navigate = useNavigate()

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Research Sessions</h2>
        <button
          onClick={() => navigate('/new')}
          className="px-4 py-2 bg-accent-cyan/20 text-accent-cyan rounded text-sm hover:bg-accent-cyan/30"
        >
          + New Research
        </button>
      </div>

      {loading && (
        <div className="text-gray-500">Loading sessions...</div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded p-3 mb-4 text-red-300 text-sm">
          {error}
        </div>
      )}

      {sessions.length === 0 && !loading && (
        <div className="text-center py-12">
          <p className="text-gray-500 mb-4">No research sessions yet.</p>
          <button
            onClick={() => navigate('/new')}
            className="px-6 py-2.5 bg-accent-cyan/20 text-accent-cyan rounded-lg text-sm font-medium hover:bg-accent-cyan/30"
          >
            Start New Research
          </button>
        </div>
      )}

      <div className="grid gap-3">
        {sessions.map(session => (
          <button
            key={session.id}
            onClick={() => navigate(`/dashboard/${session.id}`)}
            className="bg-surface-1 border border-gray-800 rounded-lg p-4 text-left hover:border-accent-cyan/50 transition-colors"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white">{session.topic}</h3>
              <span className="text-xs text-gray-500">{session.id}</span>
            </div>
            <div className="flex gap-4 mt-2 text-xs text-gray-500">
              <span>Created: {new Date(session.created_at).toLocaleDateString()}</span>
              <span>Last active: {new Date(session.last_active).toLocaleDateString()}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
