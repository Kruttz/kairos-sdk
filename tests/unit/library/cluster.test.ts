import { describe, it, expect } from 'vitest'
import { clusterWorkflows, rerank } from '../../../src/library/cluster.js'
import type { StoredWorkflow } from '../../../src/library/types.js'

function makeStored(name: string, nodeTypes: string[], overrides?: Partial<StoredWorkflow>): StoredWorkflow {
  return {
    id: 'test-' + Math.random().toString(36).slice(2),
    workflow: {
      name,
      nodes: nodeTypes.map((type, i) => ({
        id: String(i),
        parameters: {},
        name: type.split('.').pop()!,
        type: `n8n-nodes-base.${type}`,
        typeVersion: 1,
        position: [i * 200, 0] as [number, number],
      })),
      connections: {},
    },
    description: name,
    tags: [],
    platform: 'n8n',
    deployCount: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('clusterWorkflows', () => {
  it('groups workflows with identical node fingerprints', () => {
    const w1 = makeStored('Slack Alert 1', ['webhook', 'slack'])
    const w2 = makeStored('Slack Alert 2', ['webhook', 'slack'])
    const w3 = makeStored('Email Report', ['scheduleTrigger', 'httpRequest', 'gmail'])

    const clusters = clusterWorkflows([w1, w2, w3])
    expect(clusters.length).toBe(2)

    const slackCluster = clusters.find((c) => c.members.length === 2)!
    expect(slackCluster.members.map((m) => m.id).sort()).toEqual([w1.id, w2.id].sort())
  })

  it('computes cluster-level outcome stats', () => {
    const w1 = makeStored('Good 1', ['webhook', 'slack'], {
      outcomeStats: { totalUses: 10, totalAttempts: 10, firstTryPasses: 9, failedRules: {} },
    })
    const w2 = makeStored('Good 2', ['webhook', 'slack'], {
      outcomeStats: { totalUses: 10, totalAttempts: 12, firstTryPasses: 8, failedRules: { '12': 2 } },
    })

    const clusters = clusterWorkflows([w1, w2])
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.avgFirstTryPassRate).toBeCloseTo(0.85, 1)
    expect(clusters[0]!.avgAttempts).toBeCloseTo(1.1, 1)
  })

  it('identifies common failed rules in cluster', () => {
    const w1 = makeStored('Fail 1', ['webhook', 'set'], {
      outcomeStats: { totalUses: 5, totalAttempts: 8, firstTryPasses: 2, failedRules: { '12': 3, '14': 1 } },
    })
    const w2 = makeStored('Fail 2', ['webhook', 'set'], {
      outcomeStats: { totalUses: 5, totalAttempts: 9, firstTryPasses: 1, failedRules: { '12': 4 } },
    })

    const clusters = clusterWorkflows([w1, w2])
    const rules = clusters[0]!.commonFailedRules
    expect(rules.length).toBeGreaterThanOrEqual(1)
    expect(rules[0]!.rule).toBe(12)
  })
})

describe('rerank', () => {
  it('boosts candidates from high-success clusters', () => {
    const good = makeStored('Good', ['webhook', 'slack'], {
      outcomeStats: { totalUses: 20, totalAttempts: 20, firstTryPasses: 20, failedRules: {} },
    })
    const bad = makeStored('Bad', ['scheduleTrigger', 'gmail'], {
      outcomeStats: { totalUses: 20, totalAttempts: 40, firstTryPasses: 5, failedRules: { '12': 10, '14': 5 } },
    })

    const clusters = clusterWorkflows([good, bad])

    const candidates = [
      { workflow: bad, score: 0.8 },
      { workflow: good, score: 0.78 },
    ]

    const reranked = rerank(candidates, clusters)
    expect(reranked[0]!.workflow.id).toBe(good.id)
  })

  it('attaches cluster pattern to results', () => {
    const w = makeStored('Test', ['webhook', 'slack'])
    const clusters = clusterWorkflows([w])
    const reranked = rerank([{ workflow: w, score: 0.5 }], clusters)
    expect(reranked[0]!.clusterPattern).toBeDefined()
  })
})
