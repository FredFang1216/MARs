import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUiStore } from '../stores/uiStore'
import { useSessionStore } from '../stores/sessionStore'
import { useWsStore } from '../stores/wsStore'
import { useChatStore } from '../stores/chatStore'
import PanelDivider from './PanelDivider'
import ProposalInfo from './research/ProposalInfo'
import OrchestratorStatus from './research/OrchestratorStatus'
import StabilityCard from './research/StabilityCard'
import BudgetCard from './research/BudgetCard'
import ClaimSummaryCard from './research/ClaimSummaryCard'
import TrajectoryFeed from './research/TrajectoryFeed'
import ExperimentCard from './research/ExperimentCard'
import KnowledgePackCard from './research/KnowledgePackCard'
import LiteratureTab from './research/LiteratureTab'
import AcquiredPapersTab from './research/AcquiredPapersTab'
import MarkdownArtifactTab from './research/MarkdownArtifactTab'
import Card from './shared/Card'
import ExperimentDashboard from './experiments/ExperimentDashboard'
import * as ws from '../api/ws'
import { regenerateLiteratureArtifacts } from '../api/client'

export default function ResearchPanel() {
  const navigate = useNavigate()
  const visible = useUiStore(s => s.rightPanelVisible)
  const width = useUiStore(s => s.rightPanelWidth)
  const toggleRightPanel = useUiStore(s => s.toggleRightPanel)
  const activeTab = useUiStore(s => s.researchPanelTab)
  const setActiveTab = useUiStore(s => s.setResearchPanelTab)
  const contentFullscreen = useUiStore(s => s.contentFullscreen)
  const setContentFullscreen = useUiStore(s => s.setContentFullscreen)
  const researchState = useSessionStore(s => s.researchState)
  const literatureArtifacts = useSessionStore(s => s.literatureArtifacts)
  const sessionMode = useSessionStore(s => s.sessionMode)
  const currentSessionId = useSessionStore(s => s.currentSessionId)
  const knowledgePack = useSessionStore(s => s.knowledgePack)
  const selectSession = useSessionStore(s => s.selectSession)
  const progressMessages = useWsStore(s => s.progressMessages)
  const messageCount = useChatStore(s => s.messages.length)
  const refreshLiteratureArtifacts = useSessionStore(s => s.refreshLiteratureArtifacts)
  const [litTab, setLitTab] = useState<'papers' | 'survey' | 'taxonomy' | 'gaps'>('papers')
  const [bootstrapping, setBootstrapping] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  const handleRegenerate = async () => {
    if (!currentSessionId || regenerating) return
    setRegenerating(true)
    try {
      await regenerateLiteratureArtifacts(currentSessionId)
      await refreshLiteratureArtifacts()
    } catch {
      // Silently fail
    } finally {
      setRegenerating(false)
    }
  }

  if (!visible) return null

  // Count for Literature tab badge: literature_awareness + acquired papers
  const litAwarenessCount =
    (researchState?.literature_awareness?.deeply_read?.length ?? 0) +
    (researchState?.literature_awareness?.aware_but_unread?.length ?? 0) +
    (researchState?.literature_awareness?.known_results?.length ?? 0) +
    (researchState?.literature_awareness?.confirmed_gaps?.length ?? 0)
  const acquiredPaperCount = literatureArtifacts?.paper_count ?? 0
  const literatureCount = litAwarenessCount || acquiredPaperCount

  // Determine the active tab label for fullscreen header
  const getTabLabel = () => {
    if (researchState) {
      return { pipeline: 'Pipeline', literature: 'Literature', claims: 'Claims', experiments: 'Experiments' }[activeTab] ?? activeTab
    }
    return { papers: 'Papers', survey: 'Survey', taxonomy: 'Taxonomy', gaps: 'Research Gaps' }[litTab] ?? litTab
  }

  // Render tab content (shared between normal and fullscreen)
  const renderResearchTabContent = () => {
    if (activeTab === 'pipeline') {
      return (
        <>
          {currentSessionId && (
            <OrchestratorStatus
              sessionId={currentSessionId}
              progressMessages={progressMessages}
            />
          )}
          {researchState.stability && (
            <StabilityCard stability={researchState.stability} />
          )}
          {researchState.budget && (
            <BudgetCard budget={researchState.budget} />
          )}
          {currentSessionId && (
            <ExperimentCard sessionId={currentSessionId} />
          )}
        </>
      )
    }

    if (activeTab === 'literature') {
      return (
        <>
          {/* Sub-tabs for literature content */}
          {literatureArtifacts && (
            <div className="flex gap-1 mb-3 border-b border-gray-800 -mx-4 px-4">
              {(['papers', 'survey', 'taxonomy', 'gaps'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setLitTab(tab)}
                  className={`px-2.5 py-1.5 text-xs font-medium transition-colors relative ${
                    litTab === tab ? 'text-accent-cyan' : 'text-gray-600 hover:text-gray-400'
                  }`}
                >
                  {tab === 'papers' ? 'Papers' : tab === 'survey' ? 'Survey' : tab === 'taxonomy' ? 'Taxonomy' : 'Gaps'}
                  {litTab === tab && (
                    <div className="absolute bottom-0 left-1 right-1 h-0.5 bg-accent-cyan rounded-full" />
                  )}
                </button>
              ))}
            </div>
          )}

          {litTab === 'papers' ? (
            <>
              <LiteratureTab
                literatureAwareness={researchState.literature_awareness}
              />
              {literatureArtifacts?.acquired_papers?.length > 0 && (
                <>
                  <div className="text-xs text-gray-500 mt-4 mb-2 font-medium uppercase tracking-wider">
                    Acquired Papers ({literatureArtifacts.acquired_papers.length})
                  </div>
                  <AcquiredPapersTab papers={literatureArtifacts.acquired_papers} />
                </>
              )}
            </>
          ) : (
            renderLitReviewTabContent()
          )}

          {(literatureArtifacts?.paper_count ?? 0) > 0 && (
            <RegenerateButton regenerating={regenerating} onClick={handleRegenerate} />
          )}
        </>
      )
    }

    if (activeTab === 'claims') {
      return (
        <>
          {researchState.claimGraph && (
            <ClaimSummaryCard claimGraph={researchState.claimGraph} />
          )}
          {researchState.trajectory && researchState.trajectory.length > 0 && (
            <TrajectoryFeed trajectory={researchState.trajectory} />
          )}
          {!researchState.claimGraph && (!researchState.trajectory || researchState.trajectory.length === 0) && (
            <div className="text-center py-12 text-gray-600 text-sm">
              <p>No claims yet.</p>
              <p className="text-gray-700 text-xs mt-1">
                Claims will appear as the pipeline investigates and validates findings.
              </p>
            </div>
          )}
        </>
      )
    }

    if (activeTab === 'experiments') {
      return currentSessionId ? (
        <ExperimentDashboard sessionId={currentSessionId} />
      ) : null
    }

    return null
  }

  const renderLitReviewTabContent = () => {
    if (litTab === 'papers') {
      return <AcquiredPapersTab papers={literatureArtifacts?.acquired_papers ?? []} />
    }
    if (litTab === 'survey') {
      return <MarkdownArtifactTab title="Survey" content={literatureArtifacts?.survey_md} />
    }
    if (litTab === 'taxonomy') {
      return <MarkdownArtifactTab title="Taxonomy" content={literatureArtifacts?.taxonomy_md} />
    }
    if (litTab === 'gaps') {
      return <MarkdownArtifactTab title="Research Gaps" content={literatureArtifacts?.gaps_md} />
    }
    return null
  }

  // Fullscreen overlay — rendered for both Research Mode and Literature Review Mode
  if (contentFullscreen && (researchState || literatureArtifacts)) {
    const isResearchMode = !!researchState
    return (
      <>
        <PanelDivider />
        <aside
          className="flex flex-col bg-surface-1 border-l border-gray-800 overflow-hidden"
          style={{ width, minWidth: 320 }}
        >
          <div className="fixed inset-0 z-50 bg-surface-0 flex flex-col">
            {/* Fullscreen header with close button */}
            <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800 flex-shrink-0">
              <h3 className="text-sm font-semibold text-gray-300">
                {isResearchMode ? 'Research Pipeline' : 'Literature Review'}
              </h3>
              <button
                onClick={() => setContentFullscreen(false)}
                className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-surface-3 transition-colors"
                title="Exit fullscreen"
                aria-label="Exit fullscreen"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M5 1v4H1M9 1v4h4M5 13V9H1M9 13V9h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* Fullscreen tab bar */}
            {isResearchMode ? (
              <div role="tablist" className="flex px-6 pt-2 gap-1 flex-shrink-0 border-b border-gray-800">
                <TabButton label="Pipeline" id="fs-tab-pipeline" panelId="fs-panel-pipeline" active={activeTab === 'pipeline'} onClick={() => setActiveTab('pipeline')} />
                <TabButton label="Literature" id="fs-tab-literature" panelId="fs-panel-literature" active={activeTab === 'literature'} onClick={() => setActiveTab('literature')} count={literatureCount} />
                <TabButton label="Claims" id="fs-tab-claims" panelId="fs-panel-claims" active={activeTab === 'claims'} onClick={() => setActiveTab('claims')} count={researchState.claimGraph?.claims?.length} />
                <TabButton label="Experiments" id="fs-tab-experiments" panelId="fs-panel-experiments" active={activeTab === 'experiments'} onClick={() => setActiveTab('experiments')} />
              </div>
            ) : (
              <div role="tablist" className="flex px-6 pt-2 gap-1 flex-shrink-0 border-b border-gray-800">
                <TabButton label="Papers" id="fs-tab-papers" panelId="fs-panel-papers" active={litTab === 'papers'} onClick={() => setLitTab('papers')} count={literatureArtifacts?.paper_count} />
                <TabButton label="Survey" id="fs-tab-survey" panelId="fs-panel-survey" active={litTab === 'survey'} onClick={() => setLitTab('survey')} />
                <TabButton label="Taxonomy" id="fs-tab-taxonomy" panelId="fs-panel-taxonomy" active={litTab === 'taxonomy'} onClick={() => setLitTab('taxonomy')} />
                <TabButton label="Gaps" id="fs-tab-gaps" panelId="fs-panel-gaps" active={litTab === 'gaps'} onClick={() => setLitTab('gaps')} />
              </div>
            )}

            {/* Fullscreen tab content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {isResearchMode ? renderResearchTabContent() : renderLitReviewTabContent()}
            </div>
          </div>
        </aside>
      </>
    )
  }

  return (
    <>
      <PanelDivider />
      <aside
        className="flex flex-col bg-surface-1 border-l border-gray-800 overflow-hidden animate-slide-in-right"
        style={{ width, minWidth: 320 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
          <h3 className="text-sm font-semibold text-gray-300">
            {researchState ? 'Research Pipeline' : literatureArtifacts ? 'Literature Review' : 'Session'}
          </h3>
          <button
            onClick={toggleRightPanel}
            className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-surface-3 transition-colors"
            title="Close panel"
            aria-label="Close panel"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {researchState ? (
          /* ── Research Mode: tabbed interface ── */
          <>
            {/* ProposalInfo — always visible above tabs */}
            {researchState.proposal && (
              <div className="flex-shrink-0 max-h-[280px] overflow-y-auto px-4 pt-4 pb-2 border-b border-gray-800">
                <ProposalInfo
                  proposal={researchState.proposal}
                  paperType={researchState.paper_type}
                  cycle={researchState.orchestrator_cycle_count}
                />
              </div>
            )}

            {/* Tab Bar */}
            <div role="tablist" className="flex px-4 pt-2 gap-1 flex-shrink-0 border-b border-gray-800">
              <TabButton
                label="Pipeline"
                id="tab-pipeline"
                panelId="panel-pipeline"
                active={activeTab === 'pipeline'}
                onClick={() => setActiveTab('pipeline')}
              />
              <TabButton
                label="Literature"
                id="tab-literature"
                panelId="panel-literature"
                active={activeTab === 'literature'}
                onClick={() => setActiveTab('literature')}
                count={literatureCount}
              />
              <TabButton
                label="Claims"
                id="tab-claims"
                panelId="panel-claims"
                active={activeTab === 'claims'}
                onClick={() => setActiveTab('claims')}
                count={researchState.claimGraph?.claims?.length}
              />
              <TabButton
                label="Experiments"
                id="tab-experiments"
                panelId="panel-experiments"
                active={activeTab === 'experiments'}
                onClick={() => setActiveTab('experiments')}
              />
            </div>

            {/* Tab Content — independently scrollable */}
            <div
              role="tabpanel"
              id={`panel-${activeTab}`}
              aria-labelledby={`tab-${activeTab}`}
              className="flex-1 overflow-y-auto p-4 space-y-4 relative"
            >
              <FullscreenButton onClick={() => setContentFullscreen(true)} />
              {renderResearchTabContent()}
            </div>
          </>
        ) : literatureArtifacts ? (
          /* ── Literature Review Mode: for sessions with research data but no state.json ── */
          <>
            {/* Header: paper count + topic */}
            <div className="flex-shrink-0 px-4 pt-4 pb-2 border-b border-gray-800">
              <div className="text-xs text-gray-500 mb-1">Research Data Available</div>
              <div className="text-sm text-white font-medium">
                {literatureArtifacts.paper_count} papers collected
              </div>
              {literatureArtifacts.research_plan?.topic && (
                <div className="text-xs text-gray-400 mt-1 truncate">
                  {literatureArtifacts.research_plan.topic}
                </div>
              )}
            </div>

            {/* Tab bar */}
            <div role="tablist" className="flex px-4 pt-2 gap-1 flex-shrink-0 border-b border-gray-800">
              <TabButton
                label="Papers"
                id="tab-lit-papers"
                panelId="panel-lit-papers"
                active={litTab === 'papers'}
                onClick={() => setLitTab('papers')}
                count={literatureArtifacts.paper_count}
              />
              <TabButton
                label="Survey"
                id="tab-lit-survey"
                panelId="panel-lit-survey"
                active={litTab === 'survey'}
                onClick={() => setLitTab('survey')}
              />
              <TabButton
                label="Taxonomy"
                id="tab-lit-taxonomy"
                panelId="panel-lit-taxonomy"
                active={litTab === 'taxonomy'}
                onClick={() => setLitTab('taxonomy')}
              />
              <TabButton
                label="Gaps"
                id="tab-lit-gaps"
                panelId="panel-lit-gaps"
                active={litTab === 'gaps'}
                onClick={() => setLitTab('gaps')}
              />
            </div>

            {/* Tab content */}
            <div
              role="tabpanel"
              id={`panel-lit-${litTab}`}
              aria-labelledby={`tab-lit-${litTab}`}
              className="flex-1 overflow-y-auto p-4 space-y-4 relative"
            >
              <FullscreenButton onClick={() => setContentFullscreen(true)} />
              {renderLitReviewTabContent()}
            </div>

            {/* Regenerate artifacts */}
            <div className="flex-shrink-0 px-4 pb-2">
              <RegenerateButton
                regenerating={regenerating}
                disabled={(literatureArtifacts?.paper_count ?? 0) === 0}
                onClick={handleRegenerate}
              />
            </div>

            {/* Bootstrap pipeline */}
            <div className="flex-shrink-0 p-4 border-t border-gray-800">
              <Card title="Continue to Full Pipeline">
                <p className="text-xs text-gray-500 mb-3">
                  Generate proposals and initialize the research pipeline from existing literature data.
                </p>
                <button
                  disabled={bootstrapping}
                  onClick={async () => {
                    setBootstrapping(true)
                    try {
                      // Ensure session is open on WebSocket before calling bootstrap
                      if (currentSessionId) {
                        await ws.request('sessions/open', { sessionId: currentSessionId })
                      }
                      await ws.request('creation/bootstrap')
                      // Refresh session to pick up new state.json
                      if (currentSessionId) await selectSession(currentSessionId)
                    } catch {
                      // Will be handled by creation store listeners
                    } finally {
                      setBootstrapping(false)
                    }
                  }}
                  className="w-full px-4 py-2.5 bg-accent-cyan/15 text-accent-cyan rounded-lg text-sm font-medium hover:bg-accent-cyan/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {bootstrapping ? 'Generating Proposals...' : 'Generate Proposals & Initialize Pipeline'}
                </button>
              </Card>
            </div>
          </>
        ) : currentSessionId ? (
          /* ── Conversation Mode: session info + capabilities ── */
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Session Info */}
            <Card title="Session Info">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Mode</span>
                  <span className="text-accent-cyan capitalize">{sessionMode}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Messages</span>
                  <span className="text-white font-mono">{messageCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Session ID</span>
                  <span className="text-gray-400 font-mono text-xs truncate ml-2 max-w-[160px]">{currentSessionId}</span>
                </div>
              </div>
            </Card>

            {/* Capabilities */}
            <Card title="Capabilities">
              <div className="space-y-2">
                <CapabilityRow
                  name="Chat"
                  description="General conversation with AI"
                  active
                />
                <CapabilityRow
                  name="Literature Search"
                  description="Search arXiv and Semantic Scholar"
                  active
                />
                <CapabilityRow
                  name="Web Search"
                  description="Search the web and fetch pages"
                  active
                />
                <CapabilityRow
                  name="GitHub"
                  description="Search repos, read files, clone code"
                  active
                />
                <CapabilityRow
                  name="Math"
                  description="Wolfram Alpha and SymPy computation"
                  active
                />
                <CapabilityRow
                  name="HuggingFace"
                  description="Search models and datasets"
                  active
                />
                <CapabilityRow
                  name="Academic Search"
                  description="OpenAlex, DBLP, image analysis"
                  active
                />
                <CapabilityRow
                  name="Citations"
                  description="BibTeX and LaTeX management"
                  active
                />
                <CapabilityRow
                  name="Data Analysis"
                  description="SQL queries and chart generation"
                  active
                />
                <CapabilityRow
                  name="Infrastructure"
                  description="Docker containers, SQLite databases"
                  active
                />
                <CapabilityRow
                  name="Knowledge Base"
                  description="Organize findings into structured knowledge"
                  active={knowledgePack.loaded}
                />
              </div>
            </Card>

            {/* Knowledge Pack */}
            <KnowledgePackCard />

            {/* Escalate to Research */}
            <Card title="Full Research Pipeline">
              <p className="text-xs text-gray-500 mb-3">
                Escalate this session to run the full research pipeline: deep research, proposals, claim graph, and orchestrated experiments.
              </p>
              <button
                onClick={() => navigate('/new')}
                className="w-full px-4 py-2.5 bg-accent-cyan/15 text-accent-cyan rounded-lg text-sm font-medium hover:bg-accent-cyan/25 transition-colors"
              >
                Start Research Pipeline
              </button>
            </Card>
          </div>
        ) : (
          /* ── No session selected ── */
          <div className="flex-1 overflow-y-auto p-4">
            <div className="text-center py-16 text-gray-600 text-sm">
              <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-surface-2 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M9 1v16M1 9h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
                </svg>
              </div>
              Select a session or start a conversation.
            </div>
          </div>
        )}
      </aside>
    </>
  )
}

// ── Fullscreen Button ──

function FullscreenButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="absolute top-3 right-3 p-1 rounded text-gray-600 hover:text-white hover:bg-surface-3 transition-colors z-10"
      title="Fullscreen"
      aria-label="Fullscreen"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M1 5V1h4M9 1h4v4M1 9v4h4M13 9v4H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  )
}

// ── Tab Button ──

function TabButton({
  label,
  active,
  onClick,
  count,
  id,
  panelId,
}: {
  label: string
  active: boolean
  onClick: () => void
  count?: number
  id: string
  panelId: string
}) {
  return (
    <button
      role="tab"
      id={id}
      aria-selected={active}
      aria-controls={panelId}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={`px-3 py-2 text-xs font-medium transition-colors relative ${
        active
          ? 'text-accent-cyan'
          : 'text-gray-500 hover:text-gray-300'
      }`}
    >
      {label}
      {count != null && count > 0 && (
        <span className="ml-1.5 text-[10px] font-mono text-gray-600">
          {count}
        </span>
      )}
      {active && (
        <div className="absolute bottom-0 left-1 right-1 h-0.5 bg-accent-cyan rounded-full" />
      )}
    </button>
  )
}

// ── Regenerate Button ──

function RegenerateButton({
  regenerating,
  disabled,
  onClick,
}: {
  regenerating: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      disabled={regenerating || disabled}
      onClick={onClick}
      className="w-full mt-4 px-3 py-2 bg-surface-2 border border-gray-800 text-gray-400 rounded-lg text-xs font-medium hover:text-white hover:border-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
    >
      {regenerating ? (
        <>
          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Regenerating Analysis...
        </>
      ) : (
        'Regenerate Survey / Taxonomy / Gaps'
      )}
    </button>
  )
}

// ── Capability Row (conversation mode) ──

function CapabilityRow({
  name,
  description,
  active,
}: {
  name: string
  description: string
  active: boolean
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${active ? 'bg-accent-green' : 'bg-gray-700'}`} />
      <div>
        <span className={`text-sm ${active ? 'text-white' : 'text-gray-500'}`}>{name}</span>
        <span className="text-xs text-gray-600 block">{description}</span>
      </div>
    </div>
  )
}
