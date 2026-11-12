import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { t } from '../src/shared/i18n'
import type { GitCommandEntry } from '../src/shared/types'
import { GitError, onGitCommand, runGit } from '../src/core/exec'
import { createRepo } from './helpers'

// Um processo neto é o que o git dispara no alias e deixa para trás: o `sh` do alias abre um processo em
// segundo plano que herda stdout e stderr do git. Quando o git morre (tempo limite ou teto de saída), o neto
// continua com os canais abertos. O `$$` e o `$!` são gravados num arquivo, para o teste matar os dois no fim.
// `exec` faz o `sh` virar o segundo processo do neto, então `$$` é o PID do processo que segura os canais.
const dirPids = mkdtempSync(join(tmpdir(), 'gittools-neto-'))
const paradas: Array<() => void> = []
const pidFiles: string[] = []

afterEach(async () => {
  paradas.splice(0).forEach((parar) => parar())
  // Mata os netos antes de qualquer outra coisa: nenhum processo sobra depois do teste, mesmo que ele tenha falhado.
  for (const arquivo of pidFiles.splice(0)) await matarNetos(arquivo)
})

afterAll(() => {
  rmSync(dirPids, { recursive: true, force: true })
})

/** Espera o arquivo de PIDs (o `sh` do neto o grava logo ao começar) e mata os processos listados. */
async function matarNetos(arquivo: string): Promise<void> {
  const limite = Date.now() + 2000
  while (!existsSync(arquivo) && Date.now() < limite) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  if (!existsSync(arquivo)) return
  const pids = readFileSync(arquivo, 'utf8').trim().split(/\s+/).map(Number)
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Já terminou: nada a fazer.
    }
  }
  rmSync(arquivo, { force: true })
}

/**
 * Rejeita se a promessa não assentar em `ms`. Sem isso, o caso que reprova (o pedido preso até o neto morrer)
 * só apareceria no tempo limite do vitest, que no Linux é de 120 s.
 */
function emAte<T>(ms: number, promessa: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const prazo = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`o pedido não terminou em ${ms} ms`)), ms)
  })
  return Promise.race([promessa, prazo]).finally(() => clearTimeout(timer))
}

/** Registra as entradas do log de comandos do pedido marcado com `teste.id=<tag>`. */
function registraLog(tag: string): GitCommandEntry[] {
  const entradas: GitCommandEntry[] = []
  paradas.push(
    onGitCommand((entry) => {
      if (entry.args.includes(`teste.id=${tag}`)) entradas.push(entry)
    })
  )
  return entradas
}

function arquivoDePids(tag: string): string {
  const arquivo = join(dirPids, `${tag}.pid`)
  pidFiles.push(arquivo)
  return arquivo
}

describe.skipIf(process.platform === 'win32')('processo neto que segura os canais de saída', () => {
  it('tempo limite: o git morre, o neto segura stdout e stderr, e o pedido falha na hora com o log fechado', async () => {
    const t0 = await createRepo()
    await t0.commit('primeiro', { 'a.txt': 'a\n' })
    const tag = 'neto-timeout'
    const entradas = registraLog(tag)
    const pf = arquivoDePids(tag)
    const alias = `alias.neto=!sleep 30 & echo $$ $! > "${pf}"; exec sleep 30`
    const inicio = Date.now()
    const erro = await emAte(
      5000,
      runGit(t0.dir, ['-c', alias, '-c', `teste.id=${tag}`, 'neto'], { timeoutMs: 300 }).then(
        () => null,
        (e: unknown) => e
      )
    )
    const duracao = Date.now() - inicio

    expect(erro).toBeInstanceOf(GitError)
    expect(erro instanceof GitError ? erro.message : '').toBe(t('gitTerminal.timeout', { seconds: 0 }))
    expect(duracao).toBeLessThan(5000)
    // O log de comandos recebe o fim do pedido (não só o início): sem isso a linha ficaria "em andamento".
    const fim = entradas.find((e) => e.exitCode !== undefined)
    expect(fim).toMatchObject({ exitCode: -1, failed: true })
  })

  it('teto de saída (stopAtLimit): o neto imprime sem parar e segura os canais, e o pedido resolve com truncated na hora', async () => {
    const t0 = await createRepo()
    await t0.commit('primeiro', { 'a.txt': 'a\n' })
    const tag = 'neto-teto'
    const entradas = registraLog(tag)
    const pf = arquivoDePids(tag)
    const limite = 1024
    const alias = `alias.neto=!yes & echo $$ $! > "${pf}"; exec sleep 30`
    const inicio = Date.now()
    const resultado = await emAte(
      5000,
      runGit(t0.dir, ['-c', alias, '-c', `teste.id=${tag}`, 'neto'], { maxOutputBytes: limite, stopAtLimit: true })
    )
    const duracao = Date.now() - inicio

    expect(duracao).toBeLessThan(5000)
    expect(resultado.truncated).toBe(true)
    // O que chegou até o teto é guardado exatamente até o limite, e nada além dele.
    expect(Buffer.byteLength(resultado.stdout)).toBe(limite)
    const fim = entradas.find((e) => e.exitCode !== undefined)
    expect(fim).toBeDefined()
    expect(fim?.failed).toBeUndefined()
  })
})
