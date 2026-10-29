// Regras puras do feedback ao usuário: limpeza do texto de erro, deduplicação das notificações,
// tempo de vida de cada tipo de aviso e o motivo de um commit não poder ser feito.
// Ficam fora dos componentes para serem testadas (tests/feedback.test.ts).

/** Tipo de aviso: sucesso, erro, atenção (algo não foi possível) ou informação. */
export type ToastKind = 'success' | 'error' | 'warning' | 'info'

/** Botão do aviso que faz algo (ex.: "Ir para <repo>" depois de aplicar commits em outro repositório). */
export interface ToastAction {
  label: string
  run(): void
}

/** Duas notificações iguais dentro desse intervalo viram uma só, com contador "×N". */
export const DEDUPE_WINDOW_MS = 2000

export interface Toast {
  id: number
  kind: ToastKind
  text: string
  /** Quantas vezes essa mensagem apareceu seguida dentro da janela de deduplicação. */
  count: number
  /** Último momento (ms) em que a mensagem foi disparada. */
  at: number
  action?: ToastAction
}

/**
 * Tira os prefixos que o Electron e o IPC acrescentam aos erros, mantendo o texto que veio do git.
 * Ex.: "Error invoking remote method 'git:push': Error: fatal: ..." vira "fatal: ...".
 */
export function cleanErrorText(raw: string): string {
  let text = raw.trim().replace(/^Error invoking remote method '[^']+': /, '')
  // O nome da classe do erro pode vir repetido ao atravessar o IPC ("Error: GitError: ...").
  for (let i = 0; i < 3; i++) {
    const next = text.replace(/^\w*Error: /, '')
    if (next === text) break
    text = next
  }
  return text.trim()
}

/** Erros do navegador que não interessam ao usuário (ruído do próprio layout). */
export function isIgnorableError(message: string): boolean {
  return /ResizeObserver loop/.test(message)
}

/**
 * Acrescenta uma notificação à lista. Se a mesma mensagem (mesmo tipo e texto) foi disparada há menos
 * de DEDUPE_WINDOW_MS, a notificação existente ganha +1 no contador em vez de ser duplicada.
 */
export function addToast(
  list: Toast[],
  input: { kind: ToastKind; text: string; action?: ToastAction },
  now: number,
  nextId: number
): Toast[] {
  for (let i = list.length - 1; i >= 0; i--) {
    const toast = list[i]
    // Um aviso com ação é sempre novo: a ação é de um momento específico (o commit aplicado, por exemplo).
    if (!input.action && !toast.action && toast.kind === input.kind && toast.text === input.text && now - toast.at <= DEDUPE_WINDOW_MS) {
      return list.map((item, j) => (j === i ? { ...item, count: item.count + 1, at: now } : item))
    }
  }
  return [...list, { id: nextId, kind: input.kind, text: input.text, count: 1, at: now, ...(input.action ? { action: input.action } : {}) }]
}

/** Quanto tempo a notificação fica na tela (ms). Erros não somem sozinhos: só quando o usuário fecha. */
export function dismissDelay(kind: ToastKind): number | null {
  if (kind === 'error') return null
  return kind === 'warning' ? 8000 : 5000
}

/** Por que o commit não pode ser feito agora (null = pode). */
export type CommitBlock = 'conflicts' | 'message' | 'nothing'

export function commitBlock(input: { message: string; staged: number; amend: boolean; stageAll: boolean; conflicted: number }): CommitBlock | null {
  if (input.conflicted > 0) return 'conflicts'
  if (!input.message.trim()) return 'message'
  if (input.staged === 0 && !input.amend && !input.stageAll) return 'nothing'
  return null
}
