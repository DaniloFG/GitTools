import { afterEach, describe, expect, it } from 'vitest'
import {
  GitError,
  MAX_GIT_PROCESSES,
  gitQueueStatsForTest,
  onGitCommand,
  resetGitQueuePeakForTest,
  runGit
} from '../src/core/exec'
import { createRepo } from './helpers'

// Comando git que dura `ms` e não faz nada. É um alias com o próprio Node, então o tempo é controlado
// e não depende de `sleep` (que não existe no Windows). O `teste.id` identifica o pedido no log.
function espera(id: string, ms: number): string[] {
  return ['-c', `alias.espera=!"${process.execPath}" -e "setTimeout(() => {}, ${ms})"`, '-c', `teste.id=${id}`, 'espera']
}

/** Ids dos pedidos na ordem em que o processo de cada um começou (o log anuncia o início). */
function startOrder(): { ids: () => string[]; stop: () => void } {
  const ids: string[] = []
  const stop = onGitCommand((entry) => {
    if (entry.exitCode !== undefined) return
    const id = entry.args.find((a) => a.startsWith('teste.id='))
    if (id) ids.push(id.slice('teste.id='.length))
  })
  return { ids: () => ids, stop }
}

const stops: Array<() => void> = []
afterEach(() => {
  stops.splice(0).forEach((stop) => stop())
})

describe('fila de processos git', () => {
  it('nunca passa de MAX_GIT_PROCESSES processos ao mesmo tempo, e o pico chega ao limite', async () => {
    const t = await createRepo()
    await t.commit('primeiro', { 'a.txt': 'a\n' })
    resetGitQueuePeakForTest()
    const results = await Promise.all(Array.from({ length: 20 }, () => runGit(t.dir, ['rev-parse', 'HEAD'])))
    expect(results.every((r) => /^[0-9a-f]{40}$/.test(r.stdout.trim()))).toBe(true)
    const stats = gitQueueStatsForTest()
    expect(stats.peak).toBe(MAX_GIT_PROCESSES)
    expect(stats.running).toBe(0)
    expect(stats.queued).toBe(0)
  })

  it('prioridade alta que chega depois de vários baixos começa antes deles; dentro da mesma prioridade, por ordem de chegada', async () => {
    const t = await createRepo()
    await t.commit('primeiro', { 'a.txt': 'a\n' })
    const order = startOrder()
    stops.push(order.stop)
    const bloqueio = Array.from({ length: MAX_GIT_PROCESSES }, (_, i) => runGit(t.dir, espera(`bloqueio-${i}`, 300)))
    const baixos = [1, 2, 3].map((n) => runGit(t.dir, espera(`baixa-${n}`, 10), { priority: 'low' }))
    const alta = runGit(t.dir, espera('alta', 10), { priority: 'high' })
    await Promise.all([...bloqueio, ...baixos, alta])
    const depois = order.ids().filter((id) => !id.startsWith('bloqueio-'))
    expect(depois).toEqual(['alta', 'baixa-1', 'baixa-2', 'baixa-3'])
  })

  it('comando de rede (ls-remote) não espera vaga: começa na hora, mesmo com todas as vagas ocupadas', async () => {
    const t = await createRepo()
    await t.commit('primeiro', { 'a.txt': 'a\n' })
    // Sem relógio: no Windows carregado, abrir um processo git leva centenas de ms, então o tempo não prova nada.
    // Por isso comparamos a ordem de início e de fim dos processos.
    const eventos: Array<{ fase: 'inicio' | 'fim'; id: string }> = []
    const stop = onGitCommand((entry) => {
      const id = entry.args.includes('ls-remote')
        ? 'ls-remote'
        : entry.args.find((a) => a.startsWith('teste.id='))?.slice('teste.id='.length)
      if (id === undefined) return
      eventos.push({ fase: entry.exitCode === undefined ? 'inicio' : 'fim', id })
    })
    stops.push(stop)
    const bloqueio = Array.from({ length: MAX_GIT_PROCESSES }, (_, i) => runGit(t.dir, espera(`bloqueio-${i}`, 600)))
    const pending = runGit(t.dir, ['ls-remote', '.'])
    // Se o ls-remote estivesse na fila, ela teria um pedido esperando agora.
    expect(gitQueueStatsForTest().queued, 'o ls-remote entrou na fila e esperou vaga').toBe(0)
    const result = await pending
    expect(result.stdout).toContain('refs/heads/main')
    await Promise.all(bloqueio)
    const inicioLsRemote = eventos.findIndex((e) => e.fase === 'inicio' && e.id === 'ls-remote')
    const primeiroFimBloqueio = eventos.findIndex((e) => e.fase === 'fim' && e.id.startsWith('bloqueio-'))
    expect(inicioLsRemote, `o ls-remote não aparece no log de início (eventos: ${JSON.stringify(eventos)})`).toBeGreaterThanOrEqual(0)
    expect(
      inicioLsRemote < primeiroFimBloqueio,
      `o ls-remote começou depois do primeiro fim de um bloqueio: ele esperou vaga (eventos: ${JSON.stringify(eventos)})`
    ).toBe(true)
  })

  it('sinal já abortado rejeita na hora, sem abrir processo', async () => {
    const t = await createRepo()
    await t.commit('primeiro', { 'a.txt': 'a\n' })
    const order = startOrder()
    stops.push(order.stop)
    const controller = new AbortController()
    controller.abort()
    const error = await runGit(t.dir, espera('cancelado', 10), { signal: controller.signal }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GitError)
    expect((error as GitError).aborted).toBe(true)
    expect(order.ids()).toEqual([])
  })

  it('abortar durante a execução encerra o git e rejeita com aborted, sem esperar o processo terminar', async () => {
    const t = await createRepo()
    await t.commit('primeiro', { 'a.txt': 'a\n' })
    const controller = new AbortController()
    const started = Date.now()
    const pending = runGit(t.dir, espera('longo', 2000), { signal: controller.signal }).catch((e: unknown) => e)
    setTimeout(() => controller.abort(), 100)
    const error = await pending
    expect(error).toBeInstanceOf(GitError)
    expect((error as GitError).aborted).toBe(true)
    // O alias dura 2 s: rejeitar antes de 1,5 s prova que o git foi encerrado.
    expect(Date.now() - started).toBeLessThan(1500)
    expect(gitQueueStatsForTest().running).toBe(0)
    // O processo filho do alias (não o git) continua vivo até os 2 s e, no Windows, segura a pasta temporária:
    // esperar aqui evita que a limpeza em tests/helpers.ts falhe com EBUSY.
    await new Promise((r) => setTimeout(r, Math.max(0, started + 2000 + 500 - Date.now())))
  })

  it('abortar enquanto espera na fila tira o pedido da fila, sem abrir processo', async () => {
    const t = await createRepo()
    await t.commit('primeiro', { 'a.txt': 'a\n' })
    const order = startOrder()
    stops.push(order.stop)
    const bloqueio = Array.from({ length: MAX_GIT_PROCESSES }, (_, i) => runGit(t.dir, espera(`bloqueio-${i}`, 400)))
    const controller = new AbortController()
    const pending = runGit(t.dir, espera('na-fila', 10), { signal: controller.signal }).catch((e: unknown) => e)
    expect(gitQueueStatsForTest().queued).toBe(1)
    controller.abort()
    const error = await pending
    expect((error as GitError).aborted).toBe(true)
    expect(gitQueueStatsForTest().queued).toBe(0)
    await Promise.all(bloqueio)
    expect(order.ids()).not.toContain('na-fila')
  })

  it('comando longo demais é recusado sem esperar vaga', async () => {
    const t = await createRepo()
    await t.commit('primeiro', { 'a.txt': 'a\n' })
    const bloqueio = Array.from({ length: MAX_GIT_PROCESSES }, (_, i) => runGit(t.dir, espera(`bloqueio-${i}`, 600)))
    const huge = Array.from({ length: 40 }, (_, i) => `${i}-${'x'.repeat(1000)}`)
    const started = Date.now()
    await expect(runGit(t.dir, ['status', '--', ...huge])).rejects.toThrow('grande demais')
    // Se ocupasse a fila, esperaria os 600 ms dos bloqueios.
    expect(Date.now() - started).toBeLessThan(400)
    expect(gitQueueStatsForTest().queued).toBe(0)
    await Promise.all(bloqueio)
  })

  it('a vaga volta depois de erros: o git inválido não deixa a fila travada', async () => {
    const t = await createRepo()
    await t.commit('primeiro', { 'a.txt': 'a\n' })
    for (let n = 0; n < MAX_GIT_PROCESSES + 1; n++) {
      await expect(runGit(t.dir, ['comando-que-nao-existe'])).rejects.toBeInstanceOf(GitError)
    }
    expect(gitQueueStatsForTest().running).toBe(0)
    // Se alguma vaga tivesse vazado, este lote travaria e o teste estouraria o tempo limite.
    const batch = await Promise.all(Array.from({ length: MAX_GIT_PROCESSES * 2 }, () => runGit(t.dir, ['rev-parse', 'HEAD'])))
    expect(batch).toHaveLength(MAX_GIT_PROCESSES * 2)
    expect(gitQueueStatsForTest().running).toBe(0)
  })
})

describe('stopAtLimit', () => {
  it('para o git ao passar do teto: resolve com truncated e o git não termina a saída', async () => {
    const t = await createRepo()
    const blob = (await runGit(t.dir, ['hash-object', '-w', '--stdin'], { input: 'x'.repeat(5 * 1024 * 1024) })).stdout.trim()
    const cap = 64 * 1024

    const limited = await runGit(t.dir, ['cat-file', '-p', blob], { maxOutputBytes: cap, stopAtLimit: true })
    expect(limited.truncated).toBe(true)
    expect(limited.stdout.length).toBe(cap)
    // Parado pelo teto: nem código 0 nem erro. O sinal deixa o código em -1.
    expect(limited.exitCode).toBe(-1)

    // Controle: sem stopAtLimit o git gera a saída inteira (código 0) e só o excedente é descartado.
    const full = await runGit(t.dir, ['cat-file', '-p', blob], { maxOutputBytes: cap })
    expect(full.truncated).toBe(true)
    expect(full.exitCode).toBe(0)
    expect(full.stdout.length).toBe(cap)
  })
})
