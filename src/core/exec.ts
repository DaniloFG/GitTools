import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import * as os from 'node:os'
import { t } from '../shared/i18n'
import type { GitCommandEntry } from '../shared/types'
import { ARG_BUDGET, MAX_COMMAND_CHARS, commandChars } from './chunk'

type CommandListener = (entry: GitCommandEntry) => void
const commandListeners = new Set<CommandListener>()
let nextCommandId = 1

/**
 * Avisa sobre cada comando git executado: uma vez ao começar e outra ao terminar (com duração,
 * código de saída e erro). Usado pelo log de comandos em tempo real.
 */
export function onGitCommand(listener: CommandListener): () => void {
  commandListeners.add(listener)
  return () => {
    commandListeners.delete(listener)
  }
}

function emitCommand(entry: GitCommandEntry) {
  for (const listener of commandListeners) {
    try {
      listener(entry)
    } catch {
      // Um ouvinte com problema não pode atrapalhar o comando.
    }
  }
}

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: string[],
    readonly exitCode: number,
    readonly stdout: string,
    readonly stderr: string,
    /** A saída foi cortada no limite (RunOptions.maxOutputBytes). */
    readonly truncated = false,
    /** O pedido foi cancelado pelo RunOptions.signal (o git não terminou por conta própria). */
    readonly aborted = false
  ) {
    super(message)
    this.name = 'GitError'
  }
}

/** Prioridade de um pedido na fila de processos: quando não há vaga, a maior sai primeiro. */
export type GitPriority = 'high' | 'normal' | 'low'

export interface RunOptions {
  /** Texto enviado para a entrada padrão do git (ex.: um patch para `git apply -`). */
  input?: string
  /** Códigos de saída considerados sucesso (padrão: [0]). */
  okExitCodes?: number[]
  env?: NodeJS.ProcessEnv
  /**
   * Tempo máximo em ms, contado a partir do início do processo (a espera na fila não entra):
   * passado, o git é interrompido e o comando falha.
   */
  timeoutMs?: number
  /** Bytes guardados de cada saída (stdout e stderr); o excedente é descartado e `truncated` fica verdadeiro. */
  maxOutputBytes?: number
  /**
   * Para o git quando o stdout passa de `maxOutputBytes`. O resultado sai normalmente, com o que foi guardado
   * e `truncated`, mesmo que o código de saída venha nulo ou de sinal (não é erro). Sem isso, o git gera a saída inteira.
   */
  stopAtLimit?: boolean
  /**
   * Cancelamento. Sinal já abortado: rejeita sem abrir processo. Abortado durante a execução: o git é
   * encerrado e a promessa rejeita com `GitError.aborted`. Abortado enquanto espera na fila: sai da fila.
   */
  signal?: AbortSignal
  /** Prioridade na fila de processos (padrão: 'normal'). */
  priority?: GitPriority
  /** Não aparece no log de comandos (consultas internas do próprio GitTools). */
  silent?: boolean
}

export interface RunResult {
  stdout: string
  stderr: string
  exitCode: number
  /** Alguma saída foi cortada em RunOptions.maxOutputBytes. */
  truncated?: boolean
}

/** Remove as dicas ("hint: ...") do git, que só fazem sentido no terminal. */
export function cleanMessage(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.startsWith('hint:'))
    .join('\n')
    .trim()
}

const BASE_ARGS = ['-c', 'core.quotepath=false', '-c', 'color.ui=false', '-c', 'advice.detachedHead=false']

/**
 * Tempo de espera, depois do `exit` do git, por um `close` normal, quando o pedido foi parado (tempo limite ou
 * teto de saída). O `close` normal chega logo e conclui antes, preservando o comportamento de sempre. A espera
 * só vale quando um processo neto segura os canais: aí o `close` não chega, e a resposta sai depois deste tempo.
 * Sem a espera, a resposta sairia antes de o Windows soltar os handles do git e dos filhos (EBUSY ao apagar a pasta).
 */
const EXIT_GRACE_MS = 250

// ------------------------------------------------------------ fila de processos

/**
 * Processos git simultâneos, no máximo. Cada `git` disputa disco e núcleos: dezenas deles ao mesmo tempo
 * deixam tudo mais lento do que em fila. O mínimo de 2 evita que uma leitura de segundo plano trave a
 * interface; o teto de 6 evita ocupar a máquina inteira.
 */
export const MAX_GIT_PROCESSES = Math.max(2, Math.min(6, os.availableParallelism?.() ?? os.cpus().length))

const PRIORITIES: GitPriority[] = ['high', 'normal', 'low']
interface Waiter {
  priority: GitPriority
  wake: () => void
}
const queues: Record<GitPriority, Waiter[]> = { high: [], normal: [], low: [] }
let running = 0
let peak = 0

function queuedCount(): number {
  return queues.high.length + queues.normal.length + queues.low.length
}

function takeSlot() {
  running++
  if (running > peak) peak = running
}

/** Devolve a vaga e acorda o próximo da fila (o de prioridade maior; dentro dela, por ordem de chegada). */
function releaseSlot() {
  running--
  while (running < MAX_GIT_PROCESSES) {
    let next: Waiter | undefined
    for (const p of PRIORITIES) {
      next = queues[p].shift()
      if (next) break
    }
    if (!next) return
    takeSlot()
    next.wake()
  }
}

/**
 * Espera uma vaga. Resolve `true` com a vaga ocupada (quem recebe deve devolvê-la), ou `false` se o sinal
 * abortou enquanto esperava: o pedido sai da fila sem abrir processo.
 */
function acquireSlot(priority: GitPriority, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false)
  if (running < MAX_GIT_PROCESSES && queuedCount() === 0) {
    takeSlot()
    return Promise.resolve(true)
  }
  return new Promise((resolve) => {
    const onAbort = () => {
      const list = queues[priority]
      const at = list.indexOf(waiter)
      if (at !== -1) list.splice(at, 1)
      resolve(false)
    }
    const waiter: Waiter = {
      priority,
      wake: () => {
        signal?.removeEventListener('abort', onAbort)
        resolve(true)
      }
    }
    queues[priority].push(waiter)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Só para testes: processos rodando, pedidos na fila e o pico de processos simultâneos desde a última zeragem. */
export function gitQueueStatsForTest() {
  return { running, queued: queuedCount(), peak }
}

/** Só para testes: zera o pico para medir um trecho isolado. */
export function resetGitQueuePeakForTest() {
  peak = running
}

// ------------------------------------------------------------ execução

/** Avisos do log de comandos de um pedido. Pedido `silent` não aparece no log. */
function traceCommand(entry: GitCommandEntry, silent: boolean | undefined) {
  return {
    start: () => {
      if (!silent) emitCommand(entry)
    },
    finish: (exitCode: number, error?: string) => {
      if (silent) return
      emitCommand({
        ...entry,
        exitCode,
        durationMs: Date.now() - entry.startedAt,
        ...(error !== undefined ? { failed: true, error: error.split('\n')[0] } : {})
      })
    }
  }
}

function newEntry(cwd: string, args: string[]): GitCommandEntry {
  return { id: nextCommandId++, args, cwd, startedAt: Date.now() }
}

function abortedError(args: string[]): GitError {
  return new GitError(t('core.gitCanceled'), args, -1, '', '', false, true)
}

/**
 * Comandos de rede: a duração depende do servidor, não da CPU nem do disco local. Um fetch lento ocupando
 * uma das poucas vagas travaria todas as leituras da tela, então eles rodam fora da fila (sem vaga).
 * args[0] é o subcomando (BASE_ARGS fica de fora). `remote update` é rede, mas `remote add` não é.
 */
const NETWORK_SUBCOMMANDS = new Set(['fetch', 'pull', 'push', 'clone', 'ls-remote'])
function isNetworkCommand(args: string[]): boolean {
  if (NETWORK_SUBCOMMANDS.has(args[0])) return true
  return args[0] === 'remote' && args[1] === 'update'
}

/**
 * Executa um comando git sem shell (os argumentos nunca são interpretados) e sem
 * prompts interativos: editores viram no-op e credenciais nunca são pedidas no terminal.
 * Cada processo ocupa uma vaga da fila (MAX_GIT_PROCESSES) do início ao fim.
 */
export function runGit(cwd: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const signal = options.signal
    if (signal?.aborted) {
      reject(abortedError(args))
      return
    }
    const commandSize = commandChars([...BASE_ARGS, ...args])
    if (commandSize > MAX_COMMAND_CHARS) {
      // Nem inicia o git, então não ocupa vaga. Continua aparecendo no log como falha, como sempre apareceu.
      const entry = newEntry(cwd, args)
      const log = traceCommand(entry, options.silent)
      const message = t('commandLimit.tooLong', { command: args[0] })
      log.start()
      log.finish(-1, message)
      reject(new GitError(message, args, -1, '', ''))
      return
    }
    if (isNetworkCommand(args)) {
      execute(cwd, args, options, commandSize, resolve, reject, false)
      return
    }
    acquireSlot(options.priority ?? 'normal', signal).then((granted) => {
      if (granted) execute(cwd, args, options, commandSize, resolve, reject, true)
      else reject(abortedError(args))
    })
  })
}

/**
 * Abre o processo e devolve o resultado. `slot` diz se o pedido ocupou uma vaga da fila (comandos de rede
 * não ocupam): só então a vaga volta em cada caminho de término.
 */
function execute(
  cwd: string,
  args: string[],
  options: RunOptions,
  commandSize: number,
  resolve: (result: RunResult) => void,
  reject: (error: unknown) => void,
  slot: boolean
): void {
  const giveBackSlot = () => {
    if (slot) releaseSlot()
  }
  const signal = options.signal
  if (signal?.aborted) {
    giveBackSlot()
    reject(abortedError(args))
    return
  }
  // O anúncio sai só quando o processo de fato começa: o log mostra o que roda, não o que espera.
  const entry = newEntry(cwd, args)
  const log = traceCommand(entry, options.silent)
  log.start()

  let child: ChildProcessWithoutNullStreams
  try {
    child = spawn('git', [...BASE_ARGS, ...args], {
      cwd,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_EDITOR: 'true',
        GIT_SEQUENCE_EDITOR: 'true',
        GIT_MERGE_AUTOEDIT: 'no',
        GIT_PAGER: 'cat',
        // A interface consulta o status o tempo todo: sem isso o git regrava o index (e o trava) a cada consulta.
        GIT_OPTIONAL_LOCKS: '0',
        // Saída do git sempre em inglês: a interface traduz o que importa e o
        // código que interpreta mensagens do git não depende do idioma do sistema.
        LC_ALL: 'en_US.UTF-8',
        LANG: 'en_US.UTF-8',
        LANGUAGE: 'en',
        ...options.env
      }
    })
  } catch (error) {
    giveBackSlot()
    log.finish(-1, error instanceof Error ? error.message : String(error))
    reject(error)
    return
  }

  // Guarda no máximo `maxOutputBytes` de cada saída; o resto é lido e descartado (ou o git é parado, com stopAtLimit).
  const limit = options.maxOutputBytes ?? Infinity
  const kept = { out: 0, err: 0 }
  const out: Buffer[] = []
  const err: Buffer[] = []
  let truncated = false
  let timedOut = false
  let aborted = false
  let stoppedAtLimit = false
  let stopping = false
  let finished = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let graceTimer: ReturnType<typeof setTimeout> | null = null

  // Pede ao git que pare, uma vez. Quem chama guarda o motivo em uma flag. Parar também cancela o tempo
  // limite, para ele não disparar depois e trocar o motivo do fim.
  const stop = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (stopping) return
    stopping = true
    child.kill('SIGTERM')
  }

  const onAbort = () => {
    aborted = true
    stop()
  }

  // Fecha o pedido uma só vez: para o tempo limite, tira o ouvinte de cancelamento e devolve a vaga.
  const end = (): boolean => {
    if (finished) return false
    finished = true
    if (timer) clearTimeout(timer)
    if (graceTimer) clearTimeout(graceTimer)
    signal?.removeEventListener('abort', onAbort)
    giveBackSlot()
    return true
  }

  const collect = (chunks: Buffer[], key: 'out' | 'err') => (d: Buffer) => {
    const room = limit - kept[key]
    if (d.length <= room) {
      chunks.push(d)
      kept[key] += d.length
      return
    }
    truncated = true
    if (room > 0) {
      chunks.push(d.subarray(0, room))
      kept[key] += room
    }
    if (key === 'out' && options.stopAtLimit) {
      stoppedAtLimit = true
      stop()
    }
  }
  child.stdout.on('data', collect(out, 'out'))
  child.stderr.on('data', collect(err, 'err'))

  if (options.timeoutMs) {
    timer = setTimeout(() => {
      timedOut = true
      stop()
    }, options.timeoutMs)
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  const complete = (code: number | null) => {
    if (!end()) return
    const stdout = Buffer.concat(out).toString('utf8')
    const stderr = Buffer.concat(err).toString('utf8')
    const exitCode = code ?? -1
    if (timedOut) {
      const message = t('gitTerminal.timeout', { seconds: Math.round((options.timeoutMs ?? 0) / 1000) })
      log.finish(-1, message)
      reject(new GitError(message, args, -1, stdout, stderr, truncated))
    } else if (aborted) {
      const message = t('core.gitCanceled')
      log.finish(-1, message)
      reject(new GitError(message, args, -1, stdout, stderr, truncated, true))
    } else if (stoppedAtLimit) {
      // Parado de propósito no teto: o que chegou é o resultado, não um erro.
      log.finish(exitCode)
      resolve({ stdout, stderr, exitCode, truncated: true })
    } else if ((options.okExitCodes ?? [0]).includes(exitCode)) {
      log.finish(exitCode)
      resolve({ stdout, stderr, exitCode, truncated })
    } else {
      const message = cleanMessage(stderr) || cleanMessage(stdout) || t('core.gitFailed', { command: args[0], code: exitCode })
      log.finish(exitCode, message)
      reject(new GitError(message, args, exitCode, stdout, stderr, truncated))
    }
  }

  child.on('error', (e: NodeJS.ErrnoException) => {
    if (!end()) return
    // Linha de comando longa demais: o Linux responde E2BIG/ENAMETOOLONG e o Windows, ENOENT.
    const tooLong = e.code === 'E2BIG' || e.code === 'ENAMETOOLONG' || (e.code === 'ENOENT' && commandSize > ARG_BUDGET)
    const message = tooLong ? t('commandLimit.tooLong', { command: args[0] }) : t('core.gitNotFound', { error: e.message })
    log.finish(-1, message)
    reject(new GitError(message, args, -1, '', ''))
  })
  // Cancelado: o git já morreu e a saída não é usada, então responde na hora.
  // Tempo limite ou teto de saída: o git foi morto de propósito, e um processo neto pode manter os canais
  // abertos, o que impediria o `close` de chegar. Por isso espera EXIT_GRACE_MS por um `close` normal e só
  // então responde. `complete` é idempotente: o `close` que chegar depois não faz nada, e `end()` limpa o timer.
  child.on('exit', (code) => {
    if (aborted) {
      complete(code)
      return
    }
    if (timedOut || stoppedAtLimit) {
      graceTimer = setTimeout(() => complete(code), EXIT_GRACE_MS)
      graceTimer.unref()
    }
  })
  child.on('close', (code) => complete(code))
  child.stdin.on('error', () => {
    // O git pode fechar a entrada antes de lermos tudo; o erro real aparece no código de saída.
  })
  child.stdin.end(options.input ?? '')
}
