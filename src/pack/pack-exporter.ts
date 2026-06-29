import type { WorkflowPackResult } from './pack-builder.js'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  blocked: 'Blocked — resolve issues before activation',
  ready_for_test: 'Ready for Testing',
  ready_for_activation: 'Ready for Activation',
  active: 'Active',
  needs_attention: 'Needs Attention',
}

export function generateHandoff(pack: WorkflowPackResult): string {
  const lines: string[] = []
  const line = () => lines.push('')

  lines.push(`# ${pack.businessContext} — Workflow Pack`)
  line()
  lines.push(`**Status:** ${STATUS_LABELS[pack.status] ?? pack.status}`)
  lines.push(`**Generated:** ${new Date(pack.builtAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`)
  lines.push(`**Workflows:** ${pack.workflows.length} (${pack.workflows.filter(w => w.deployed).length} deployed)`)
  line()

  // Overview
  lines.push(`## Overview`)
  line()
  lines.push(
    `This workflow pack automates operations for **${pack.businessContext}**. ` +
    `It was built with Kairos and requires credential setup before workflows can be activated in n8n.`
  )
  line()

  // Blocking items (elevated to top if present)
  const blocking = pack.assumptions.filter(a => a.type === 'blocking')
  if (blocking.length > 0) {
    lines.push(`## Blocking Issues`)
    line()
    lines.push(`> These must be resolved before any workflows are activated.`)
    line()
    for (const a of blocking) {
      lines.push(`- [ ] ${a.text}`)
    }
    line()
  }

  // Workflows
  lines.push(`## Workflows`)
  line()
  for (const wf of pack.workflows) {
    const icon = wf.error ? '✗' : '✓'
    lines.push(`### ${icon} ${wf.name}`)
    line()
    lines.push(`**Purpose:** ${wf.purpose}`)
    if (wf.workflowId) lines.push(`**n8n ID:** \`${wf.workflowId}\``)
    if (!wf.deployed && !wf.error) lines.push(`**Status:** Not deployed (dry run)`)
    if (wf.error) lines.push(`**Error:** ${wf.error}`)
    line()
  }

  // Required credentials
  if (pack.allCredentials.length > 0) {
    lines.push(`## Required Credentials`)
    line()
    lines.push(`Connect these in n8n before activating workflows:`)
    line()
    for (const cred of pack.allCredentials) {
      lines.push(`- [ ] **${cred.service}** (${cred.credentialType})`)
    }
    line()
  }

  // Required Google Sheets
  if (pack.sheetsColumns.length > 0) {
    lines.push(`## Required Google Sheets`)
    line()
    for (const sheet of pack.sheetsColumns) {
      lines.push(`### ${sheet.sheet}`)
      line()
      lines.push(`Columns: ${sheet.columns.map(c => `\`${c}\``).join(', ')}`)
      line()
    }
  }

  // Needs confirmation
  const needsConfirmation = pack.assumptions.filter(a => a.type === 'needs_confirmation')
  if (needsConfirmation.length > 0) {
    lines.push(`## Needs Confirmation`)
    line()
    lines.push(`Verify these with the client before going live:`)
    line()
    for (const a of needsConfirmation) {
      lines.push(`- [ ] ${a.text}`)
    }
    line()
  }

  // Safe assumptions
  const safe = pack.assumptions.filter(a => a.type === 'safe')
  if (safe.length > 0) {
    lines.push(`## Safe Assumptions`)
    line()
    lines.push(`These defaults were used during generation — no action needed:`)
    line()
    for (const a of safe) {
      lines.push(`- ${a.text}`)
    }
    line()
  }

  // Setup checklist
  lines.push(`## Setup Checklist`)
  line()
  lines.push(`Complete before testing:`)
  line()
  for (const cred of pack.allCredentials) {
    lines.push(`- [ ] Connect **${cred.service}** credential in n8n Settings → Credentials`)
  }
  for (const sheet of pack.sheetsColumns) {
    lines.push(`- [ ] Create Google Sheet: "${sheet.sheet}" with columns: ${sheet.columns.join(', ')}`)
  }
  for (const a of blocking) {
    lines.push(`- [ ] Resolve: ${a.text}`)
  }
  for (const a of needsConfirmation) {
    lines.push(`- [ ] Confirm: ${a.text}`)
  }
  line()

  // Testing checklist
  if (pack.testChecklist.length > 0) {
    lines.push(`## Testing Checklist`)
    line()
    for (const item of pack.testChecklist) {
      lines.push(`### ${item.workflow}`)
      line()
      for (const step of item.steps) {
        lines.push(`- [ ] ${step}`)
      }
      line()
    }
  }

  // Activation checklist
  const deployedWorkflows = pack.workflows.filter(w => w.deployed && !w.error)
  if (deployedWorkflows.length > 0) {
    lines.push(`## Activation Checklist`)
    line()
    lines.push(`Activate in n8n after testing is complete:`)
    line()
    for (const wf of deployedWorkflows) {
      const idSuffix = wf.workflowId ? ` (n8n ID: \`${wf.workflowId}\`)` : ''
      lines.push(`- [ ] Activate: **${wf.name}**${idSuffix}`)
    }
    line()
  }

  // Maintenance notes
  lines.push(`## Maintenance Notes`)
  line()
  lines.push(`- Monitor n8n executions weekly — check the Executions tab for failures`)
  lines.push(`- Re-run \`kairos build-pack\` to regenerate workflows if business needs change`)
  lines.push(`- Update Google Sheets data as business information changes`)
  lines.push(`- Rotate API credentials before expiration (n8n Settings → Credentials)`)
  lines.push(`- Run \`kairos validate-pack <name>\` before activating after any changes`)

  return lines.join('\n')
}
