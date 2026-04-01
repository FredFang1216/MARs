import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSessionStore } from '../stores/sessionStore'
import EmptyState from '../components/shared/EmptyState'

export default function Welcome() {
  const { sessions, loading, loadSessions } = useSessionStore()
  const navigate = useNavigate()

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center max-w-lg">
        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-accent-cyan/10 flex items-center justify-center">
          <span className="text-3xl font-bold text-accent-cyan">CP</span>
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Claude Paper</h1>
        <p className="text-sm text-gray-500 mb-8">
          AI-powered autonomous research system. Create a new research session to get started.
        </p>

        <button
          onClick={() => navigate('/new')}
          className="px-6 py-2.5 bg-accent-cyan/20 text-accent-cyan rounded-lg text-sm font-medium hover:bg-accent-cyan/30 transition-colors"
        >
          Start New Research
        </button>

        {!loading && sessions.length > 0 && (
          <div className="mt-8 text-left max-w-md mx-auto">
            <div className="text-xs text-gray-600 uppercase tracking-wider mb-3">
              Recent Sessions
            </div>
            <div className="space-y-1.5">
              {sessions.slice(0, 5).map(s => (
                <button
                  key={s.id}
                  onClick={() => navigate(`/s/${s.id}`)}
                  className="w-full text-left px-3 py-2 rounded-lg bg-surface-1 border border-gray-800 hover:border-accent-cyan/30 transition-colors group"
                >
                  <div className="text-sm text-gray-300 group-hover:text-white truncate">
                    {s.topic}
                  </div>
                  <div className="text-xs text-gray-600 mt-0.5">
                    {new Date(s.last_active).toLocaleDateString()}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {!loading && sessions.length === 0 && (
          <div className="mt-6">
            <EmptyState
              title="No sessions yet"
              description="Create your first research session to begin."
            />
          </div>
        )}
      </div>
    </div>
  )
}
