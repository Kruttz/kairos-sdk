import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { WorkflowMatch } from '../library/types.js'
import type { RuleFailureRate } from '../telemetry/reader.js'
import type { PatternAnalysis, Pattern } from '../telemetry/pattern-analyzer.js'
import type { DesignRequest, BuiltPrompt, SystemPromptBlock } from './types.js'
import { SYSTEM_PROMPT_V1 } from './prompts/v1.js'
import { scoreToMode } from '../utils/thresholds.js'
import { RULE_MITIGATIONS, RULE_EXAMPLES } from '../validation/rule-metadata.js'

const CRITICAL_SCORE_THRESHOLD = 0.15

type PromptProfile = 'minimal' | 'standard' | 'rich'

function resolveProfile(): PromptProfile {
  const env = process.env['KAIROS_PROMPT_PROFILE']
  if (env === 'minimal' || env === 'standard' || env === 'rich') return env
  return 'standard'
}

const PROACTIVE_EXPRESSION_GUIDANCE = `## Expression Syntax Quick Reference\n\nAlways use these patterns in expressions:\n- Access node data:  $('NodeName').item.json.field  (not $node["NodeName"].json)\n- Access JSON field: $json.field  (not $json.items[0].field)\n- Single item:       $('NodeName').first().json.field\n- All items:         $('NodeName').all()`

export class PromptBuilder {
  private readonly patternsPath: string
  private readonly profile: PromptProfile
  private _lastActivePatterns: Pattern[] | null = null

  constructor(patternsPath?: string, profile?: PromptProfile) {
    this.patternsPath = patternsPath ?? join(homedir(), '.kairos', 'patterns.json')
    this.profile = profile ?? resolveProfile()
  }

  private resolveMaxPatterns(): number {
    if (this.profile === 'minimal') return 3
    if (this.profile === 'rich') return 15
    return 10
  }

  build(request: DesignRequest, matches: WorkflowMatch[], globalFailureRates: RuleFailureRate[] = [], dynamicCatalog?: string): BuiltPrompt {
    const mode = this.resolveMode(matches)
    const system = this.buildSystem(matches, mode, globalFailureRates, dynamicCatalog)
    const userMessage = this.buildUserMessage(request, matches, mode)
    return { system, userMessage, mode, matches }
  }

  buildCorrectionMessage(
    request: DesignRequest,
    matches: WorkflowMatch[],
    allIssues: string[],
    attempt: number,
    failingRuleIds?: number[],
  ): string {
    const base = this.buildUserMessage(request, matches, this.resolveMode(matches))

    let examplesSection = ''
    if (failingRuleIds && failingRuleIds.length > 0) {
      const uniqueRules = [...new Set(failingRuleIds)]
      const exampleLines: string[] = []
      for (const rule of uniqueRules) {
        const ex = RULE_EXAMPLES[rule]
        if (ex) {
          exampleLines.push(`Rule ${rule}:\n  Bad:  ${ex.bad}\n  Good: ${ex.good}`)
        }
      }
      if (exampleLines.length > 0) {
        examplesSection = `\n\n## Concrete Fix Examples\n${exampleLines.join('\n\n')}`
      }
    }

    return `${base}

IMPORTANT: A previous generation attempt (attempt ${attempt}) failed validation with these issues:
${allIssues.join('\n')}

Fix ALL of the above issues in your new response. Do not repeat any of these mistakes.${examplesSection}`
  }

  private resolveMode(matches: WorkflowMatch[]): 'direct' | 'reference' | 'scratch' {
    if (matches.length === 0) return 'scratch'
    const top = matches[0]
    if (!top) return 'scratch'
    return scoreToMode(top.score)
  }

  private buildSystem(matches: WorkflowMatch[], mode: 'direct' | 'reference' | 'scratch', globalFailureRates: RuleFailureRate[] = [], dynamicCatalog?: string): SystemPromptBlock[] {
    let basePrompt = SYSTEM_PROMPT_V1
    if (dynamicCatalog) {
      basePrompt = basePrompt.replace(
        /## NODE CATALOG — exact type strings and safe typeVersions[\s\S]*?(?=## PRE-DELIVERY SELF-CHECK)/,
        dynamicCatalog + '\n\n',
      )
    }

    const blocks: SystemPromptBlock[] = [
      {
        type: 'text',
        text: basePrompt,
        cache_control: { type: 'ephemeral' },
      },
    ]

    if (this.profile !== 'minimal') {
      if (mode === 'reference' && matches.length > 0) {
        const refText = matches
          .slice(0, 3)
          .map((m) => {
            const nodes = m.workflow.workflow.nodes
              .map((n) => `  - ${n.name} (${n.type} v${n.typeVersion})`)
              .join('\n')
            return `Reference workflow: "${m.workflow.description}" (similarity: ${m.score.toFixed(2)})\nNodes:\n${nodes}`
          })
          .join('\n\n')

        blocks.push({
          type: 'text',
          text: `## Similar Workflows From Library (for reference only — adapt, do not copy verbatim)\n\n${refText}`,
        })
      }

      if (mode === 'direct' && matches[0]) {
        const match = matches[0]
        const json = JSON.stringify(match.workflow.workflow, null, 2)
        if (json.length > 30_000) {
          const nodes = match.workflow.workflow.nodes
            .map((n) => `  - ${n.name} (${n.type} v${n.typeVersion})`)
            .join('\n')
          blocks.push({
            type: 'text',
            text: `## Closely Matched Workflow (score: ${match.score.toFixed(2)}) — too large for full JSON, using reference:\nNodes:\n${nodes}`,
          })
        } else {
          blocks.push({
            type: 'text',
            text: `## Closely Matched Workflow (score: ${match.score.toFixed(2)}) — adapt this structure:\n\n${json}`,
          })
        }
      }

      if (mode === 'scratch' && matches.length > 0 && matches[0]!.score >= 0.40) {
        const hint = matches[0]!
        const nodeTypes = hint.workflow.workflow.nodes.map((n) => n.type.split('.').pop()).join(', ')
        blocks.push({
          type: 'text',
          text: `## Weak Structural Hint\nA loosely similar workflow (score: ${hint.score.toFixed(2)}) used these node types: ${nodeTypes}`,
        })
      }
    }

    const warnings = this.buildFailureWarnings(matches, globalFailureRates)
    if (warnings) {
      blocks.push({ type: 'text', text: warnings })
    }

    if (this.profile === 'rich') {
      const expressionRules = new Set([24, 25, 26])
      const expressionAlreadyCovered = (this._lastActivePatterns ?? []).some(p => expressionRules.has(p.rule))
      if (!expressionAlreadyCovered) {
        blocks.push({ type: 'text', text: PROACTIVE_EXPRESSION_GUIDANCE })
      }
    }

    return blocks
  }

  private loadPatterns(): Pattern[] {
    try {
      const raw = readFileSync(this.patternsPath, 'utf-8')
      const analysis = JSON.parse(raw) as PatternAnalysis
      const patterns = analysis.topFailureRules ?? []
      return patterns.filter(p => typeof p.pipelineStage === 'string' && typeof p.state === 'string')
    } catch {
      return []
    }
  }

  getWarnedRules(): number[] {
    const patterns = this._lastActivePatterns ?? this.getActivePatterns(this.resolveMaxPatterns())
    return patterns.map(p => p.rule)
  }

  private getActivePatterns(maxCount = 10): Pattern[] {
    const all = this.loadPatterns()
      .filter(p => p.state !== 'resolved' && p.confidence > 0)

    const regressed = all.filter(p => p.regressed).sort((a, b) => b.compositeScore - a.compositeScore)
    const confirmed = all.filter(p => !p.regressed && p.state === 'confirmed').sort((a, b) => b.compositeScore - a.compositeScore)
    const drafts = all.filter(p => !p.regressed && p.state !== 'confirmed').sort((a, b) => b.compositeScore - a.compositeScore)

    return [...regressed, ...confirmed, ...drafts].slice(0, maxCount)
  }

  private buildFailureWarnings(matches: WorkflowMatch[], globalFailureRates: RuleFailureRate[]): string | null {
    const richPatterns = this.getActivePatterns(this.resolveMaxPatterns())
    this._lastActivePatterns = richPatterns

    if (richPatterns.length > 0) {
      return this.buildStageGroupedWarnings(richPatterns, matches)
    }

    return this.buildLegacyWarnings(matches, globalFailureRates)
  }

  private buildStageGroupedWarnings(patterns: Pattern[], matches: WorkflowMatch[]): string | null {
    const stageLabels: Record<string, string> = {
      credential_injection: 'CREDENTIAL FORMATTING',
      connection_wiring: 'CONNECTION WIRING',
      node_generation: 'NODE GENERATION',
      workflow_structure: 'WORKFLOW STRUCTURE',
      expression_syntax: 'EXPRESSION SYNTAX',
    }

    const byStage = new Map<string, Pattern[]>()
    for (const p of patterns) {
      const list = byStage.get(p.pipelineStage) ?? []
      list.push(p)
      byStage.set(p.pipelineStage, list)
    }

    const sections: string[] = []
    for (const [stage, stagePatterns] of byStage) {
      const label = stageLabels[stage] ?? stage

      const byMitigation = new Map<string, Pattern[]>()
      for (const p of stagePatterns) {
        const key = p.mitigation ?? `rule_${p.rule}`
        const list = byMitigation.get(key) ?? []
        list.push(p)
        byMitigation.set(key, list)
      }

      const lines: string[] = []
      for (const group of byMitigation.values()) {
        if (group.length === 1) {
          const p = group[0]!
          const urgency = p.regressed ? 'CRITICAL REGRESSION: ' : (p.compositeScore ?? 0) >= CRITICAL_SCORE_THRESHOLD ? 'CRITICAL: ' : ''
          const statePrefix = p.state === 'confirmed' ? '[CONFIRMED] ' : ''
          const trendSuffix = p.trend === 'worsening' ? ' (GETTING WORSE)' : p.trend === 'improving' ? ' (improving)' : ''
          const remedy = p.mitigation ?? RULE_MITIGATIONS[p.rule]
          const remedyStr = remedy ? `\n  Fix: ${remedy}` : ''
          const ex = RULE_EXAMPLES[p.rule]
          const exampleStr = ex ? `\n  Bad:  ${ex.bad}\n  Good: ${ex.good}` : ''
          lines.push(`- ${urgency}${statePrefix}Rule ${p.rule}${trendSuffix}: ${p.exampleMessages[0] ?? 'No example'}${remedyStr}${exampleStr}`)
        } else {
          const ruleNums = group.map(p => p.rule).join(', ')
          const totalFailures = group.reduce((s, p) => s + p.failureCount, 0)
          const hasConfirmed = group.some(p => p.state === 'confirmed')
          const statePrefix = hasConfirmed ? '[CONFIRMED] ' : ''
          const remedy = group[0]!.mitigation
          const remedyStr = remedy ? `\n  Fix: ${remedy}` : ''
          lines.push(`- ${statePrefix}Rules ${ruleNums} (${totalFailures} failures combined): same root cause${remedyStr}`)
        }
      }
      sections.push(`### ${label}\n${lines.join('\n')}`)
    }

    for (const match of matches) {
      const fps = match.workflow.failurePatterns
      if (!fps?.length) continue
      const coveredRules = new Set(patterns.map(p => p.rule))
      const extra = fps.filter(fp => !coveredRules.has(fp.rule))
      for (const fp of extra) {
        const remedy = RULE_MITIGATIONS[fp.rule]
        const remedyStr = remedy ? ` — Fix: ${remedy}` : ''
        sections.push(`- Rule ${fp.rule}: "${fp.message}"${remedyStr} (seen in similar workflows)`)
      }
    }

    if (sections.length === 0) return null

    return `## Known Failure Patterns — AVOID THESE\n\nGrouped by generation stage. Fix these BEFORE outputting your response:\n\n${sections.join('\n\n')}`
  }

  private buildLegacyWarnings(matches: WorkflowMatch[], globalFailureRates: RuleFailureRate[]): string | null {
    const lines: string[] = []

    for (const match of matches) {
      const patterns = match.workflow.failurePatterns
      if (!patterns?.length) continue
      for (const fp of patterns) {
        const remedy = RULE_MITIGATIONS[fp.rule]
        const remedyStr = remedy ? ` — Fix: ${remedy}` : ''
        lines.push(`- Rule ${fp.rule}: "${fp.message}"${remedyStr} (seen ${fp.occurrences}x in similar workflows)`)
      }
    }

    const highFreqRules = globalFailureRates.filter((r) => r.rate >= 0.15)
    for (const rule of highFreqRules) {
      const remedy = RULE_MITIGATIONS[rule.rule]
      const remedyStr = remedy ? ` — Fix: ${remedy}` : ''
      lines.push(`- Rule ${rule.rule}: "${rule.commonMessage}"${remedyStr} (fails in ${Math.round(rule.rate * 100)}% of all builds)`)
    }

    if (lines.length === 0) return null

    const unique = [...new Set(lines)]
    return `## Known Failure Patterns — AVOID THESE\n\nPrevious builds frequently failed the following validation rules. Ensure your output does NOT repeat these mistakes:\n${unique.join('\n')}`
  }

  private buildUserMessage(request: DesignRequest, _matches: WorkflowMatch[], _mode: string): string {
    const namePart = request.name ? `\nWorkflow name: "${request.name}"` : ''
    return `Build a workflow that: ${request.description}${namePart}`
  }
}
