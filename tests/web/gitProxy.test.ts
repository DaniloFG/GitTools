import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { git, gitCalls, gitFor, gitInBackground, markChanged, readCache, setActiveRoot, backgroundCalls } from '../../src/renderer/src/git'

const SHA = 'c'.repeat(40)

interface Call {
  root: string
  method: string
  args: unknown[]
}

let calls: Call[]
let responders: Record<string, (root: string, ...args: unknown[]) => unknown>

beforeEach(() => {
  calls = []
  responders = {}
  vi.stubGlobal('window', {
    gittools: {
      invokeOn: async (root: string, method: string, ...args: unknown[]) => {
        calls.push({ root, method, args })
        await Promise.resolve()
        const responder = responders[method]
        return responder ? responder(root, ...args) : `${method}@${root}`
      }
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  setActiveRoot(null)
  for (const root of ['/a', '/b']) readCache.drop(root)
})

describe('proxy do git com cache', () => {
  it('leituras repetidas não chamam o backend de novo', async () => {
    setActiveRoot('/a')
    await git.status(true)
    await git.status(true)
    await git.branches()
    await git.branches()
    expect(calls.map((c) => c.method)).toEqual(['status', 'branches'])
  })

  it('cada aba lê do seu repositório e nunca recebe o cache de outra', async () => {
    setActiveRoot('/a')
    expect(await git.status()).toBe('status@/a')
    setActiveRoot('/b')
    expect(await git.status()).toBe('status@/b')
    setActiveRoot('/a')
    expect(await git.status()).toBe('status@/a')
    expect(calls.filter((c) => c.method === 'status').map((c) => c.root)).toEqual(['/a', '/b'])
  })

  it('uma alteração feita pela interface invalida as leituras do repositório (e só dele)', async () => {
    setActiveRoot('/a')
    await git.status()
    setActiveRoot('/b')
    await git.status()
    setActiveRoot('/a')
    await git.commit('msg')
    await git.status()
    setActiveRoot('/b')
    await git.status()
    const statuses = calls.filter((c) => c.method === 'status').map((c) => c.root)
    expect(statuses).toEqual(['/a', '/b', '/a'])
  })

  it('a leitura imutável de um commit sobrevive a alterações', async () => {
    setActiveRoot('/a')
    await git.commitDetails(SHA)
    await git.checkout('main')
    await git.commitDetails(SHA)
    await git.commitDetails('HEAD')
    await git.checkout('main')
    await git.commitDetails('HEAD')
    expect(calls.filter((c) => c.method === 'commitDetails')).toHaveLength(3)
  })

  it('markChanged (terminal, cherry-pick entre repositórios) invalida o cache', async () => {
    setActiveRoot('/a')
    await git.log({ all: true })
    markChanged('/a')
    await git.log({ all: true })
    expect(calls.filter((c) => c.method === 'log')).toHaveLength(2)
  })

  it('arquivos da pasta de trabalho não são guardados', async () => {
    setActiveRoot('/a')
    await git.readFile('x.txt')
    await git.readFile('x.txt')
    expect(calls.filter((c) => c.method === 'readFile')).toHaveLength(2)
  })

  it('gitFor fica preso ao repositório mesmo depois de a aba ativa mudar', async () => {
    setActiveRoot('/a')
    const onA = gitFor('/a')
    setActiveRoot('/b')
    // Uma leitura em várias etapas de uma aba que já saiu: a etapa que falta ainda vai para o /a.
    await onA.status()
    await onA.refs()
    expect(calls.map((c) => c.root)).toEqual(['/a', '/a'])
    await git.status()
    expect(calls.at(-1)!.root).toBe('/b')
  })

  it('sem repositório ativo, a chamada falha em vez de ir para outro', async () => {
    setActiveRoot(null)
    await expect(git.status()).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })

  it('o portão conta as chamadas feitas (a troca de aba espera por elas), e as respondidas da memória não contam', async () => {
    setActiveRoot('/a')
    let release: () => void = () => undefined
    responders.log = () => new Promise<string>((resolve) => (release = () => resolve('log')))
    const pending = git.log()
    await vi.waitFor(() => expect(gitCalls.inFlight('/a')).toBe(1))
    // A mesma leitura pedida de novo entra na que está em andamento: continua sendo uma chamada só.
    const joined = git.log()
    await Promise.resolve()
    expect(gitCalls.inFlight('/a')).toBe(1)
    release()
    expect(await Promise.all([pending, joined])).toEqual(['log', 'log'])
    expect(gitCalls.inFlight('/a')).toBe(0)
    await git.log()
    expect(calls.filter((c) => c.method === 'log')).toHaveLength(1)
  })

  it('o segundo plano respeita o limite de chamadas ao mesmo tempo', async () => {
    let active = 0
    let peak = 0
    responders.status = async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return 'ok'
    }
    const roots = ['/r1', '/r2', '/r3', '/r4', '/r5', '/r6']
    await Promise.all(roots.map((root) => gitInBackground(root).status()))
    expect(peak).toBeLessThanOrEqual(2)
    expect(backgroundCalls.running).toBe(0)
    roots.forEach((r) => readCache.drop(r))
  })

  it('erros não ficam guardados', async () => {
    setActiveRoot('/a')
    let first = true
    responders.tags = () => {
      if (first) {
        first = false
        throw new Error('git falhou')
      }
      return ['v1']
    }
    await expect(git.tags()).rejects.toThrow('git falhou')
    expect(await git.tags()).toEqual(['v1'])
  })
})
