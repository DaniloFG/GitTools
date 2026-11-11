// Descoberta dos repositórios do workspace na extensão, com leituras de pasta em paralelo (item 5.4, achado D5).
// Sem VS Code: testável no Node. O resultado é exatamente o de `findRepositories` (src/core/discover.ts), que
// lê uma pasta por vez; aqui o percurso lógico continua o mesmo (profundidade primeiro, filhos em ordem
// alfabética, teto de pastas e de repositórios contados na mesma ordem), mas as próximas pastas desse percurso
// já são lidas enquanto a atual é examinada, com poucas leituras por vez.

import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Dirent } from 'node:fs'
import type { BridgeChannel } from '../../src/shared/channels'
import { DISCOVERY_IGNORE, type DiscoverOptions } from '../../src/core/discover'

/** Teto de pastas examinadas numa busca: o mesmo de `findRepositories`, para um workspace enorme não travar a abertura. */
export const MAX_DIRECTORIES = 5000
/** Leituras de pasta ao mesmo tempo. Poucas: disco lento (HD, rede) piora com muitas, e cada uma segura um descritor. */
export const SCAN_CONCURRENCY = 8
/** Quantas pastas podem ser lidas à frente do percurso. Limita o desperdício quando um teto é atingido. */
const LOOKAHEAD = 32

interface Pending {
  started: boolean
  /** Lida adiantado (conta no `ahead` até o percurso consumi-la). */
  prefetched: boolean
  result: Promise<Dirent[] | null>
}

/** Lê uma pasta; ilegível (sumiu, sem permissão) vira `null`, como no percurso em série. */
const read = (path: string): Promise<Dirent[] | null> => readdir(path, { withFileTypes: true }).catch(() => null)

/**
 * Leitor de pastas com leitura adiantada: `hint` põe na fila as pastas que o percurso vai pedir; `want` devolve
 * uma pasta (já lida, em leitura, ou lida na hora). A fila é uma pilha, como o percurso em profundidade: os
 * filhos da pasta examinada por último saem primeiro, na ordem em que serão pedidos.
 */
function createReader(concurrency: number) {
  const known = new Map<string, Pending>()
  const stack: { path: string; item: Pending }[] = []
  let running = 0
  /** Pastas lidas adiantado (ou em leitura) que o percurso ainda não pediu. */
  let ahead = 0
  let stopped = false

  const pump = () => {
    while (!stopped && running < concurrency && ahead < LOOKAHEAD && stack.length > 0) {
      const { path, item } = stack.pop()!
      if (item.started) continue
      item.started = true
      item.prefetched = true
      running++
      ahead++
      item.result = read(path).finally(() => {
        running--
        pump()
      })
    }
  }

  return {
    async want(path: string): Promise<Dirent[] | null> {
      const item = known.get(path)
      known.delete(path)
      // Ainda não começou: lê agora, sem esperar vaga (o percurso é um só, então é no máximo uma leitura a mais).
      if (!item?.started) {
        if (item) item.started = true
        return read(path)
      }
      const result = await item.result
      if (item.prefetched) ahead--
      pump()
      return result
    },
    hint(paths: string[]): void {
      for (let i = paths.length - 1; i >= 0; i--) {
        if (known.has(paths[i])) continue
        const item: Pending = { started: false, prefetched: false, result: Promise.resolve(null) }
        known.set(paths[i], item)
        stack.push({ path: paths[i], item })
      }
      pump()
    },
    /** Acabou (ou atingiu um teto): nada mais é lido adiantado. */
    stop(): void {
      stopped = true
      stack.length = 0
      known.clear()
    }
  }
}

/**
 * Procura repositórios git nas pastas `roots`, com o mesmo resultado de `findRepositories`: primeiro as raízes
 * que são repositórios (na ordem recebida), depois os aninhados em ordem alfabética; no máximo
 * `MAX_DIRECTORIES` pastas examinadas. A diferença é só o tempo: até `concurrency` leituras de pasta ao mesmo tempo.
 */
export async function findRepositoriesConcurrent(roots: string[], options: DiscoverOptions = {}, concurrency = SCAN_CONCURRENCY): Promise<string[]> {
  const maxDepth = options.maxDepth ?? 4
  const ignore = new Set(options.ignore ?? DISCOVERY_IGNORE)
  const limit = options.limit ?? 50
  const reader = createReader(Math.max(1, concurrency))

  const found = new Set<string>()
  const topLevel: string[] = []
  const nested: string[] = []
  let visited = 0
  const full = () => found.size >= limit || visited >= MAX_DIRECTORIES

  /** Examina uma pasta (conta para o teto na mesma ordem do percurso em série) e adianta a leitura dos filhos. */
  const inspect = async (folder: string, depth: number): Promise<{ isRepo: boolean; children: string[] }> => {
    visited++
    const entries = await reader.want(folder)
    if (!entries) return { isRepo: false, children: [] }
    const isRepo = entries.some((e) => e.name === '.git' && (e.isDirectory() || e.isFile()))
    const children = entries
      .filter((e) => e.isDirectory() && !e.isSymbolicLink() && !ignore.has(e.name))
      .map((e) => e.name)
      .sort()
    // Os filhos só serão examinados se estiverem dentro da profundidade.
    if (depth < maxDepth) reader.hint(children.map((name) => join(folder, name)))
    return { isRepo, children }
  }

  const walk = async (folder: string, depth: number): Promise<void> => {
    if (full()) return
    const { isRepo, children } = await inspect(folder, depth)
    if (isRepo && !found.has(folder)) {
      found.add(folder)
      nested.push(folder)
    }
    if (depth >= maxDepth) return
    for (const name of children) {
      if (full()) return
      await walk(join(folder, name), depth + 1)
    }
  }

  try {
    for (const raw of roots) {
      const root = resolve(raw)
      if (topLevel.includes(root)) continue
      const { isRepo, children } = await inspect(root, 0)
      if (isRepo) {
        found.add(root)
        topLevel.push(root)
      }
      if (maxDepth < 1) continue
      for (const name of children) {
        if (full()) break
        await walk(join(root, name), 1)
      }
    }
  } finally {
    reader.stop()
  }

  const rest = nested.filter((p) => !topLevel.includes(p)).sort((a, b) => a.localeCompare(b))
  return [...topLevel, ...rest].slice(0, Math.max(limit, topLevel.length))
}

/** `fn` sobre cada item, com no máximo `concurrency` ao mesmo tempo; os resultados voltam na ordem dos itens. */
export async function mapLimit<T, R>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, worker))
  return results
}

/**
 * Pedidos que respondem sem esperar a descoberta do workspace: não dependem dos repositórios abertos. Os
 * demais esperam, para a interface nunca ver "nenhum aberto" enquanto há repositório a caminho (ela mostra o
 * carregamento até a resposta de `app:openRepositories`).
 */
const INDEPENDENT_OF_REPOSITORIES = new Set<BridgeChannel>(['app:getSettings', 'app:info', 'app:gitLog', 'app:defaultCloneFolder', 'app:detectEditors'])

/** Este pedido precisa esperar a descoberta do workspace terminar? */
export const waitsForDiscovery = (channel: BridgeChannel): boolean => !INDEPENDENT_OF_REPOSITORIES.has(channel)
