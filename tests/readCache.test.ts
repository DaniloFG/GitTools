import { describe, expect, it } from 'vitest'
import { approxSize, classifyCall, Limiter, ReadCache } from '../src/renderer/src/readCache'

const SHA = 'a'.repeat(40)
const SHA2 = 'b'.repeat(40)

/** Chamada que conta quantas vezes foi de fato executada e só termina quando o teste manda. */
function fakeCall<T>(value: T) {
  let runs = 0
  const pending: (() => void)[] = []
  const run = () => {
    runs++
    return new Promise<T>((resolve) => pending.push(() => resolve(value)))
  }
  return { run, runs: () => runs, finish: () => pending.splice(0).forEach((f) => f()) }
}

const instant = <T>(value: T) => {
  let runs = 0
  return { run: () => (runs++, Promise.resolve(value)), runs: () => runs }
}

describe('classifyCall', () => {
  it('leituras pelo sha completo são imutáveis; por nome de ref, voláteis', () => {
    expect(classifyCall('commitDetails', [SHA])).toBe('immutable')
    expect(classifyCall('commitDetails', ['HEAD'])).toBe('volatile')
    expect(classifyCall('commitDetails', [SHA.slice(0, 7)])).toBe('volatile')
    expect(classifyCall('diff', [{ kind: 'commit', sha: SHA, path: 'a.txt' }])).toBe('immutable')
    expect(classifyCall('diff', [{ kind: 'commit', sha: 'HEAD' }])).toBe('volatile')
    expect(classifyCall('diff', [{ kind: 'range', from: SHA, to: SHA2 }])).toBe('immutable')
    expect(classifyCall('diff', [{ kind: 'range', from: SHA, to: 'main' }])).toBe('volatile')
    expect(classifyCall('diff', [{ kind: 'staged', path: 'a.txt' }])).toBe('volatile')
    expect(classifyCall('diff', [{ kind: 'unstaged' }])).toBe('volatile')
    expect(classifyCall('filesChangedBy', [[SHA, SHA2]])).toBe('immutable')
    expect(classifyCall('filesChangedBy', [[SHA, 'main']])).toBe('volatile')
    expect(classifyCall('blame', ['a.txt', SHA])).toBe('immutable')
    expect(classifyCall('blame', ['a.txt'])).toBe('volatile')
    expect(classifyCall('compare', [SHA, SHA2, true])).toBe('immutable')
    expect(classifyCall('compare', ['main', 'dev'])).toBe('volatile')
  })

  it('o que muda com o estado do repositório é volátil', () => {
    for (const method of ['status', 'branches', 'tags', 'refs', 'stashes', 'log', 'operationState', 'remotes', 'listFiles', 'fileHistory', 'analytics', 'branchCommits', 'rebasePlan', 'info']) {
      expect(classifyCall(method, []), method).toBe('volatile')
    }
  })

  it('arquivos da pasta de trabalho nunca são guardados', () => {
    expect(classifyCall('readFile', ['a.txt'])).toBe('none')
    expect(classifyCall('conflictDetails', ['a.txt'])).toBe('none')
  })

  it('qualquer outro método (inclusive um que ainda nem existe) é uma alteração', () => {
    for (const method of ['commit', 'checkout', 'stageFiles', 'writeFile', 'cherryPickFiles', 'addRemoteUrl', 'push', 'métodoNovo']) {
      expect(classifyCall(method, []), method).toBe('mutation')
    }
  })
})

describe('ReadCache', () => {
  it('a segunda leitura igual vem da memória, sem nova execução', async () => {
    const cache = new ReadCache()
    const call = instant({ branch: 'main' })
    const a = await cache.call('/r', 'status', [true], call.run)
    const b = await cache.call('/r', 'status', [true], call.run)
    expect(call.runs()).toBe(1)
    expect(b).toBe(a)
    expect(cache.stats).toMatchObject({ hits: 1, misses: 1 })
  })

  it('argumentos diferentes são leituras diferentes', async () => {
    const cache = new ReadCache()
    const call = instant(1)
    await cache.call('/r', 'status', [true], call.run)
    await cache.call('/r', 'status', [false], call.run)
    await cache.call('/r', 'status', [], call.run)
    expect(call.runs()).toBe(3)
  })

  it('chamadas iguais ao mesmo tempo compartilham uma execução só', async () => {
    const cache = new ReadCache()
    const call = fakeCall('x')
    const all = Promise.all([1, 2, 3, 4].map(() => cache.call('/r', 'log', [{ all: true }], call.run)))
    call.finish()
    expect(await all).toEqual(['x', 'x', 'x', 'x'])
    expect(call.runs()).toBe(1)
    expect(cache.stats.joined).toBe(3)
  })

  it('um repositório nunca recebe a resposta de outro', async () => {
    const cache = new ReadCache()
    const a = instant('A')
    const b = instant('B')
    expect(await cache.call('/a', 'status', [], a.run)).toBe('A')
    expect(await cache.call('/b', 'status', [], b.run)).toBe('B')
    expect(await cache.call('/a', 'status', [], a.run)).toBe('A')
    expect(a.runs()).toBe(1)
    expect(b.runs()).toBe(1)
  })

  it('invalidar um repositório só afeta as leituras voláteis dele', async () => {
    const cache = new ReadCache()
    const status = instant('s')
    const otherStatus = instant('o')
    const commit = instant('c')
    await cache.call('/a', 'status', [], status.run)
    await cache.call('/a', 'commitDetails', [SHA], commit.run)
    await cache.call('/b', 'status', [], otherStatus.run)
    cache.invalidate('/a')
    await cache.call('/a', 'status', [], status.run)
    await cache.call('/a', 'commitDetails', [SHA], commit.run)
    await cache.call('/b', 'status', [], otherStatus.run)
    expect(status.runs()).toBe(2)
    expect(commit.runs()).toBe(1)
    expect(otherStatus.runs()).toBe(1)
  })

  it('invalidateAll (foco da janela) afeta todos os repositórios, menos o imutável', async () => {
    const cache = new ReadCache()
    const volatile = instant(1)
    const immutable = instant(2)
    for (const root of ['/a', '/b']) {
      await cache.call(root, 'log', [], volatile.run)
      await cache.call(root, 'commitDetails', [SHA], immutable.run)
    }
    cache.invalidateAll()
    for (const root of ['/a', '/b']) {
      await cache.call(root, 'log', [], volatile.run)
      await cache.call(root, 'commitDetails', [SHA], immutable.run)
    }
    expect(volatile.runs()).toBe(4)
    expect(immutable.runs()).toBe(2)
  })

  it('a geração só cresce e muda para o repositório certo', () => {
    const cache = new ReadCache()
    const a0 = cache.generation('/a')
    const b0 = cache.generation('/b')
    cache.invalidate('/a')
    expect(cache.generation('/a')).toBeGreaterThan(a0)
    expect(cache.generation('/b')).toBe(b0)
    cache.invalidateAll()
    expect(cache.generation('/b')).toBeGreaterThan(b0)
  })

  it('uma alteração invalida antes e depois, e passa direto', async () => {
    const cache = new ReadCache()
    const status = instant('antes')
    await cache.call('/r', 'status', [], status.run)
    const generation = cache.generation('/r')
    const result = await cache.call('/r', 'commit', ['msg'], async () => {
      expect(cache.generation('/r')).toBeGreaterThan(generation)
      return 'ok'
    })
    expect(result).toBe('ok')
    await cache.call('/r', 'status', [], status.run)
    expect(status.runs()).toBe(2)
    // A alteração que falha também invalida (o repositório pode ter ficado pela metade).
    const afterOk = cache.generation('/r')
    await expect(cache.call('/r', 'commit', ['x'], () => Promise.reject(new Error('falhou')))).rejects.toThrow('falhou')
    expect(cache.generation('/r')).toBeGreaterThan(afterOk)
  })

  it('leitura que termina depois de uma alteração é entregue, mas não fica guardada', async () => {
    const cache = new ReadCache()
    const slow = fakeCall('velho')
    const reading = cache.call('/r', 'status', [], slow.run)
    // Enquanto a leitura corre, o usuário faz um commit.
    await cache.call('/r', 'commit', ['m'], async () => 'ok')
    slow.finish()
    expect(await reading).toBe('velho')
    const fresh = instant('novo')
    expect(await cache.call('/r', 'status', [], fresh.run)).toBe('novo')
    expect(fresh.runs()).toBe(1)
  })

  it('leitura iniciada durante uma alteração não é guardada', async () => {
    const cache = new ReadCache()
    let release: () => void = () => undefined
    const mutation = cache.call('/r', 'checkout', ['x'], () => new Promise<void>((resolve) => (release = resolve)))
    const during = instant('no meio')
    await cache.call('/r', 'status', [], during.run)
    await cache.call('/r', 'status', [], during.run)
    expect(during.runs()).toBe(2)
    release()
    await mutation
    const after = instant('depois')
    await cache.call('/r', 'status', [], after.run)
    await cache.call('/r', 'status', [], after.run)
    expect(after.runs()).toBe(1)
  })

  it('o imutável continua sendo guardado durante uma alteração', async () => {
    const cache = new ReadCache()
    let release: () => void = () => undefined
    const mutation = cache.call('/r', 'rebase', ['x', 'y'], () => new Promise<void>((resolve) => (release = resolve)))
    const details = instant('d')
    await cache.call('/r', 'commitDetails', [SHA], details.run)
    await cache.call('/r', 'commitDetails', [SHA], details.run)
    expect(details.runs()).toBe(1)
    release()
    await mutation
  })

  it('erro não é guardado: a próxima chamada tenta de novo', async () => {
    const cache = new ReadCache()
    let runs = 0
    const flaky = () => (++runs === 1 ? Promise.reject(new Error('git caiu')) : Promise.resolve('ok'))
    await expect(cache.call('/r', 'log', [], flaky)).rejects.toThrow('git caiu')
    expect(await cache.call('/r', 'log', [], flaky)).toBe('ok')
    expect(runs).toBe(2)
  })

  it('arquivos da pasta de trabalho sempre vão ao disco', async () => {
    const cache = new ReadCache()
    const read = instant('conteúdo')
    await cache.call('/r', 'readFile', ['a.txt'], read.run)
    await cache.call('/r', 'readFile', ['a.txt'], read.run)
    expect(read.runs()).toBe(2)
  })

  it('fechar o repositório esquece tudo dele, inclusive o imutável', async () => {
    const cache = new ReadCache()
    const call = instant(1)
    await cache.call('/a', 'commitDetails', [SHA], call.run)
    await cache.call('/b', 'commitDetails', [SHA], call.run)
    cache.drop('/a')
    await cache.call('/a', 'commitDetails', [SHA], call.run)
    await cache.call('/b', 'commitDetails', [SHA], call.run)
    expect(call.runs()).toBe(3)
  })

  it('respeita o limite de entradas, tirando as menos usadas', async () => {
    const cache = new ReadCache({ maxEntries: 3 })
    const call = instant('x')
    for (const n of [1, 2, 3]) await cache.call('/r', 'log', [n], call.run)
    await cache.call('/r', 'log', [1], call.run) // 1 foi usada agora: a mais antiga é a 2
    await cache.call('/r', 'log', [4], call.run)
    expect(cache.size.entries).toBe(3)
    const before = call.runs()
    await cache.call('/r', 'log', [1], call.run)
    await cache.call('/r', 'log', [3], call.run)
    await cache.call('/r', 'log', [4], call.run)
    expect(call.runs()).toBe(before) // 1, 3 e 4 continuam guardadas
    await cache.call('/r', 'log', [2], call.run)
    expect(call.runs()).toBe(before + 1) // 2 saiu
    expect(cache.stats.evicted).toBeGreaterThan(0)
  })

  it('respeita o limite de memória', async () => {
    const cache = new ReadCache({ maxBytes: 3000 })
    const big = () => Promise.resolve('x'.repeat(500)) // ~1 KB cada
    for (let n = 0; n < 10; n++) await cache.call('/r', 'log', [n], big)
    expect(cache.size.bytes).toBeLessThanOrEqual(3000)
    expect(cache.size.entries).toBeLessThan(10)
  })

  it('não tira da memória uma leitura que ainda está em andamento', async () => {
    const cache = new ReadCache({ maxEntries: 1 })
    const slow = fakeCall('lenta')
    const pending = cache.call('/r', 'log', ['lenta'], slow.run)
    await cache.call('/r', 'log', ['a'], () => Promise.resolve(1))
    await cache.call('/r', 'log', ['b'], () => Promise.resolve(2))
    slow.finish()
    expect(await pending).toBe('lenta')
  })
})

describe('approxSize', () => {
  it('cresce com o conteúdo e não percorre estruturas gigantes inteiras', () => {
    expect(approxSize('abc')).toBeLessThan(approxSize('abc'.repeat(100)))
    expect(approxSize([1, 2, 3])).toBeLessThan(approxSize(Array.from({ length: 100 }, (_, i) => ({ i, name: `n${i}` }))))

    // Conta quantos itens foram de fato lidos: deve parar perto do limite, sem depender do tempo da máquina.
    let read = 0
    const huge = Array.from({ length: 200_000 }, () => ({
      get v() {
        read++
        return 1
      }
    }))
    expect(approxSize(huge)).toBeGreaterThan(10_000)
    expect(read).toBeLessThan(5_000)
  })
})

describe('Limiter', () => {
  it('roda no máximo N tarefas ao mesmo tempo e todas terminam, em ordem de chegada', async () => {
    const limiter = new Limiter(2)
    let active = 0
    let peak = 0
    const order: number[] = []
    const task = (n: number) =>
      limiter.run(async () => {
        active++
        peak = Math.max(peak, active)
        order.push(n)
        await new Promise((r) => setTimeout(r, 5))
        active--
        return n
      })
    const results = await Promise.all([1, 2, 3, 4, 5, 6].map(task))
    expect(results).toEqual([1, 2, 3, 4, 5, 6])
    expect(peak).toBe(2)
    expect(order).toEqual([1, 2, 3, 4, 5, 6])
    expect(limiter.running).toBe(0)
    expect(limiter.queued).toBe(0)
  })

  it('uma tarefa que falha libera a vaga', async () => {
    const limiter = new Limiter(1)
    await expect(limiter.run(() => Promise.reject(new Error('x')))).rejects.toThrow('x')
    expect(await limiter.run(async () => 'ok')).toBe('ok')
  })
})
