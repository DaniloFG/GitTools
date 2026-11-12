// Caminhos relativos ao repositório → caminhos absolutos do sistema, sem sair do repositório.

import { realpathSync } from 'node:fs'
import { constants } from 'node:fs'
import { lstat, open, readFile, realpath } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { t } from '../shared/i18n'

/**
 * Chave para comparar dois caminhos de pasta: resolve barras finais, caminhos relativos e links
 * simbólicos (/var → /private/var no macOS). No Windows não diferencia maiúsculas de minúsculas.
 * Caminho que não existe é só normalizado.
 */
export function comparablePath(folder: string): string {
  let real: string
  try {
    real = realpathSync.native(folder)
  } catch {
    real = path.resolve(folder)
  }
  return process.platform === 'win32' ? real.toLowerCase() : real
}

/**
 * Resolve `relative` dentro de `root` e devolve o caminho absoluto no formato do sistema (no Windows,
 * com `\`). O git informa a raiz com `/` (ex.: `C:/Users/ana/projeto`), então a comparação é feita
 * depois de normalizar os dois lados, não com texto.
 */
export function resolveInside(root: string, relative: string, api: Pick<typeof path, 'resolve' | 'relative' | 'isAbsolute' | 'sep'> = path): string {
  const base = api.resolve(root)
  const full = api.resolve(base, relative)
  const rel = api.relative(base, full)
  if (rel === '..' || rel.startsWith(`..${api.sep}`) || api.isAbsolute(rel)) throw new Error(t('main.outsideRepository'))
  return full
}

/**
 * Raiz do repositório com o caminho real (links resolvidos), guardada por raiz. Ela não muda durante a sessão, e
 * recalculá-la a cada arquivo custaria uma leitura de disco por leitura. Raiz que falha não fica guardada.
 */
const realRoots = new Map<string, Promise<string>>()

function realRootOf(root: string): Promise<string> {
  const key = path.resolve(root)
  let real = realRoots.get(key)
  if (!real) {
    real = realpath(key)
    realRoots.set(key, real)
    real.catch(() => realRoots.delete(key))
  }
  return real
}

/**
 * Caminho real do alvo ou, se ele não existe (arquivo novo), do ancestral mais próximo que existe. O realpath segue
 * links de pasta e de arquivo, então um link aponta para onde o sistema realmente levaria a leitura ou a escrita.
 * Link quebrado não tem destino a conferir: o realpath falha e a chamada é recusada.
 */
async function realExisting(full: string): Promise<string> {
  let current = full
  for (;;) {
    const exists = await lstat(current).then(() => true, () => false)
    if (exists) return realpath(current)
    const parent = path.dirname(current)
    if (parent === current) return current
    current = parent
  }
}

/** No Windows os nomes não diferenciam maiúsculas de minúsculas, como em `comparablePath`. */
const caseKey = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p)

function isWithin(child: string, parent: string): boolean {
  const prefix = parent.endsWith(path.sep) ? parent : parent + path.sep
  return child === parent || child.startsWith(prefix)
}

/**
 * `resolveInside` mais a conferência em disco: `resolveInside` só compara texto, então uma pasta-link dentro do
 * repositório que aponta para fora deixaria passar um arquivo que parece interno. Aqui o caminho real do alvo
 * (ou do ancestral, se o alvo não existe) precisa ficar dentro do caminho real da raiz. Assíncrona: é chamada no
 * caminho da interface, então não usa as versões síncronas de `fs`.
 */
export async function resolveInsideReal(root: string, relative: string): Promise<string> {
  const full = resolveInside(root, relative)
  const [realRoot, real] = await Promise.all([realRootOf(root), realExisting(full)])
  if (!isWithin(caseKey(real), caseKey(realRoot))) throw new Error(t('main.outsideRepository'))
  return full
}

/**
 * Como `resolveInsideReal`, mas confere só a pasta que contém o alvo, não o próprio alvo. Serve a quem usa
 * `lstat` no último componente: esse método nunca segue o link do arquivo, então um arquivo-link para fora (ou
 * quebrado) é tratado como o próprio link, sem ler o destino. A pasta, essa sim, é seguida pelo sistema
 * (`pasta-link/fora.txt` sairia do repositório), por isso ela continua presa à raiz. Raiz (`.`) não tem pasta
 * pai dentro do repositório: devolve direto.
 */
export async function resolveInsideParent(root: string, relative: string): Promise<string> {
  const full = resolveInside(root, relative)
  if (full === path.resolve(root)) return full
  const [realRoot, real] = await Promise.all([realRootOf(root), realExisting(path.dirname(full))])
  if (!isWithin(caseKey(real), caseKey(realRoot))) throw new Error(t('main.outsideRepository'))
  return full
}

/**
 * Abre um arquivo comum para leitura sem seguir link no último componente. O `lstat` que antecede a leitura e a
 * abertura são duas chamadas: se o arquivo for trocado por um link entre elas (TOCTOU), um `open` comum seguiria o
 * link para fora do repositório. Aqui a troca é barrada na própria abertura (`O_NOFOLLOW`, onde existe) e o
 * descritor ainda é conferido com `fstat`. `O_NONBLOCK` evita que um FIFO posto no lugar trave a abertura. Sem `O_NOFOLLOW` (Windows), um `lstat` depois da abertura estreita a
 * janela. Não é arquivo comum, ou virou link: lança.
 */
export async function openRegularFile(full: string): Promise<FileHandle> {
  const handle = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  try {
    const regular = (await handle.stat()).isFile() && (constants.O_NOFOLLOW ? true : (await lstat(full)).isFile())
    if (!regular) throw new Error(t('main.outsideRepository'))
    return handle
  } catch (error) {
    await handle.close()
    throw error
  }
}

/** Lê o arquivo inteiro pelo descritor aberto por `openRegularFile`. */
export async function readRegularFile(full: string): Promise<Buffer> {
  const handle = await openRegularFile(full)
  try {
    return await readFile(handle)
  } finally {
    await handle.close()
  }
}
