import type { StoredWorkflow } from './types.js'

export interface WorkflowCluster {
  pattern: string
  fingerprint: string[]
  members: StoredWorkflow[]
  avgFirstTryPassRate: number
  avgAttempts: number
  commonFailedRules: Array<{ rule: number; frequency: number }>
}

function getFingerprint(w: StoredWorkflow): string[] {
  return w.workflow.nodes
    .map((n) => n.type.split('.').pop() ?? '')
    .sort()
}

function fingerprintKey(fp: string[]): string {
  return fp.join('|')
}

function describePattern(fp: string[]): string {
  const triggers = fp.filter((n) => /trigger/i.test(n))
  const outputs = fp.filter((n) => /slack|gmail|email|telegram|sheets|airtable|notion/i.test(n))
  const ai = fp.filter((n) => /agent|openai|anthropic|chain|memory/i.test(n))
  const core = fp.filter((n) => /httpRequest|code|merge|switch|if|set|filter/i.test(n))

  const parts: string[] = []
  if (triggers.length > 0) parts.push(triggers[0]!)
  if (ai.length > 0) parts.push('AI')
  if (core.length > 0) parts.push(core.slice(0, 2).join('+'))
  if (outputs.length > 0) parts.push(outputs[0]!)

  return parts.length > 0 ? parts.join(' → ') : fp.slice(0, 3).join(' → ')
}

export function clusterWorkflows(workflows: StoredWorkflow[]): WorkflowCluster[] {
  const groups = new Map<string, StoredWorkflow[]>()

  for (const w of workflows) {
    const fp = getFingerprint(w)
    const key = fingerprintKey(fp)

    const existing = groups.get(key)
    if (existing) {
      existing.push(w)
    } else {
      groups.set(key, [w])
    }
  }

  const clusters: WorkflowCluster[] = []

  for (const [, members] of groups) {
    if (members.length === 0) continue

    const fp = getFingerprint(members[0]!)
    const withStats = members.filter((m) => m.outcomeStats && m.outcomeStats.totalUses > 0)

    let avgFirstTryPassRate = 0
    let avgAttempts = 0

    if (withStats.length > 0) {
      avgFirstTryPassRate = withStats.reduce((sum, m) => {
        const s = m.outcomeStats!
        return sum + s.firstTryPasses / s.totalUses
      }, 0) / withStats.length

      avgAttempts = withStats.reduce((sum, m) => {
        const s = m.outcomeStats!
        return sum + s.totalAttempts / s.totalUses
      }, 0) / withStats.length
    }

    const ruleCounts = new Map<number, number>()
    let totalFailureInstances = 0
    for (const m of withStats) {
      const rules = m.outcomeStats!.failedRules
      for (const [rule, count] of Object.entries(rules)) {
        const r = parseInt(rule, 10)
        ruleCounts.set(r, (ruleCounts.get(r) ?? 0) + count)
        totalFailureInstances += count
      }
    }

    const commonFailedRules = [...ruleCounts.entries()]
      .map(([rule, count]) => ({
        rule,
        frequency: totalFailureInstances > 0 ? count / totalFailureInstances : 0,
      }))
      .filter((r) => r.frequency >= 0.1)
      .sort((a, b) => b.frequency - a.frequency)

    clusters.push({
      pattern: describePattern(fp),
      fingerprint: fp,
      members,
      avgFirstTryPassRate,
      avgAttempts,
      commonFailedRules,
    })
  }

  return clusters.sort((a, b) => b.members.length - a.members.length)
}

export function rerank(
  candidates: Array<{ workflow: StoredWorkflow; score: number }>,
  clusters: WorkflowCluster[],
): Array<{ workflow: StoredWorkflow; score: number; clusterPattern?: string }> {
  const clusterMap = new Map<string, WorkflowCluster>()
  for (const cluster of clusters) {
    for (const member of cluster.members) {
      clusterMap.set(member.id, cluster)
    }
  }

  return candidates
    .map((c) => {
      const cluster = clusterMap.get(c.workflow.id)
      let boost = 0

      if (cluster && cluster.avgFirstTryPassRate > 0) {
        boost = (cluster.avgFirstTryPassRate - 0.5) * 0.1
      }

      if (cluster && cluster.commonFailedRules.length > 0) {
        boost -= cluster.commonFailedRules.length * 0.02
      }

      return {
        workflow: c.workflow,
        score: Math.max(0, Math.min(1, c.score + boost)),
        ...(cluster ? { clusterPattern: cluster.pattern } : {}),
      }
    })
    .sort((a, b) => b.score - a.score)
}
