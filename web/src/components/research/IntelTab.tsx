import { useEffect, useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { fetchFragment, fetchDecisions } from '../../api/client'
import Card from '../shared/Card'
import Badge from '../shared/Badge'
import MarkdownViewer from '../shared/MarkdownViewer'

interface Props {
  sessionId: string
}

export default function IntelTab({ sessionId }: Props) {
  const {
    unifiedStatus,
    methodScoreboard,
    decisions,
    researchPlan,
    fragments,
    fetchIntelData,
    fetchFragmentList,
  } = useSessionStore()

  useEffect(() => {
    fetchIntelData()
    fetchFragmentList()
  }, [sessionId])

  return (
    <div className="space-y-4">
      <UnifiedStatusCard status={unifiedStatus} />
      <ScoreboardCard scoreboard={methodScoreboard} />
      <DecisionHistoryCard decisions={decisions} sessionId={sessionId} />
      <PlanCard plan={researchPlan} />
      <FragmentsCard fragments={fragments} sessionId={sessionId} />
    </div>
  )
}

// ── Unified Status ──────────────────────────────────

function UnifiedStatusCard({ status }: { status: any }) {
  if (!status) return null

  const claims = status.claims ?? {}
  const budget = status.budget ?? {}
  const evidence = status.evidence ?? {}

  return (
    <Card title="Status Overview">
      <div className="space-y-3">
        {/* Header: topic + cycle */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-white font-medium truncate">{status.topic}</span>
          <span className="text-xs font-mono text-gray-500">Cycle {status.cycle}</span>
        </div>

        {/* Paper readiness */}
        <div className="flex items-center gap-2">
          <ReadinessBadge readiness={status.paper_readiness} />
          <span className="text-xs text-gray-500">{status.paper_type}</span>
          {status.has_pdf && <Badge variant="green">PDF</Badge>}
        </div>

        {/* Convergence */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-gray-500">Convergence</span>
            <span className="text-white font-mono">{(status.convergence * 100).toFixed(0)}%</span>
          </div>
          <div className="h-1.5 bg-surface-0 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-accent-cyan transition-all"
              style={{ width: `${status.convergence * 100}%` }}
            />
          </div>
        </div>

        {/* Claims breakdown */}
        <div className="grid grid-cols-3 gap-2">
          <MiniStat label="Admitted" value={claims.admitted} color="text-accent-green" />
          <MiniStat label="Proposed" value={claims.proposed} color="text-accent-cyan" />
          <MiniStat label="Investigating" value={claims.investigating} color="text-accent-yellow" />
          <MiniStat label="Rejected" value={claims.rejected} color="text-accent-red" />
          <MiniStat label="Reformulated" value={claims.reformulated} color="text-accent-purple" />
          <MiniStat label="Total" value={claims.total} color="text-white" />
        </div>

        {/* Budget */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-gray-500">Budget</span>
            <span className="text-white font-mono">
              ${budget.spent_usd?.toFixed(2)} / ${budget.total_usd?.toFixed(2)}
            </span>
          </div>
          <div className="h-1.5 bg-surface-0 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-accent-yellow transition-all"
              style={{ width: `${budget.total_usd ? (budget.spent_usd / budget.total_usd) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* Evidence */}
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span>Evidence: <span className="text-white font-mono">{evidence.total}</span></span>
          <span>Grounded: <span className="text-accent-green font-mono">{evidence.grounded}</span></span>
          <span>Derived: <span className="text-accent-cyan font-mono">{evidence.derived}</span></span>
        </div>

        {/* Experiment feedback */}
        {status.experiment_feedback && (
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>Evaluations: <span className="text-white font-mono">{status.experiment_feedback.total_evaluations}</span></span>
            {status.experiment_feedback.stagnant_claims > 0 && (
              <span className="text-accent-red">
                {status.experiment_feedback.stagnant_claims} stagnant claim(s)
              </span>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

// ── Method Scoreboard ───────────────────────────────

function ScoreboardCard({ scoreboard }: { scoreboard: any }) {
  if (!scoreboard) return null

  const methods = scoreboard.all_methods ?? []
  const incumbent = scoreboard.incumbent

  return (
    <Card title="Method Scoreboard">
      <div className="space-y-2">
        {/* Recommended action */}
        {scoreboard.recommended_action && (
          <div className="text-xs text-gray-500">
            Strategy: <Badge variant="cyan">{scoreboard.recommended_action}</Badge>
          </div>
        )}

        {/* Incumbent */}
        {incumbent && (
          <div className="bg-accent-cyan/10 border border-accent-cyan/20 rounded-lg p-2.5">
            <div className="flex items-center gap-2">
              <Badge variant="cyan">Incumbent</Badge>
              <span className="text-sm text-white font-medium">{incumbent.name}</span>
            </div>
            <div className="text-xs text-gray-400 mt-1">{incumbent.description}</div>
            {Object.keys(incumbent.metrics ?? {}).length > 0 && (
              <div className="flex flex-wrap gap-2 mt-1.5">
                {Object.entries(incumbent.metrics).slice(0, 4).map(([k, v]) => (
                  <span key={k} className="text-[10px] font-mono text-gray-500">
                    {k}: <span className="text-accent-cyan">{typeof v === 'number' ? (v as number).toFixed(3) : String(v)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* All methods table */}
        {methods.length > 0 && (
          <div className="space-y-1">
            {methods.map((m: any) => (
              <div
                key={m.id}
                className="flex items-center gap-2 px-2 py-1.5 bg-surface-2 rounded text-xs"
              >
                <MethodStatusBadge status={m.status} />
                <span className="text-gray-300 flex-1 truncate">{m.name}</span>
                <span className="text-gray-600 font-mono">{m.run_count} runs</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

// ── Decision History ────────────────────────────────

function DecisionHistoryCard({ decisions, sessionId }: { decisions: any[] | null; sessionId: string }) {
  const [showCount, setShowCount] = useState(10)

  if (!decisions || decisions.length === 0) {
    return (
      <Card title="Decision History">
        <div className="text-xs text-gray-600 text-center py-4">No decisions recorded yet.</div>
      </Card>
    )
  }

  const handleLoadMore = async () => {
    const newCount = showCount + 10
    setShowCount(newCount)
    try {
      const more = await fetchDecisions(sessionId, newCount)
      useSessionStore.setState({ decisions: more })
    } catch {}
  }

  return (
    <Card title="Decision History">
      <div className="space-y-2">
        {decisions.slice(0, showCount).map((d: any, i: number) => (
          <div key={d.id ?? i} className="bg-surface-2 rounded-lg p-2.5 border border-gray-800">
            <div className="flex items-center gap-2 mb-1">
              <VerdictBadge verdict={d.verdict} />
              <span className="text-xs font-mono text-gray-500">C{d.cycle}</span>
              <span className="text-xs text-accent-cyan font-mono">{d.delegate_to}</span>
            </div>
            <div className="text-xs text-gray-300 line-clamp-2">{d.reason || d.context}</div>
            {d.target_claims?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {d.target_claims.map((c: string) => (
                  <span key={c} className="text-[10px] font-mono bg-surface-0 text-gray-500 px-1.5 py-0.5 rounded">
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {decisions.length >= showCount && (
          <button
            onClick={handleLoadMore}
            className="w-full text-xs text-gray-500 hover:text-accent-cyan py-2 transition-colors"
          >
            Load more...
          </button>
        )}
      </div>
    </Card>
  )
}

// ── Research Plan ───────────────────────────────────

function PlanCard({ plan }: { plan: any }) {
  if (!plan) return null

  const { researchMap, stagePlan, checklist } = plan

  return (
    <Card title="Research Plan">
      <div className="space-y-3">
        {/* Routes */}
        {researchMap?.routes?.length > 0 && (
          <div>
            <h4 className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1.5">Routes</h4>
            <div className="space-y-1">
              {researchMap.routes.map((r: any) => (
                <div key={r.id} className="flex items-center gap-2 text-xs">
                  <RouteStatusBadge status={r.status} />
                  <span className="text-gray-300 truncate">{r.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stage Plan */}
        {stagePlan && (
          <div>
            <h4 className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1.5">Current Stage</h4>
            <div className="bg-surface-2 rounded-lg p-2.5 border border-gray-800">
              <div className="text-sm text-white font-medium">{stagePlan.stage}</div>
              <div className="text-xs text-gray-400 mt-1">{stagePlan.objective}</div>
              {stagePlan.success_condition && (
                <div className="text-xs text-accent-green mt-1">Goal: {stagePlan.success_condition}</div>
              )}
            </div>
          </div>
        )}

        {/* Checklist */}
        {checklist?.items?.length > 0 && (
          <div>
            <h4 className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1.5">Checklist</h4>
            <div className="space-y-1">
              {checklist.items.map((item: any) => (
                <div key={item.id} className="flex items-center gap-2 text-xs">
                  <CheckIcon status={item.status} />
                  <span className={item.status === 'completed' ? 'text-gray-500 line-through' : 'text-gray-300'}>
                    {item.description}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

// ── Fragments ───────────────────────────────────────

function FragmentsCard({ fragments, sessionId }: { fragments: any[] | null; sessionId: string }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [expandedContent, setExpandedContent] = useState<string | null>(null)

  if (!fragments || fragments.length === 0) {
    return (
      <Card title="Fragments">
        <div className="text-xs text-gray-600 text-center py-4">No fragments yet.</div>
      </Card>
    )
  }

  const handleExpand = async (fragId: string) => {
    if (expanded === fragId) {
      setExpanded(null)
      setExpandedContent(null)
      return
    }
    setExpanded(fragId)
    try {
      const frag = await fetchFragment(sessionId, fragId)
      setExpandedContent(frag?.content ?? frag?.notes ?? JSON.stringify(frag, null, 2))
    } catch {
      setExpandedContent('Failed to load fragment content.')
    }
  }

  // Group by type
  const byType: Record<string, any[]> = {}
  for (const f of fragments) {
    const type = f.type ?? 'other'
    if (!byType[type]) byType[type] = []
    byType[type].push(f)
  }

  return (
    <Card title={`Fragments (${fragments.length})`}>
      <div className="space-y-3">
        {Object.entries(byType).map(([type, frags]) => (
          <div key={type}>
            <h4 className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1">{type}</h4>
            <div className="space-y-1">
              {frags.map((f: any) => (
                <div key={f.id}>
                  <button
                    onClick={() => handleExpand(f.id)}
                    className="w-full text-left flex items-center gap-2 px-2 py-1.5 bg-surface-2 rounded text-xs hover:bg-surface-3 transition-colors"
                  >
                    <StatusDot status={f.status} />
                    <span className="text-gray-300 flex-1 truncate">{f.title}</span>
                    <span className="text-[10px] text-gray-600">{expanded === f.id ? '−' : '+'}</span>
                  </button>
                  {expanded === f.id && (
                    <div className="mt-1 bg-surface-0 rounded-lg border border-gray-800 p-3 text-xs">
                      {expandedContent ? (
                        <MarkdownViewer content={expandedContent} />
                      ) : (
                        <span className="text-gray-600">Loading...</span>
                      )}
                      {f.related_claims?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {f.related_claims.map((c: string) => (
                            <span key={c} className="text-[10px] font-mono bg-surface-2 text-gray-500 px-1.5 py-0.5 rounded">
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ── Shared mini-components ──────────────────────────

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center">
      <div className={`text-lg font-mono font-bold ${color}`}>{value ?? 0}</div>
      <div className="text-[10px] text-gray-600">{label}</div>
    </div>
  )
}

function ReadinessBadge({ readiness }: { readiness: string }) {
  const variant = readiness === 'ready' ? 'green'
    : readiness === 'nearly_ready' ? 'cyan'
    : readiness === 'needs_work' ? 'yellow'
    : 'gray'
  return <Badge variant={variant}>{readiness?.replace(/_/g, ' ') ?? 'unknown'}</Badge>
}

function MethodStatusBadge({ status }: { status: string }) {
  const variant = status === 'incumbent' ? 'cyan'
    : status === 'main_verified' ? 'green'
    : status === 'in_progress' ? 'yellow'
    : status === 'abandoned' || status === 'superseded' ? 'red'
    : 'gray'
  return <Badge variant={variant}>{status}</Badge>
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const variant = verdict === 'good' ? 'green'
    : verdict === 'bad' ? 'red'
    : verdict === 'blocked' ? 'yellow'
    : 'gray'
  return <Badge variant={variant}>{verdict}</Badge>
}

function RouteStatusBadge({ status }: { status: string }) {
  const variant = status === 'active' ? 'cyan'
    : status === 'completed' ? 'green'
    : status === 'abandoned' ? 'red'
    : 'gray'
  return <Badge variant={variant}>{status}</Badge>
}

function CheckIcon({ status }: { status: string }) {
  if (status === 'completed') {
    return <span className="text-accent-green">&#10003;</span>
  }
  if (status === 'in_progress') {
    return <span className="text-accent-yellow">&#9679;</span>
  }
  if (status === 'blocked') {
    return <span className="text-accent-red">&#10007;</span>
  }
  return <span className="text-gray-600">&#9675;</span>
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'finalized' ? 'bg-accent-green'
    : status === 'reviewed' ? 'bg-accent-cyan'
    : 'bg-gray-600'
  return <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${color}`} />
}
