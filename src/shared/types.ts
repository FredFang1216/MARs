/**
 * Shared types re-exported for use by both server and web frontend.
 * These are type-only imports — no runtime code.
 */

// ── Research State ──────────────────────────────────────
export type {
  ResearchState,
  StabilityMetrics,
  BudgetState,
  TrajectoryEntry,
  ArtifactEntry,
  ArtifactStore,
  LiteratureAwareness,
  DeepReadPaper,
  KnownResult,
  ConfirmedGap,
  ProofRecord,
  AssumptionGap,
  TimeState,
  PaperType,
} from '../paper/research-state'

// ── Claim Graph ─────────────────────────────────────────
export type {
  Claim,
  ClaimEdge,
  ClaimGraphData,
  ClaimType,
  ClaimPhase,
  ClaimRelation,
  EpistemicLayer,
  EvidenceStrengthType,
  ClaimStrength,
  AssessmentEntry,
  ClaimGraphStatistics,
  WeakestBridgeResult,
  LayerSkipResult,
  ContradictionResult,
} from '../paper/claim-graph/types'

// ── Evidence Pool ───────────────────────────────────────
export type {
  EvidencePool,
  GroundedEvidence,
  DerivedEvidence,
  EvidencePoolSummary,
} from '../paper/evidence-pool'

// ── Orchestrator ────────────────────────────────────────
export type {
  OrchestratorDecision,
  ExecutionResult,
  OrchestratorCallbacks,
  OrchestratorOptions,
} from '../paper/orchestrator'

// ── Review ──────────────────────────────────────────────
export type {
  ReviewReport,
  ReviewDimensions,
  MetaReview,
  RubricSummary,
  RubricItem,
  RubricReviewResult,
  RubricAssessment,
  ReviewConfig,
} from '../paper/review/types'

// ── Experiments ─────────────────────────────────────────
export type {
  ExperimentLogEntry,
  ExperimentMeta,
  ExperimentSummary,
  DashboardData,
  CycleEntry,
  ClaimDelta,
  MetricsJson,
} from '../paper/experiments/types'

// ── Proposals ──────────────────────────────────────────
export type { Proposal, ProposalGenerationOptions } from '../paper/proposal/types'

// ── Session ─────────────────────────────────────────────
export type { SessionMeta } from '../paper/session'

// ── Session State (Conversation Mode) ──────────────────
export type {
  SessionState,
  SessionMode,
  ChatMessage,
  CollectedPaper,
} from '../paper/session-state'

// ── ACP Protocol ────────────────────────────────────────
export type {
  SessionUpdate,
  SessionUpdateNotification,
  AgentMessageChunk,
  AgentThoughtChunk,
  UserMessageChunk,
  ToolCall,
  ToolCallUpdate,
  ToolCallStatus,
  ToolKind,
  PlanUpdate,
  PlanEntry,
  ContentBlock,
  TextContent,
  ImageContent,
  PermissionOption,
  PermissionOptionKind,
  RequestPermissionParams,
  RequestPermissionResponse,
  PromptParams,
  PromptResponse,
  AvailableCommand,
} from '../acp/protocol'
