/**
 * Phase 5 smoke test — runs against a live n8n instance.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... N8N_API_KEY=... N8N_BASE_URL=https://your-instance.app.n8n.cloud \
 *     npx tsx scripts/smoke-test.ts
 *
 * Set DRY_RUN=false to actually deploy workflows (default: dry run only)
 */

import { Kairos } from '../src/index.js'

const ANTHROPIC_API_KEY = process.env['ANTHROPIC_API_KEY']
const N8N_API_KEY = process.env['N8N_API_KEY']
const N8N_BASE_URL = process.env['N8N_BASE_URL'] ?? 'https://your-instance.app.n8n.cloud'
const DRY_RUN = process.env['DRY_RUN'] !== 'false'

if (!ANTHROPIC_API_KEY) {
  console.error('❌  Missing ANTHROPIC_API_KEY env var')
  process.exit(1)
}
if (!N8N_API_KEY) {
  console.error('❌  Missing N8N_API_KEY env var')
  process.exit(1)
}

const kairos = new Kairos({
  anthropicApiKey: ANTHROPIC_API_KEY,
  n8nBaseUrl: N8N_BASE_URL,
  n8nApiKey: N8N_API_KEY,
  logger: {
    debug: (msg, meta) => console.log(`  [debug] ${msg}`, meta ?? ''),
    info: (msg, meta) => console.log(`  [info]  ${msg}`, meta ?? ''),
    warn: (msg, meta) => console.warn(`  [warn]  ${msg}`, meta ?? ''),
    error: (msg, meta) => console.error(`  [error] ${msg}`, meta ?? ''),
  },
})

const TEST_CASES = [
  {
    label: 'Schedule + Slack alert',
    description: 'Every morning at 9am, send a message to a Slack channel called #daily-digest saying "Good morning team!"',
  },
  {
    label: 'Webhook → HTTP → Set',
    description: 'Receive a webhook POST request, call the URL https://httpbin.org/json with a GET request, then set a field called "processed" to true and return the result',
  },
  {
    label: 'AI agent with memory',
    description: 'A chat-triggered AI agent using the OpenAI GPT-4o model with window buffer memory that answers questions about workflow automation',
  },
]

async function runTest(label: string, description: string, index: number): Promise<void> {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`TEST ${index + 1}: ${label}`)
  console.log(`${'─'.repeat(60)}`)
  console.log(`Description: "${description}"`)
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no deployment)' : 'LIVE DEPLOY'}`)
  console.log()

  const start = Date.now()

  try {
    const result = await kairos.build(description, { dryRun: DRY_RUN })

    const elapsed = Date.now() - start
    console.log(`✅  SUCCESS (${elapsed}ms)`)
    console.log(`    workflowId:        ${result.workflowId ?? '(dry run)'}`)
    console.log(`    name:              ${result.name}`)
    console.log(`    generationAttempts: ${result.generationAttempts}`)
    console.log(`    activationRequired: ${result.activationRequired}`)
    console.log(`    dryRun:            ${result.dryRun}`)

    if (result.credentialsNeeded.length > 0) {
      console.log(`    credentialsNeeded:`)
      for (const cred of result.credentialsNeeded) {
        console.log(`      - ${cred.service} (${cred.credentialType}): ${cred.description}`)
      }
    } else {
      console.log(`    credentialsNeeded: none reported`)
    }
  } catch (err) {
    const elapsed = Date.now() - start
    console.error(`❌  FAILED (${elapsed}ms)`)
    if (err instanceof Error) {
      console.error(`    ${err.name}: ${err.message}`)
      if ('cause' in err && err.cause instanceof Error) {
        console.error(`    cause: ${err.cause.name}: ${err.cause.message}`)
      } else if ('cause' in err && err.cause !== undefined) {
        console.error(`    cause:`, err.cause)
      }
      if ('issues' in err) {
        const issues = (err as { issues: Array<{ rule: number; message: string }> }).issues
        for (const issue of issues) {
          console.error(`    [Rule ${issue.rule}] ${issue.message}`)
        }
      }
    } else {
      console.error(err)
    }
  }
}

async function checkConnection(): Promise<void> {
  console.log('Checking n8n connection...')
  try {
    const workflows = await kairos.list()
    console.log(`✅  Connected to n8n — ${workflows.length} workflow(s) found`)
  } catch (err) {
    console.error('❌  Cannot connect to n8n:')
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

async function main(): Promise<void> {
  console.log('Kairos SDK — Phase 5 Smoke Test')
  console.log(`n8n instance: ${N8N_BASE_URL}`)
  console.log()

  await checkConnection()

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i]!
    await runTest(tc.label, tc.description, i)
  }

  console.log(`\n${'═'.repeat(60)}`)
  console.log('Smoke test complete.')
  if (DRY_RUN) {
    console.log('All tests ran in dry-run mode. Set DRY_RUN=false to deploy.')
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
