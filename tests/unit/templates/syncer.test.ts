import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TemplateSyncer } from '../../../src/templates/syncer.js'
import type { IWorkflowLibrary, WorkflowMetadataInput, StoredWorkflow, WorkflowMatch } from '../../../src/library/types.js'
import type { N8nWorkflow } from '../../../src/types/workflow.js'
import type { TemplateSearchResponse, TemplateDetailResponse } from '../../../src/templates/types.js'

const NOOP_LOGGER = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

function makeMockLibrary(
  existingWorkflows: StoredWorkflow[] = [],
): IWorkflowLibrary & { saved: Array<{ workflow: N8nWorkflow; metadata: WorkflowMetadataInput }> } {
  const saved: Array<{ workflow: N8nWorkflow; metadata: WorkflowMetadataInput }> = []
  return {
    saved,
    initialize: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(existingWorkflows),
    save: vi.fn().mockImplementation(async (wf: N8nWorkflow, meta: WorkflowMetadataInput) => {
      saved.push({ workflow: wf, metadata: meta })
      return `id-${saved.length}`
    }),
    search: vi.fn().mockResolvedValue([] as WorkflowMatch[]),
    recordDeployment: vi.fn().mockResolvedValue(undefined),
    recordOutcome: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
  }
}

function makeSearchResponse(
  ids: number[],
  total?: number,
  paid?: number[],
): TemplateSearchResponse {
  return {
    totalWorkflows: total ?? ids.length,
    workflows: ids.map((id) => ({
      id,
      name: `Template ${id}`,
      description: `Description ${id}`,
      totalViews: 100,
      createdAt: '2024-01-01',
      price: paid?.includes(id) ? 9.99 : undefined,
    })),
  }
}

type NodeDef = { id: string; name: string; type: string; typeVersion: number; position: [number, number]; parameters: Record<string, unknown> }

function makeDetailResponse(id: number, nodes?: NodeDef[]): TemplateDetailResponse {
  return {
    workflow: {
      id,
      name: `Template ${id}`,
      description: `**Bold** description for template ${id}`,
      workflow: {
        nodes: nodes ?? [
          { id: 'node-1', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 1, position: [100, 200], parameters: {} },
          { id: 'node-2', name: 'Slack', type: 'n8n-nodes-base.slack', typeVersion: 2, position: [300, 200], parameters: {} },
        ],
        connections: {},
        settings: { executionOrder: 'v1' },
      },
    },
  }
}

describe('TemplateSyncer', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    // Eliminate the 200ms inter-fetch delay so tests run fast
    vi.spyOn(global, 'setTimeout').mockImplementation((fn: TimerHandler) => {
      if (typeof fn === 'function') fn()
      return 0 as unknown as ReturnType<typeof setTimeout>
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mockFetch(responses: Array<{ ok: boolean; body: unknown; status?: number; headers?: Record<string, string> }>) {
    let idx = 0
    fetchMock.mockImplementation(async () => {
      const r = responses[idx] ?? responses[responses.length - 1]!
      idx++
      return {
        ok: r.ok,
        status: r.status ?? (r.ok ? 200 : 400),
        json: async () => r.body,
        headers: { get: (key: string) => r.headers?.[key] ?? null },
      }
    })
  }

  describe('basic sync', () => {
    it('saves a single template and reports correct progress', async () => {
      mockFetch([
        { ok: true, body: makeSearchResponse([101]) },
        { ok: true, body: makeDetailResponse(101) },
      ])

      const library = makeMockLibrary()
      const syncer = new TemplateSyncer(library, NOOP_LOGGER)
      const result = await syncer.sync({ maxTemplates: 10 })

      expect(result.saved).toBe(1)
      expect(result.blocked).toBe(0)
      expect(result.skippedPaid).toBe(0)
      expect(result.skippedDuplicate).toBe(0)
      expect(library.saved).toHaveLength(1)
    })

    it('saves multiple templates from a single search page', async () => {
      mockFetch([
        { ok: true, body: makeSearchResponse([1, 2, 3]) },
        { ok: true, body: makeDetailResponse(1) },
        { ok: true, body: makeDetailResponse(2) },
        { ok: true, body: makeDetailResponse(3) },
      ])

      const library = makeMockLibrary()
      const syncer = new TemplateSyncer(library, NOOP_LOGGER)
      const result = await syncer.sync({ maxTemplates: 100 })

      expect(result.saved).toBe(3)
      expect(library.saved).toHaveLength(3)
    })

    it('respects maxTemplates cap', async () => {
      // Search returns 5 items but we only want 2
      mockFetch([
        { ok: true, body: makeSearchResponse([1, 2, 3, 4, 5], 5) },
        { ok: true, body: makeDetailResponse(1) },
        { ok: true, body: makeDetailResponse(2) },
      ])

      const library = makeMockLibrary()
      const syncer = new TemplateSyncer(library, NOOP_LOGGER)
      const result = await syncer.sync({ maxTemplates: 2 })

      expect(result.saved).toBe(2)
      expect(library.saved).toHaveLength(2)
    })
  })

  describe('skippedDuplicate', () => {
    it('skips templates already in the library by sourceId', async () => {
      mockFetch([
        { ok: true, body: makeSearchResponse([101, 102]) },
        // Only template 102 detail fetch — 101 is already in library
        { ok: true, body: makeDetailResponse(102) },
      ])

      const existingWorkflow: StoredWorkflow = {
        id: 'existing-1',
        description: 'Template 101',
        workflow: { name: 'Template 101', nodes: [], connections: {} },
        createdAt: new Date().toISOString(),
        tags: [],
        sourceKind: 'n8n-template',
        sourceId: '101',
        trustLevel: 'safe',
        generationAttempts: 0,
        deployCount: 0,
        timesRetrieved: 0,
      }

      const library = makeMockLibrary([existingWorkflow])
      const syncer = new TemplateSyncer(library, NOOP_LOGGER)
      const result = await syncer.sync({ maxTemplates: 10 })

      expect(result.skippedDuplicate).toBe(1)
      expect(result.saved).toBe(1)
    })
  })

  describe('skippedPaid', () => {
    it('skips paid templates during search phase', async () => {
      mockFetch([
        { ok: true, body: makeSearchResponse([1, 2, 3], 3, [2]) }, // template 2 is paid
        { ok: true, body: makeDetailResponse(1) },
        { ok: true, body: makeDetailResponse(3) },
      ])

      const library = makeMockLibrary()
      const syncer = new TemplateSyncer(library, NOOP_LOGGER)
      const result = await syncer.sync({ maxTemplates: 10 })

      expect(result.skippedPaid).toBe(1)
      expect(result.saved).toBe(2)
    })
  })

  describe('blocked templates', () => {
    it('blocks templates with no nodes (early return)', async () => {
      const emptyDetail: TemplateDetailResponse = {
        workflow: {
          id: 999,
          name: 'Empty Template',
          description: 'has no nodes',
          workflow: { nodes: [], connections: {} },
        },
      }
      mockFetch([
        { ok: true, body: makeSearchResponse([999]) },
        { ok: true, body: emptyDetail },
      ])

      const library = makeMockLibrary()
      const syncer = new TemplateSyncer(library, NOOP_LOGGER)
      const result = await syncer.sync({ maxTemplates: 10 })

      expect(result.saved).toBe(0)
      expect(library.saved).toHaveLength(0)
    })

    it('blocks templates containing blocked node types (code node)', async () => {
      mockFetch([
        { ok: true, body: makeSearchResponse([42]) },
        {
          ok: true,
          body: makeDetailResponse(42, [
            { id: 'n1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
            { id: 'n2', name: 'Code', type: 'n8n-nodes-base.code', typeVersion: 2, position: [200, 0], parameters: {} },
          ]),
        },
      ])

      const library = makeMockLibrary()
      const syncer = new TemplateSyncer(library, NOOP_LOGGER)
      const result = await syncer.sync({ maxTemplates: 10 })

      expect(result.blocked).toBe(1)
      expect(result.saved).toBe(0)
    })

    it('blocks templates containing executeCommand nodes', async () => {
      mockFetch([
        { ok: true, body: makeSearchResponse([43]) },
        {
          ok: true,
          body: makeDetailResponse(43, [
            { id: 'n1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
            { id: 'n2', name: 'Exec', type: 'n8n-nodes-base.executeCommand', typeVersion: 1, position: [200, 0], parameters: {} },
          ]),
        },
      ])

      const library = makeMockLibrary()
      const syncer = new TemplateSyncer(library, NOOP_LOGGER)
      const result = await syncer.sync({ maxTemplates: 10 })

      expect(result.blocked).toBe(1)
      expect(result.saved).toBe(0)
    })
  })

  describe('reviewed templates', () => {
    it('increments reviewed count for "review" trust level (httpRequest node)', async () => {
      // n8n-nodes-base.httpRequest is in REVIEW_NODE_TYPES
      mockFetch([
        { ok: true, body: makeSearchResponse([55]) },
        {
          ok: true,
          body: makeDetailResponse(55, [
            { id: 'n1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
            { id: 'n2', name: 'HTTP', type: 'n8n-nodes-base.httpRequest', typeVersion: 4, position: [200, 0], parameters: {} },
          ]),
        },
      ])

      const library = makeMockLibrary()
      const syncer = new TemplateSyncer(library, NOOP_LOGGER)
      const result = await syncer.sync({ maxTemplates: 10 })

      expect(result.reviewed).toBe(1)
      // "review" templates are still saved (not blocked)
      expect(result.saved).toBe(1)
    })
  })

  describe('progress callback', () => {
    it('calls onProgress after each template is processed', async () => {
      mockFetch([
        { ok: true, body: makeSearchResponse([1, 2, 3]) },
        { ok: true, body: makeDetailResponse(1) },
        { ok: true, body: makeDetailResponse(2) },
        { ok: true, body: makeDetailResponse(3) },
      ])

      const library = makeMockLibrary()
      const syncer = new TemplateSyncer(library, NOOP_LOGGER)
      const progressSnapshots: Array<{ processed: number; saved: number }> = []

      await syncer.sync({
        maxTemplates: 10,
        onProgress: (p) => progressSnapshots.push({ processed: p.processed, saved: p.saved }),
      })

      expect(progressSnapshots).toHaveLength(3)
      expect(progressSnapshots[0]!.processed).toBe(1)
      expect(progressSnapshots[1]!.processed).toBe(2)
      expect(progressSnapshots[2]!.processed).toBe(3)
      // saved count increases progressively
      expect(progressSnapshots[0]!.saved).toBe(1)
      expect(progressSnapshots[2]!.saved).toBe(3)
    })
  })

  describe('network error handling', () => {
    it('retries on 429 and succeeds after rate limit clears', async () => {
      mockFetch([
        { ok: false, status: 429, body: {}, headers: { 'Retry-After': '0' } }, // 429 on first search attempt
        { ok: true, status: 200, body: makeSearchResponse([101]) },              // retry succeeds
        { ok: true, status: 200, body: makeDetailResponse(101) },
      ])

      const library = makeMockLibrary()
      const syncer = new TemplateSyncer(library, NOOP_LOGGER)
      const result = await syncer.sync({ maxTemplates: 10 })

      expect(result.saved).toBe(1)
      expect(fetchMock).toHaveBeenCalledTimes(3) // 1 rate-limited + 1 retry search + 1 detail
    })

    it('handles search page returning non-ok response gracefully', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}), headers: { get: () => null } })

      const library = makeMockLibrary()
      const syncer = new TemplateSyncer(library, NOOP_LOGGER)
      const result = await syncer.sync({ maxTemplates: 10 })

      expect(result.saved).toBe(0)
      expect(result.processed).toBe(0)
    })

    it('handles individual template detail fetch failure without stopping sync', async () => {
      mockFetch([
        { ok: true, body: makeSearchResponse([1, 2]) },
        { ok: false, status: 500, body: {} }, // template 1 fails with 500 (not retryable)
        { ok: true, body: makeDetailResponse(2) },
      ])

      const library = makeMockLibrary()
      const syncer = new TemplateSyncer(library, NOOP_LOGGER)
      const result = await syncer.sync({ maxTemplates: 10 })

      // Template 1 failed fetch (ok: false) → processTemplate returns early
      // Template 2 succeeds
      expect(result.saved).toBe(1)
      expect(result.processed).toBe(2)
    })

    it('strips markdown from template description in saved metadata', async () => {
      mockFetch([
        { ok: true, body: makeSearchResponse([77]) },
        { ok: true, body: makeDetailResponse(77) },
      ])

      const library = makeMockLibrary()
      const syncer = new TemplateSyncer(library, NOOP_LOGGER)
      await syncer.sync({ maxTemplates: 10 })

      const savedMeta = library.saved[0]?.metadata
      expect(savedMeta?.description).toBeDefined()
      // makeDetailResponse uses **Bold** markdown — it should be stripped
      expect(savedMeta?.description).not.toContain('**')
      expect(savedMeta?.description).toContain('Bold')
    })
  })
})
