import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GitError,
  MAX_GIT_PROCESSES,
  gitQueueStatsForTest,
  onGitCommand,
  resetGitQueuePeakForTest,
  runGit,
  treeKillsForTest
} from '../src/core/exec'
import { readFile } from 'node:fs/promises'
import { createRepo, errorCode, removeDir, waitForExit } from './helpers'

// Comando git que dura `ms` e não faz nada. É um alias com o próprio Node, então o tempo é controlado
// e não depende de `sleep` (que não existe no Windows). O `teste.id` identifica o pedido no log.
// Com `pidFile` (nome relativo à raiz do repositório, diretório atual do alias), o node grava o próprio PID antes de
// esperar: o teste usa isso para saber quando esse processo neto saiu. Aspas simples dentro do `-e`, porque o alias
// roda em sh com o script entre aspas duplas.
function espera(id: string, ms: number, pidFile?: string): string[] {
  // O nome entra cru num `-e` dentro de aspas do sh: só caracteres inofensivos, senão seria injeção de comando.
  if (pidFile !== undefined && !/^[\w.-]+$/.test(pidFile)) throw new Error(`nome de arquivo de pid inválido: ${pidFile}`)
  const gravaPid = pidFile ? `require('fs').writeFileSync('${pidFile}', String(process.pid)); ` : ''
  return [
    '-c',
    `alias.espera=!"${process.execPath}" -e "${gravaPid}setTimeout(() => {}, ${ms})"`,
    '-c',
    `teste.id=${id}`,
    'espera'
  ]
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
    const pending = runGit(t.dir, espera('longo', 2000, 'espera.pid'), { signal: controller.signal }).catch((e: unknown) => e)
    setTimeout(() => controller.abort(), 100)
    const error = await pending
    expect(error).toBeInstanceOf(GitError)
    expect((error as GitError).aborted).toBe(true)
    // O alias dura 2 s: rejeitar antes de 1,5 s prova que o git foi encerrado.
    expect(Date.now() - started).toBeLessThan(1500)
    expect(gitQueueStatsForTest().running).toBe(0)
    // O processo neto do alias (o node, não o git) continua vivo até os 2 s e, no Windows, segura a pasta temporária.
    // Esperar o PID dele sair (e não um tempo fixo, que não basta quando o node demora a subir) evita que a limpeza
    // em tests/helpers.ts falhe com EBUSY.
    await waitForExit(join(t.dir, 'espera.pid'))
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

/** Espera `ready()` virar verdadeiro, com poll curto e teto; devolve se virou. Sem relógio fixo para a asserção. */
async function poll(ready: () => Promise<boolean> | boolean, tetoMs: number): Promise<boolean> {
  const limite = Date.now() + tetoMs
  for (;;) {
    if (await ready()) return true
    if (Date.now() >= limite) return false
    await new Promise((r) => setTimeout(r, 25))
  }
}

function processoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    // ESRCH: o processo não existe mais.
    return false
  }
}

describe('abort encerra a árvore', () => {
  it('o processo neto (alias com !) morre junto com o git quando o pedido é abortado', async () => {
    const t = await createRepo()
    await t.commit('primeiro', { 'a.txt': 'a\n' })
    const alias = `alias.neto=!"${process.execPath}" -e "require('fs').writeFileSync('neto.pid', String(process.pid)); setTimeout(() => {}, 10000)"`
    const controller = new AbortController()
    const pending = runGit(t.dir, ['-c', alias, 'neto'], { signal: controller.signal }).catch((e: unknown) => e)
    let pid = 0
    try {
      const gravado = await poll(async () => {
        try {
          pid = Number((await readFile(join(t.dir, 'neto.pid'), 'utf8')).trim())
          return Number.isInteger(pid) && pid > 0
        } catch {
          return false
        }
      }, 5000)
      expect(gravado, 'o neto não gravou o pid a tempo').toBe(true)
      expect(processoVivo(pid)).toBe(true)
      controller.abort()
      const error = await pending
      expect(error).toBeInstanceOf(GitError)
      expect((error as GitError).aborted).toBe(true)
      const saiu = await poll(() => !processoVivo(pid), 3000)
      expect(saiu, `o neto (pid ${pid}) continua vivo depois do abort`).toBe(true)
    } finally {
      // Se a asserção falhou, não deixa o neto segurando a pasta temporária.
      if (pid > 0 && processoVivo(pid)) process.kill(pid, 'SIGKILL')
      controller.abort()
      await pending
    }
  })

  it('só o abort durante a execução encerra a árvore: o caminho normal não abre nem pede nada a mais', async () => {
    const t = await createRepo()
    await t.commit('primeiro', { 'a.txt': 'a\n' })
    const antes = treeKillsForTest()

    await runGit(t.dir, ['rev-parse', 'HEAD'])
    await expect(runGit(t.dir, ['comando-que-nao-existe'])).rejects.toBeInstanceOf(GitError)
    const inicioLento = Date.now()
    await expect(runGit(t.dir, espera('lento', 800), { timeoutMs: 100 })).rejects.toBeInstanceOf(GitError)
    expect(treeKillsForTest(), 'sucesso, falha e tempo limite não encerram a árvore').toBe(antes)

    // Sinal já abortado: rejeita sem abrir processo.
    const jaAbortado = new AbortController()
    jaAbortado.abort()
    await expect(runGit(t.dir, espera('x', 10), { signal: jaAbortado.signal })).rejects.toMatchObject({ aborted: true })
    expect(treeKillsForTest(), 'sinal já abortado não abre processo').toBe(antes)

    // Abort na fila: sai da fila sem processo.
    const bloqueio = Array.from({ length: MAX_GIT_PROCESSES }, (_, i) => runGit(t.dir, espera(`bloqueio-${i}`, 300)))
    const naFila = new AbortController()
    const naFilaPending = runGit(t.dir, espera('na-fila', 10), { signal: naFila.signal }).catch((e: unknown) => e)
    naFila.abort()
    expect(((await naFilaPending) as GitError).aborted).toBe(true)
    await Promise.all(bloqueio)
    expect(treeKillsForTest(), 'abort na fila não abre processo').toBe(antes)

    // Abort durante a execução: uma única vez, mesmo com o sinal disparando e o git saindo em seguida.
    const controller = new AbortController()
    const pending = runGit(t.dir, espera('abortado', 3000), { signal: controller.signal }).catch((e: unknown) => e)
    setTimeout(() => controller.abort(), 100)
    expect(((await pending) as GitError).aborted).toBe(true)
    expect(treeKillsForTest()).toBe(antes + 1)
    // O tempo limite mata só o git: o processo filho do alias 'lento' continua vivo até os 800 ms e, no Windows,
    // segura a pasta temporária. Esperar aqui evita que a limpeza em tests/helpers.ts falhe com EBUSY.
    await new Promise((r) => setTimeout(r, Math.max(0, inicioLento + 800 + 500 - Date.now())))
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

describe('limpeza da pasta temporária (removeDir)', () => {
  const erro = (code: string) => Object.assign(new Error(`falha ${code}`), { code })

  it('tenta de novo enquanto o erro é EBUSY e resolve quando a remoção passa', async () => {
    const rm = vi.fn<(dir: string) => void>()
    rm.mockImplementationOnce(() => {
      throw erro('EBUSY')
    })
    rm.mockImplementationOnce(() => {
      throw erro('EBUSY')
    })
    await expect(removeDir('qualquer', { rm, delayMs: 1 })).resolves.toBeUndefined()
    expect(rm).toHaveBeenCalledTimes(3)
  })

  it('esgotado o prazo, relança o último erro depois de mais de uma tentativa', async () => {
    const rm = vi.fn<(dir: string) => void>(() => {
      throw erro('EBUSY')
    })
    await expect(removeDir('qualquer', { rm, limitMs: 50, delayMs: 5 })).rejects.toMatchObject({ code: 'EBUSY' })
    expect(rm.mock.calls.length).toBeGreaterThan(1)
  })

  it('erro de outro tipo sobe na hora, sem nova tentativa', async () => {
    const rm = vi.fn<(dir: string) => void>(() => {
      throw erro('EINVAL')
    })
    await expect(removeDir('qualquer', { rm, delayMs: 1 })).rejects.toMatchObject({ code: 'EINVAL' })
    expect(rm).toHaveBeenCalledTimes(1)
  })

  it('apaga uma pasta de verdade com arquivo dentro', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gittools-removedir-'))
    writeFileSync(join(dir, 'a.txt'), 'a\n')
    await removeDir(dir)
    expect(existsSync(dir)).toBe(false)
  })
})

describe('espera do processo neto (waitForExit)', () => {
  it('só resolve depois que o processo do arquivo de pid saiu', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gittools-waitforexit-'))
    const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},300)'], { stdio: 'ignore' })
    try {
      const pid = child.pid
      expect(pid).toBeTypeOf('number')
      const pidPath = join(dir, 'filho.pid')
      writeFileSync(pidPath, String(pid))
      const started = Date.now()
      await waitForExit(pidPath)
      expect(Date.now() - started).toBeLessThan(5000)
      let code: string | undefined
      try {
        process.kill(pid!, 0)
      } catch (e) {
        code = errorCode(e)
      }
      expect(code).toBe('ESRCH')
    } finally {
      child.kill()
      await removeDir(dir)
    }
  })

  it('num arquivo que não existe retorna sem erro quando o prazo acaba', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gittools-waitforexit-'))
    try {
      await expect(waitForExit(join(dir, 'nao-existe.pid'), 100)).resolves.toBeUndefined()
    } finally {
      await removeDir(dir)
    }
  })

  it('arquivo que nunca aparece usa o prazo próprio (fileLimitMs), não o total', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gittools-waitforexit-'))
    try {
      const started = Date.now()
      await waitForExit(join(dir, 'nao-existe.pid'), 10_000, 100)
      expect(Date.now() - started).toBeLessThan(2000)
    } finally {
      await removeDir(dir)
    }
  })
})
