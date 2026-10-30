import type { RepoApi } from '../../shared/api'
import { t } from './i18n'
import { Limiter, ReadCache } from './readCache'
import { CallGate } from './workspace'

/**
 * Repositório da aba ativa. Definido ao montar a aba (`setActiveRoot`): cada chamada lê este valor no
 * instante em que é feita e vai para ele, sempre com `invokeOn`, então nunca cai no ativo do processo principal.
 */
let activeRoot: string | null = null

/** Chamadas em andamento e portão: a troca de aba segura as novas até as em andamento terminarem. */
export const gitCalls = new CallGate()

/**
 * Leituras do git guardadas por repositório (ver readCache.ts). Toda chamada passa por aqui: leituras repetidas
 * saem da memória, e qualquer alteração invalida o repositório.
 */
export const readCache = new ReadCache()

/** Tarefas de segundo plano (resumo das abas, pré-carga ao passar o mouse): poucas ao mesmo tempo. */
export const backgroundCalls = new Limiter(2)

export function setActiveRoot(root: string | null): void {
  activeRoot = root
}

export function getActiveRoot(): string | null {
  return activeRoot
}

type Invoke = (root: string, method: string, ...args: unknown[]) => Promise<unknown>

/** Faz a chamada de verdade, contando-a no portão do repositório. */
function send(root: string, method: string, args: unknown[]): Promise<unknown> {
  const invoke = window.gittools.invokeOn as unknown as Invoke
  return gitCalls.enter(root).then((leave) => invoke(root, method, ...args).finally(leave))
}

/** Chama um método de um repositório aberto pelo cache. */
export function callOn(root: string, method: string, args: unknown[]): Promise<unknown> {
  return readCache.call(root, method, args, () => send(root, method, args))
}

/** Como `callOn`, mas na fila do segundo plano (não disputa processadores com o que o usuário está vendo). */
export function callInBackground(root: string, method: string, args: unknown[]): Promise<unknown> {
  return readCache.call(root, method, args, () => backgroundCalls.run(() => send(root, method, args)))
}

function proxyFor(root: () => string | null, call: (root: string, method: string, args: unknown[]) => Promise<unknown>): RepoApi {
  return new Proxy({} as RepoApi, {
    get:
      (_target, method: string) =>
      (...args: unknown[]) => {
        // O root é lido agora: uma chamada feita antes da troca termina no repositório em que foi pedida.
        const current = root()
        if (current === null) return Promise.reject(new Error(t('main.noRepository')))
        return call(current, method, args)
      }
  })
}

/** Proxy tipado: `git.status()` chama o método correspondente no repositório da aba ativa. */
export const git = proxyFor(() => activeRoot, callOn)

/**
 * Proxy preso a um repositório: funciona a qualquer momento, mesmo que a aba ativa já seja outra. É o que uma
 * leitura em andamento de uma aba que saiu deve usar, para não terminar o que faltava no repositório errado.
 */
export function gitFor(root: string): RepoApi {
  return proxyFor(() => root, callOn)
}

/** Como `gitFor`, mas as leituras entram na fila do segundo plano. */
export function gitInBackground(root: string): RepoApi {
  return proxyFor(() => root, callInBackground)
}

/** Algo mudou em `root` sem passar pelo proxy (comando digitado no terminal, cherry-pick entre repositórios…). */
export function markChanged(...roots: string[]): void {
  for (const root of roots) readCache.invalidate(root)
}
