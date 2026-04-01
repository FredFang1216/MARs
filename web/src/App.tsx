import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import Layout from './components/Layout'
import NewResearch from './pages/NewResearch'
import Settings from './pages/Settings'
import ChatPanel from './components/chat/ChatPanel'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Center is always ChatPanel — with or without sessionId */}
        <Route path="/" element={<ChatPanel />} />
        <Route path="/new" element={<NewResearch />} />
        <Route path="/s/:sessionId" element={<ChatPanel />} />
        <Route path="/settings" element={<Settings />} />
        {/* Legacy routes redirect */}
        <Route path="/sessions" element={<Navigate to="/" replace />} />
        <Route path="/dashboard/:sessionId" element={<LegacyRedirect />} />
        <Route path="/chat/:sessionId" element={<LegacyRedirect />} />
      </Route>
    </Routes>
  )
}

function LegacyRedirect() {
  const { sessionId } = useParams<{ sessionId: string }>()
  return <Navigate to={`/s/${sessionId}`} replace />
}
