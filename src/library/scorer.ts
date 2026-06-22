import type { StoredWorkflow } from './types.js'

const WEIGHTS = {
  tfidf: 0.35,
  nodeFingerprint: 0.30,
  outcome: 0.20,
  deploy: 0.15,
}

const NODE_KEYWORDS: Record<string, string[]> = {
  slack: ['slack', 'slackApi'],
  email: ['gmail', 'sendEmail', 'emailSend', 'emailReadImap'],
  webhook: ['webhook', 'webhookTrigger'],
  schedule: ['scheduleTrigger', 'cron'],
  http: ['httpRequest'],
  sheets: ['googleSheets'],
  github: ['github', 'githubTrigger'],
  telegram: ['telegram', 'telegramTrigger'],
  ai: ['agent', 'openAi', 'lmChatOpenAi', 'lmChatAnthropic', 'chainLlm', 'chainSummarization'],
  memory: ['memoryBufferWindow', 'memoryXata', 'memoryPostgres'],
  vector: ['vectorStoreInMemory', 'vectorStorePinecone', 'vectorStoreQdrant'],
  database: ['postgres', 'mySql', 'redis', 'mongoDb'],
  airtable: ['airtable'],
  notion: ['notion'],
  s3: ['awsS3'],
  code: ['code'],
  merge: ['merge'],
  switch: ['switch'],
  if: ['if'],
  wait: ['wait'],
  rss: ['rssFeedRead', 'rssFeedReadTrigger'],
  form: ['formTrigger'],
  set: ['set'],
  split: ['splitInBatches'],
  filter: ['filter'],
  telegram_trigger: ['telegramTrigger'],
  stripe: ['stripe'],
}

function extractQueryFingerprint(description: string): Set<string> {
  const lower = description.toLowerCase()
  const matches = new Set<string>()

  for (const [keyword, nodeTypes] of Object.entries(NODE_KEYWORDS)) {
    if (lower.includes(keyword)) {
      for (const nt of nodeTypes) matches.add(nt)
    }
  }

  if (/\bevery\b|\bdaily\b|\bhourly\b|\bweekly\b|\bmonthly\b|\bcron\b|\bschedule\b|\bat \d/.test(lower)) {
    matches.add('scheduleTrigger')
  }
  if (/\bwebhook\b|\breceive\b.*\bpost\b|\bpost\b.*\brequest\b/.test(lower)) {
    matches.add('webhook')
  }
  if (/\bchat\b|\bchatbot\b|\bconversation\b/.test(lower)) {
    matches.add('chatTrigger')
  }
  if (/\bai\b|\bllm\b|\bgpt\b|\bclaude\b|\bagent\b|\bsummariz/.test(lower)) {
    matches.add('agent')
  }

  return matches
}

function extractWorkflowFingerprint(w: StoredWorkflow): Set<string> {
  const fp = new Set<string>()
  for (const node of w.workflow.nodes) {
    const bare = node.type.split('.').pop() ?? ''
    fp.add(bare)
  }
  return fp
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  for (const item of a) {
    if (b.has(item)) intersection++
  }
  const union = a.size + b.size - intersection
  return union > 0 ? intersection / union : 0
}

function outcomeScore(w: StoredWorkflow): number {
  const stats = w.outcomeStats
  if (!stats || stats.totalUses === 0) return 0.5

  const passRate = stats.firstTryPasses / stats.totalUses
  const avgAttempts = stats.totalAttempts / stats.totalUses
  const attemptPenalty = Math.max(0, 1 - (avgAttempts - 1) * 0.3)

  return passRate * 0.6 + attemptPenalty * 0.4
}

function deployScore(w: StoredWorkflow): number {
  return 1 + Math.log(w.deployCount + 1) * 0.1
}

export interface ScoredEntry {
  workflow: StoredWorkflow
  score: number
  signals: {
    tfidf: number
    nodeFingerprint: number
    outcome: number
    deploy: number
  }
}

export function hybridScore(
  queryTokens: string[],
  queryDescription: string,
  workflows: StoredWorkflow[],
  docTokenArrays: string[][],
  idf: Map<string, number>,
): ScoredEntry[] {
  const queryFp = extractQueryFingerprint(queryDescription)
  const ceiling = queryTokens.reduce((sum, qt) => sum + (idf.get(qt) ?? 0), 0) || 1

  return workflows.map((w, i) => {
    const docTokens = docTokenArrays[i]!
    let tfidfRaw = 0
    const docFreq = new Map<string, number>()
    for (const t of docTokens) {
      docFreq.set(t, (docFreq.get(t) ?? 0) + 1)
    }
    for (const qt of queryTokens) {
      const tf = docTokens.length > 0 ? (docFreq.get(qt) ?? 0) / docTokens.length : 0
      const idfVal = idf.get(qt) ?? 0
      tfidfRaw += tf * idfVal
    }
    const tfidf = Math.min(tfidfRaw / ceiling, 1)

    const workflowFp = extractWorkflowFingerprint(w)
    const nodeFingerprint = queryFp.size > 0 ? jaccardSimilarity(queryFp, workflowFp) : 0

    const outcome = outcomeScore(w)
    const deploy = Math.min(deployScore(w), 1.5) / 1.5

    const score = Math.min(
      WEIGHTS.tfidf * tfidf +
      WEIGHTS.nodeFingerprint * nodeFingerprint +
      WEIGHTS.outcome * outcome +
      WEIGHTS.deploy * deploy,
      1,
    )

    return {
      workflow: w,
      score,
      signals: { tfidf, nodeFingerprint, outcome, deploy },
    }
  })
}
