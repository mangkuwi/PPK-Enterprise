export type NumberingCode =
  | 'FORBIDDEN' | 'LOGIN_REQUIRED' | 'NOT_FOUND' | 'INVALID' | 'NEEDS_START_CONFIRMATION' | 'NEEDS_CONFIRMATION' | 'COLLISION'
  | 'LIMIT' | 'STATE' | 'NUMBER_REQUIRED' | 'DATE_MISMATCH' | 'LINKED';

export class NumberingError extends Error {
  constructor(public code: NumberingCode, message: string) { super(message); this.name = 'NumberingError'; }
}
