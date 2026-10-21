// Caminhos relativos ao repositório → caminhos absolutos do sistema, sem sair do repositório.

import path from 'node:path'
import { t } from '../shared/i18n'

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
