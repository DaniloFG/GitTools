import { formatDateTime, formatRelative, t, type MessageKey } from './i18n'

export const shortSha = (sha: string) => sha.slice(0, 7)

export const relativeDate = (ms: number) => formatRelative(ms)

export const fullDate = (ms: number) => formatDateTime(ms)

/** Remove o prefixo que o Electron adiciona a erros vindos do processo principal. */
export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+': /, '').replace(/^\w*Error: /, '')
}

const STATUS_KEYS: Record<string, MessageKey> = {
  M: 'status.modified',
  A: 'status.added',
  D: 'status.deleted',
  R: 'status.renamed',
  C: 'status.copied',
  T: 'status.typeChanged',
  U: 'status.conflicted',
  '?': 'status.untracked'
}

export const statusLabel = (code: string) => (STATUS_KEYS[code] ? t(STATUS_KEYS[code]) : code)
