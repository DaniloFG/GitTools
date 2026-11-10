// Descoberta de repositórios git dentro de algumas pastas: a própria pasta (se for um repositório) e as
// subpastas, até uma profundidade. Não lê o git: só procura a entrada `.git` (pasta, ou arquivo nos
// worktrees e submódulos). Não abre os repositórios; quem chama decide o que fazer com cada caminho.

import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** Pastas que nunca são percorridas: dependências, saídas de compilação e o próprio .git. */
export const DISCOVERY_IGNORE = ['node_modules', '.git', 'dist', 'out', 'build', '.venv', 'vendor', 'target']

export interface DiscoverOptions {
  /** Até que profundidade descer a partir de cada pasta raiz (a raiz é a profundidade 0). Padrão 4. */
  maxDepth?: number
  /** Nomes de pastas que não são percorridas. Padrão: DISCOVERY_IGNORE. */
  ignore?: string[]
  /** Quantidade máxima de repositórios devolvidos. Padrão 50. */
  limit?: number
}

/** Teto de pastas lidas numa busca, para um workspace enorme (ex.: a pasta do usuário) não travar a abertura. */
const MAX_DIRECTORIES = 5000

/**
 * Procura repositórios git nas pastas `roots`. Devolve caminhos únicos: primeiro as raízes que são
 * repositórios (na ordem recebida), depois os aninhados em ordem alfabética. Pastas que não existem,
 * links simbólicos e pastas sem permissão são ignorados sem erro.
 */
export async function findRepositories(roots: string[], options: DiscoverOptions = {}): Promise<string[]> {
  const maxDepth = options.maxDepth ?? 4
  const ignore = new Set(options.ignore ?? DISCOVERY_IGNORE)
  const limit = options.limit ?? 50

  const found = new Set<string>()
  const topLevel: string[] = []
  const nested: string[] = []
  let visited = 0
  const full = () => found.size >= limit || visited >= MAX_DIRECTORIES

  /** Lê uma pasta: se tem `.git` e quais subpastas podem ser percorridas. Pasta ilegível não é repositório. */
  const inspect = async (folder: string): Promise<{ isRepo: boolean; children: string[] }> => {
    visited++
    let entries
    try {
      entries = await readdir(folder, { withFileTypes: true })
    } catch {
      return { isRepo: false, children: [] }
    }
    const isRepo = entries.some((e) => e.name === '.git' && (e.isDirectory() || e.isFile()))
    const children = entries
      .filter((e) => e.isDirectory() && !e.isSymbolicLink() && !ignore.has(e.name))
      .map((e) => e.name)
      .sort()
    return { isRepo, children }
  }

  /** Visita uma subpasta (profundidade >= 1): registra se é repositório e desce enquanto couber no limite. */
  const walk = async (folder: string, depth: number): Promise<void> => {
    if (full()) return
    const { isRepo, children } = await inspect(folder)
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

  for (const raw of roots) {
    const root = resolve(raw)
    if (topLevel.includes(root)) continue
    const { isRepo, children } = await inspect(root)
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

  // As raízes vêm primeiro (na ordem recebida); os aninhados em ordem alfabética, sem repetir as raízes.
  const rest = nested.filter((p) => !topLevel.includes(p)).sort((a, b) => a.localeCompare(b))
  return [...topLevel, ...rest].slice(0, Math.max(limit, topLevel.length))
}

/** O nome de uma pasta está na lista de ignorados? (para filtrar eventos de criação vindos do editor) */
export function isIgnoredPath(path: string, ignore: string[] = DISCOVERY_IGNORE): boolean {
  return path.split(/[\\/]/).some((part) => ignore.includes(part))
}
