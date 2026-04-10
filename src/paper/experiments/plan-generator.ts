import { randomUUID } from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { chatCompletion } from '../llm-client'
import { DEFAULT_MODEL_ASSIGNMENTS } from '../types'
import { extractModelId } from '../agent-dispatch'
import type { Proposal } from '../proposal/types'
import type { ExperimentPlan, DatasetSpec, ExperimentSpec } from './types'
import type { SystemCapabilities } from '../research-state'
import { repairTruncatedJSON } from '../json-repair'

const PLAN_FILENAME = 'experiment-plan.json'

/**
 * Generate an ExperimentPlan from a Proposal using LLM.
 *
 * The plan specifies:
 * - Which datasets to download and how
 * - Which experiments to run (with concrete script outlines)
 * - Execution order (topologically sorted)
 * - Success criteria for each experiment
 */
export class ExperimentPlanGenerator {
  private modelSpec: string

  constructor(modelSpec?: string) {
    this.modelSpec = modelSpec ?? DEFAULT_MODEL_ASSIGNMENTS.research
  }

  async generate(
    proposal: Proposal,
    opts?: {
      compute?: SystemCapabilities | null
      projectDir?: string
    },
  ): Promise<ExperimentPlan> {
    const systemPrompt = this.buildSystemPrompt(opts?.compute)
    const userPrompt = this.buildUserPrompt(proposal)

    const result = await chatCompletion({
      modelSpec: this.modelSpec,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: 8192,
      temperature: 0.3,
    })

    const plan = this.parseResponse(result.text, proposal.id)

    // Persist to project directory if provided
    if (opts?.projectDir) {
      this.save(plan, opts.projectDir)
    }

    return plan
  }

  /**
   * Load a previously saved plan from disk.
   */
  static load(projectDir: string): ExperimentPlan | null {
    const planPath = join(projectDir, PLAN_FILENAME)
    if (!existsSync(planPath)) return null
    try {
      const raw = readFileSync(planPath, 'utf-8')
      return JSON.parse(raw) as ExperimentPlan
    } catch {
      return null
    }
  }

  /**
   * Save plan to project directory.
   */
  save(plan: ExperimentPlan, projectDir: string): void {
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(
      join(projectDir, PLAN_FILENAME),
      JSON.stringify(plan, null, 2) + '\n',
      'utf-8',
    )
  }

  private buildSystemPrompt(compute?: SystemCapabilities | null): string {
    const gpuInfo = compute?.gpu
      ? `GPU available: ${compute.gpu}`
      : 'No GPU available — all experiments must be CPU-only'

    return `You are a research experiment designer. Given a research proposal, you design a concrete, executable experiment plan.

## Constraints
- ${gpuInfo}
- All Python code runs via \`uv run\` in isolated environments
- Default packages: numpy, pandas, scipy (tier-1), + matplotlib, pytest, ruff (tier-2)
- Any additional packages must be listed in python_packages
- Datasets must be auto-downloadable (no manual steps)
- Each experiment must output results/metrics.json
- Seed = 42 for reproducibility

## Design Principles
- Start with tier-1 probes (quick sanity checks) before tier-2 full runs
- Each experiment should target a specific claim from the proposal
- Include baselines — always compare against a simple baseline method
- Design for incremental validation: if probe fails, no need to run full experiment
- Keep compute estimates realistic and conservative

## Output Format
Return a single JSON object (no markdown fences) matching this schema:
{
  "datasets": [
    {
      "name": "unique_dataset_name",
      "source": "openml" | "sklearn" | "huggingface" | "url" | "generate" | "api",
      "source_id": "optional source-specific ID",
      "download_code": "Python code to download and return the dataset as a DataFrame or similar",
      "size_estimate": "~10K rows, 20 features",
      "description": "What this dataset contains and why we use it"
    }
  ],
  "experiments": [
    {
      "id": "exp-001-short-name",
      "name": "Human-readable name",
      "claim_target": "Which proposal claim this validates",
      "description": "What this experiment tests",
      "type": "probe" | "full",
      "datasets": ["dataset_name_ref"],
      "script_outline": "High-level pseudocode for what the script does",
      "metrics_to_collect": ["accuracy", "f1", "training_time_sec"],
      "success_criteria": "accuracy > random baseline on >80% of datasets",
      "dependencies": ["other-exp-id if any"],
      "estimated_duration": "5 minutes",
      "python_packages": ["scikit-learn", "xgboost"]
    }
  ],
  "execution_order": ["exp-001-...", "exp-002-..."],
  "total_compute_estimate": "~30 minutes on CPU",
  "requires_gpu": false,
  "data_acquisition_strategy": "Summary of how all data is obtained"
}`
  }

  private buildUserPrompt(proposal: Proposal): string {
    return `Design an experiment plan for this research proposal:

# ${proposal.title}

## Abstract
${proposal.abstract}

## Methodology
${proposal.methodology}

## Innovation Points
${proposal.innovation.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}

## Data Requirements
${proposal.feasibility.data_required}

## Compute Budget
${proposal.feasibility.compute_estimate}

## Risk Level
${proposal.risk.level}: ${proposal.risk.description}

---

Design 3-8 experiments that incrementally validate the key claims. Start with quick probes, then build up to full experiments. Ensure every innovation point has at least one experiment targeting it.`
  }

  private parseResponse(text: string, proposalId: string): ExperimentPlan {
    // Strip markdown code fences if present
    let cleaned = text.trim()
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    let parsed: any
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      // repairTruncatedJSON returns a parsed object or null
      parsed = repairTruncatedJSON(cleaned)
      if (!parsed) throw new Error('Failed to parse experiment plan JSON')
    }

    // Validate and normalize
    const datasets: DatasetSpec[] = (parsed.datasets ?? []).map((d: any) => ({
      name: d.name ?? 'unnamed',
      source: d.source ?? 'url',
      source_id: d.source_id,
      download_code: d.download_code ?? '',
      size_estimate: d.size_estimate ?? 'unknown',
      description: d.description ?? '',
    }))

    const experiments: ExperimentSpec[] = (parsed.experiments ?? []).map(
      (e: any, idx: number) => ({
        id: e.id ?? `exp-${String(idx + 1).padStart(3, '0')}`,
        name: e.name ?? `Experiment ${idx + 1}`,
        claim_target: e.claim_target ?? '',
        description: e.description ?? '',
        type: e.type === 'full' ? 'full' : 'probe',
        datasets: Array.isArray(e.datasets) ? e.datasets : [],
        script_outline: e.script_outline ?? '',
        metrics_to_collect: Array.isArray(e.metrics_to_collect)
          ? e.metrics_to_collect
          : [],
        success_criteria: e.success_criteria ?? '',
        dependencies: Array.isArray(e.dependencies) ? e.dependencies : [],
        estimated_duration: e.estimated_duration ?? 'unknown',
        python_packages: Array.isArray(e.python_packages)
          ? e.python_packages
          : [],
      }),
    )

    const executionOrder: string[] =
      parsed.execution_order ?? experiments.map(e => e.id)

    return {
      id: `plan-${randomUUID().slice(0, 8)}`,
      proposal_id: proposalId,
      created_at: new Date().toISOString(),
      datasets,
      experiments,
      execution_order: executionOrder,
      total_compute_estimate: parsed.total_compute_estimate ?? 'unknown',
      requires_gpu: parsed.requires_gpu ?? false,
      data_acquisition_strategy: parsed.data_acquisition_strategy ?? '',
    }
  }
}

/**
 * Summarize an experiment plan into a compact context string
 * for injection into Builder/Arbiter prompts.
 */
export function summarizeExperimentPlan(plan: ExperimentPlan): string {
  const sections: string[] = [
    '## Experiment Plan',
    `Total compute: ${plan.total_compute_estimate} | GPU: ${plan.requires_gpu ? 'required' : 'not required'}`,
    '',
    '### Datasets',
    ...plan.datasets.map(
      d => `- **${d.name}** (${d.source}${d.source_id ? ':' + d.source_id : ''}): ${d.description} [${d.size_estimate}]`,
    ),
    '',
    '### Experiments (execution order)',
    ...plan.execution_order.map(id => {
      const exp = plan.experiments.find(e => e.id === id)
      if (!exp) return `- ${id} (not found)`
      const deps = exp.dependencies.length > 0 ? ` [depends: ${exp.dependencies.join(', ')}]` : ''
      return `- **${exp.id}** (${exp.type}): ${exp.name}${deps}\n  Target: ${exp.claim_target}\n  Success: ${exp.success_criteria}\n  Duration: ${exp.estimated_duration}`
    }),
    '',
    `Data strategy: ${plan.data_acquisition_strategy}`,
  ]
  return sections.join('\n')
}
