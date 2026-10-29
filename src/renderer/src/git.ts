import type { RepoApi } from '../../shared/api'
import { t } from './i18n'
import { CallGate } from './workspace'

/**
 * Repositório da aba ativa. Definido ao montar a aba (`setActiveRoot`): cada chamada lê este valor no
 * instante em que é feita e vai para ele, sempre com `invokeOn`, então nunca cai no ativo do processo principal.
 */
let activeRoot: string | null = null

/** Chamadas em andamento e portão: a troca de aba segura as novas até as em andamento terminarem. */
export const gitCalls = new CallGate()

export function setActiveRoot(root: string | null): void {
  activeRoot = root
}

export function getActiveRoot(): string | null {
  return activeRoot
}

/** Proxy tipado: `git.status()` chama o método correspondente no repositório da aba ativa. */
export const git = new Proxy({} as RepoApi, {
  get: (_target, method: string) =>
    (...args: unknown[]) => {
      // O root é lido agora: uma chamada feita antes da troca termina no repositório em que foi pedida.
      const root = activeRoot
      if (root === null) return Promise.reject(new Error(t('main.noRepository')))
      const invoke = window.gittools.invokeOn as (r: string, m: string, ...a: unknown[]) => Promise<unknown>
      return gitCalls.enter(root).then((leave) => invoke(root, method, ...args).finally(leave))
    }
})
