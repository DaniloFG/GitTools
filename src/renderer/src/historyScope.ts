// O que o histórico lista: tudo, só a branch atual, uma branch ou as branches marcadas na barra lateral
// (sem React nem DOM, para poder ser testado à parte).

import type { LogOptions } from '../../shared/api'

export type HistoryScope =
  | { kind: 'all' }
  | { kind: 'head' }
  | { kind: 'ref'; ref: string }
  /** Branches marcadas com a caixa de seleção da barra lateral: só a história delas aparece. */
  | { kind: 'refs'; refs: string[] }

export const ALL_SCOPE: HistoryScope = { kind: 'all' }

/** Branches marcadas no escopo (uma branch escolhida pelo nome conta como marcada). */
export function checkedRefs(scope: HistoryScope): string[] {
  return scope.kind === 'ref' ? [scope.ref] : scope.kind === 'refs' ? scope.refs : []
}

/** Escopo que lista exatamente estas branches (nenhuma = todas). */
export function scopeOfRefs(refs: string[]): HistoryScope {
  const unique = [...new Set(refs)]
  return unique.length === 0 ? ALL_SCOPE : unique.length === 1 ? { kind: 'ref', ref: unique[0] } : { kind: 'refs', refs: unique }
}

/** Marca ou desmarca uma branch; ao desmarcar a última, o histórico volta a listar tudo. */
export function toggleRef(scope: HistoryScope, name: string): HistoryScope {
  const current = checkedRefs(scope)
  return scopeOfRefs(current.includes(name) ? current.filter((r) => r !== name) : [...current, name])
}

/** Marca um grupo de branches de uma vez (ou desmarca todas, se já estavam todas marcadas). */
export function toggleGroup(scope: HistoryScope, names: string[]): HistoryScope {
  const current = checkedRefs(scope)
  const all = names.length > 0 && names.every((n) => current.includes(n))
  return scopeOfRefs(all ? current.filter((r) => !names.includes(r)) : [...current, ...names])
}

/** Texto que identifica o escopo (para saber se o histórico em memória ainda vale). */
export function scopeKey(scope: HistoryScope): string {
  return scope.kind === 'ref' ? `ref:${scope.ref}` : scope.kind === 'refs' ? `refs:${scope.refs.join('\n')}` : scope.kind
}

/** Opções do `git log` para o escopo. */
export function scopeLogOptions(scope: HistoryScope): LogOptions {
  return scope.kind === 'all' ? { all: true } : scope.kind === 'head' ? {} : scope.kind === 'ref' ? { ref: scope.ref } : { refs: scope.refs }
}

/** A linha das alterações ainda não commitadas é do HEAD: só aparece se o HEAD está no que é listado. */
export function showsWorkingChanges(scope: HistoryScope, head: string | null): boolean {
  return scope.kind === 'ref' ? scope.ref === head : scope.kind === 'refs' ? head !== null && scope.refs.includes(head) : true
}
