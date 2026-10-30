// Cache das leituras do git, por repositório. Navegar entre telas, painéis e abas de repositórios remonta
// componentes que pedem de novo o que já tinham baixado; aqui essas leituras são respondidas da memória, sem
// abrir outro processo git, enquanto nada mudou no repositório.
//
// Regras (tudo testado em tests/readCache.test.ts):
//  - leitura "imutável" (endereçada por um sha completo: um commit, o diff de um commit) vale para sempre;
//  - leitura "volátil" (status, branches, log…) vale enquanto a *geração* do repositório não mudar. A geração
//    sobe quando o git avisa que algo mudou (observador da pasta .git, foco da janela) e a cada alteração feita
//    pela interface (qualquer método que não seja de leitura);
//  - chamadas iguais ao mesmo tempo compartilham uma única execução;
//  - um resultado que chega depois de a geração mudar (ou durante uma alteração) é entregue a quem pediu, mas
//    não é guardado: nunca fica um dado velho passando por novo;
//  - cada repositório tem a sua geração e as suas entradas: um repositório nunca recebe resposta de outro;
//  - o cache tem limite de entradas e de memória (as menos usadas saem primeiro).

/** Quanto tempo uma leitura vale. `mutation` = altera o repositório (invalida); `none` = lê, mas nunca é guardada. */
export type CallKind = 'immutable' | 'volatile' | 'mutation' | 'none'

/** sha completo de um objeto git (SHA-1 de 40 ou SHA-256 de 64 caracteres). */
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i
const isSha = (value: unknown): boolean => typeof value === 'string' && FULL_SHA.test(value)

/** Métodos que só leem. Qualquer outro método é tratado como alteração (a escolha mais segura para um método novo). */
const READS: ReadonlySet<string> = new Set([
  'info',
  'status',
  'branches',
  'tags',
  'refs',
  'stashes',
  'log',
  'commitDetails',
  'diff',
  'operationState',
  'branchCommits',
  'filesChangedBy',
  'remotes',
  'compare',
  'listFiles',
  'readFile',
  'analytics',
  'blame',
  'fileHistory',
  'rebasePlan',
  'conflictDetails'
])

/** Leituras do que está na pasta de trabalho e é editado por fora: sempre vão ao disco. */
const UNCACHED: ReadonlySet<string> = new Set(['readFile', 'conflictDetails'])

/** Classifica uma chamada pelo método e pelos argumentos. */
export function classifyCall(method: string, args: readonly unknown[]): CallKind {
  if (!READS.has(method)) return 'mutation'
  if (UNCACHED.has(method)) return 'none'
  switch (method) {
    case 'commitDetails':
      return isSha(args[0]) ? 'immutable' : 'volatile'
    case 'diff': {
      const source = args[0] as { kind?: string; sha?: unknown; from?: unknown; to?: unknown } | undefined
      if (source?.kind === 'commit' && isSha(source.sha)) return 'immutable'
      if (source?.kind === 'range' && isSha(source.from) && isSha(source.to)) return 'immutable'
      return 'volatile'
    }
    case 'filesChangedBy':
      return Array.isArray(args[0]) && args[0].length > 0 && args[0].every(isSha) ? 'immutable' : 'volatile'
    case 'blame':
      return isSha(args[1]) ? 'immutable' : 'volatile'
    case 'compare':
      return isSha(args[0]) && isSha(args[1]) ? 'immutable' : 'volatile'
    default:
      return 'volatile'
  }
}

/** Tamanho aproximado, em bytes, de um resultado (percorre no máximo `LIMIT` nós; resultados enormes contam como grandes). */
export function approxSize(value: unknown, limit = 4000): number {
  let bytes = 0
  let visited = 0
  const stack: unknown[] = [value]
  while (stack.length > 0) {
    const item = stack.pop()
    if (++visited > limit) return Math.max(bytes, 1) * 8
    if (typeof item === 'string') bytes += item.length * 2 + 16
    else if (typeof item === 'number' || typeof item === 'boolean') bytes += 8
    else if (Array.isArray(item)) {
      bytes += 16
      for (const child of item) stack.push(child)
    } else if (item && typeof item === 'object') {
      bytes += 32
      for (const child of Object.values(item)) stack.push(child)
    }
  }
  return bytes
}

interface Entry {
  root: string
  kind: 'immutable' | 'volatile'
  /** Geração do repositório quando a leitura começou. */
  generation: number
  promise: Promise<unknown>
  /** Preenchido quando a leitura termina e vai para o cache. */
  size: number
}

export interface ReadCacheStats {
  hits: number
  misses: number
  /** Chamadas que entraram numa leitura igual já em andamento. */
  joined: number
  /** Resultados entregues mas não guardados (a geração mudou no meio, ou havia uma alteração em andamento). */
  discarded: number
  evicted: number
}

export interface ReadCacheOptions {
  maxEntries?: number
  maxBytes?: number
}

export class ReadCache {
  private readonly entries = new Map<string, Entry>()
  /** Geração própria de cada repositório (sobe a cada invalidação dele). */
  private readonly local = new Map<string, number>()
  /** Sobe quando tudo é invalidado de uma vez (foco da janela). */
  private epoch = 0
  /** Alterações em andamento por repositório: enquanto houver, leituras voláteis não são guardadas. */
  private readonly mutating = new Map<string, number>()
  private bytes = 0
  private readonly maxEntries: number
  private readonly maxBytes: number
  readonly stats: ReadCacheStats = { hits: 0, misses: 0, joined: 0, discarded: 0, evicted: 0 }

  constructor(options: ReadCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 600
    this.maxBytes = options.maxBytes ?? 48 * 1024 * 1024
  }

  /**
   * Geração atual do repositório. Só cresce: o dado carregado na geração N continua valendo enquanto a geração
   * atual for N.
   */
  generation(root: string): number {
    return this.epoch + (this.local.get(root) ?? 0)
  }

  /** Quantas entradas e quantos bytes (aproximados) estão guardados. */
  get size(): { entries: number; bytes: number } {
    return { entries: this.entries.size, bytes: this.bytes }
  }

  private key(root: string, method: string, args: readonly unknown[]): string {
    return `${root}\n${method}\n${JSON.stringify(args)}`
  }

  private remove(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key)
    this.bytes -= entry.size
  }

  /**
   * Executa a chamada pelo cache. `run` faz a chamada de verdade; ele só é chamado quando a resposta não está
   * guardada nem em andamento. Alterações passam direto, invalidando o repositório antes e depois.
   */
  call<T>(root: string, method: string, args: readonly unknown[], run: () => Promise<T>): Promise<T> {
    const kind = classifyCall(method, args)
    if (kind === 'mutation') return this.mutate(root, run)
    if (kind === 'none') return run()

    const key = this.key(root, method, args)
    const found = this.entries.get(key)
    if (found && (found.kind === 'immutable' || found.generation === this.generation(root))) {
      // Usada agora: vai para o fim da fila (as menos usadas saem primeiro).
      this.entries.delete(key)
      this.entries.set(key, found)
      if (found.size === 0) this.stats.joined++
      else this.stats.hits++
      return found.promise as Promise<T>
    }
    if (found) this.remove(key)

    this.stats.misses++
    const generation = this.generation(root)
    const promise = run()
    // Durante uma alteração a resposta de uma leitura volátil já nasce velha: não vale guardá-la nem compartilhá-la.
    if (kind === 'volatile' && (this.mutating.get(root) ?? 0) > 0) {
      this.stats.discarded++
      return promise
    }
    const entry: Entry = { root, kind, generation, promise, size: 0 }
    this.entries.set(key, entry)
    promise.then(
      (value) => {
        // Invalidada ou removida enquanto a leitura corria: a resposta serve a quem pediu, mas não fica guardada.
        if (this.entries.get(key) !== entry) {
          this.stats.discarded++
          return
        }
        if (kind === 'volatile' && (generation !== this.generation(root) || (this.mutating.get(root) ?? 0) > 0)) {
          this.remove(key)
          this.stats.discarded++
          return
        }
        entry.size = Math.max(approxSize(value), 1)
        this.bytes += entry.size
        this.trim()
      },
      () => {
        // Erro não é guardado: a próxima chamada tenta de novo.
        if (this.entries.get(key) === entry) this.remove(key)
      }
    )
    return promise
  }

  private async mutate<T>(root: string, run: () => Promise<T>): Promise<T> {
    this.mutating.set(root, (this.mutating.get(root) ?? 0) + 1)
    this.invalidate(root)
    try {
      return await run()
    } finally {
      const left = (this.mutating.get(root) ?? 1) - 1
      if (left > 0) this.mutating.set(root, left)
      else this.mutating.delete(root)
      this.invalidate(root)
    }
  }

  /** Algo mudou em `root` (por fora ou por uma operação fora desta interface): as leituras voláteis dele deixam de valer. */
  invalidate(root: string): void {
    this.local.set(root, (this.local.get(root) ?? 0) + 1)
    for (const [key, entry] of [...this.entries]) if (entry.root === root && entry.kind === 'volatile') this.remove(key)
  }

  /** Algo pode ter mudado em qualquer repositório (a janela voltou a ter foco): invalida todos. */
  invalidateAll(): void {
    this.epoch++
    for (const [key, entry] of [...this.entries]) if (entry.kind === 'volatile') this.remove(key)
  }

  /** O repositório foi fechado: esquece tudo dele. */
  drop(root: string): void {
    for (const [key, entry] of [...this.entries]) if (entry.root === root) this.remove(key)
    this.local.delete(root)
    this.mutating.delete(root)
  }

  /** Mantém o cache dentro dos limites, tirando as entradas menos usadas (as mais antigas na fila). */
  private trim(): void {
    for (const key of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries && this.bytes <= this.maxBytes) return
      const entry = this.entries.get(key)!
      // Leituras ainda em andamento (tamanho 0) ficam: alguém está esperando por elas.
      if (entry.size === 0) continue
      this.remove(key)
      this.stats.evicted++
    }
  }
}

/**
 * Limita quantas tarefas de segundo plano (resumos das abas, pré-carga) rodam ao mesmo tempo, para uma
 * rajada delas não abrir dezenas de processos git de uma vez. As do primeiro plano não passam por aqui.
 */
export class Limiter {
  private active = 0
  private readonly waiting: (() => void)[] = []

  constructor(private readonly max: number) {}

  get running(): number {
    return this.active
  }

  get queued(): number {
    return this.waiting.length
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.waiting.push(resolve))
    this.active++
    try {
      return await task()
    } finally {
      this.active--
      this.waiting.shift()?.()
    }
  }
}
