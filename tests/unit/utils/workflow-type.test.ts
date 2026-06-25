import { describe, it, expect } from 'vitest'
import { inferWorkflowType } from '../../../src/utils/workflow-type.js'

describe('inferWorkflowType', () => {
  it('identifies email workflows', () => {
    expect(inferWorkflowType('Send a Gmail notification when a form is submitted')).toBe('email')
    expect(inferWorkflowType('Read emails via IMAP and parse attachments')).toBe('email')
    expect(inferWorkflowType('Send daily digest via SMTP')).toBe('email')
  })

  it('identifies slack workflows', () => {
    expect(inferWorkflowType('Post a Slack message when a webhook fires')).toBe('slack')
    expect(inferWorkflowType('Send Slack notification to #alerts')).toBe('slack')
  })

  it('identifies schedule workflows', () => {
    expect(inferWorkflowType('Run every morning at 9am')).toBe('schedule')
    expect(inferWorkflowType('Daily report sent at noon')).toBe('schedule')
    expect(inferWorkflowType('Weekly summary cron job')).toBe('schedule')
    expect(inferWorkflowType('Send reminder every hour')).toBe('schedule')
  })

  it('identifies webhook workflows', () => {
    expect(inferWorkflowType('When a webhook receives a POST request')).toBe('webhook')
  })

  it('identifies data workflows', () => {
    expect(inferWorkflowType('Sync new Google Sheets rows to Notion')).toBe('data')
    expect(inferWorkflowType('Write rows to Airtable')).toBe('data')
  })

  it('identifies devops workflows', () => {
    expect(inferWorkflowType('Create a GitHub issue when a test fails')).toBe('devops')
  })

  it('identifies AI workflows', () => {
    expect(inferWorkflowType('Build an AI agent that summarizes documents')).toBe('ai')
    expect(inferWorkflowType('Run an LLM to classify support tickets')).toBe('ai')
    expect(inferWorkflowType('Summarize documents with AI')).toBe('ai')
  })

  it('identifies messaging workflows', () => {
    expect(inferWorkflowType('Send a Telegram message on new order')).toBe('messaging')
    expect(inferWorkflowType('Post to Discord on deployment')).toBe('messaging')
  })

  it('identifies database workflows', () => {
    expect(inferWorkflowType('Insert rows into a Postgres table')).toBe('database')
    expect(inferWorkflowType('Query MySQL for overdue invoices')).toBe('database')
    expect(inferWorkflowType('Store data in Supabase')).toBe('database')
  })

  it('identifies API workflows', () => {
    expect(inferWorkflowType('Make an HTTP request to the payments API')).toBe('api')
  })

  it('returns null for unrecognized descriptions', () => {
    expect(inferWorkflowType('Do something interesting')).toBeNull()
    expect(inferWorkflowType('Process the data')).toBeNull()
  })

  it('email takes priority over schedule when both keywords present', () => {
    // Gmail is listed before schedule in TYPE_KEYWORDS, so gmail wins
    const result = inferWorkflowType('Send daily Gmail report every morning')
    expect(result).toBe('email')
  })
})
