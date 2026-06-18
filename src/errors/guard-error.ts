import { KairosError } from './base.js'

export class GuardError extends KairosError {
  constructor(message: string) {
    super(message)
    this.name = 'GuardError'
  }
}
