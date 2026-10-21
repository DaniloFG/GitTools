import type { RepoApi } from '../../shared/api'

/** Proxy tipado: `git.status()` chama o método correspondente no processo principal. */
export const git = new Proxy({} as RepoApi, {
  get: (_target, method: string) =>
    (...args: unknown[]) =>
      (window.gittools.invoke as (m: string, ...a: unknown[]) => Promise<unknown>)(method, ...args)
})
