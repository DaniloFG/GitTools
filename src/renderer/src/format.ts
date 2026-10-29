import { cleanErrorText } from './feedback'
import { formatDateTime, formatRelative, t, type MessageKey } from './i18n'

export const shortSha = (sha: string) => sha.slice(0, 7)

export const relativeDate = (ms: number) => formatRelative(ms)

export const fullDate = (ms: number) => formatDateTime(ms)

/** Texto de um erro para o usuário: sem os prefixos do Electron e do IPC, com a mensagem completa. */
export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const text = cleanErrorText(raw)
  return text && text !== 'undefined' && text !== 'null' ? text : t('feedback.unknown')
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
