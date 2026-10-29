// Caminhos relativos ao repositório → caminhos absolutos do sistema, sem sair do repositório.

import { realpathSync } from 'node:fs'
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
