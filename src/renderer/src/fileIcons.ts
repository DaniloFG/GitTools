// Ícone de cada tipo de arquivo (estilo Material Icon Theme). A tabela vem de fileIcons.generated.ts.

import {
  FILE_ICON_DEFAULT,
  FILE_ICON_SVGS,
  FOLDER_ICON,
  FOLDER_ICON_OPEN,
  ICON_BY_EXTENSION,
  ICON_BY_FILENAME,
  LIGHT_ICON_BY_EXTENSION,
  LIGHT_ICON_BY_FILENAME
} from './fileIcons.generated'

type Table = Record<string, string>

/** Procura pelo nome inteiro ("package.json") e, depois, pelos sufixos ("test.ts", depois "ts"). */
function lookup(base: string, names: Table, extensions: Table): string | undefined {
  if (names[base]) return names[base]
  const parts = base.split('.')
  for (let i = 1; i < parts.length; i++) {
    const found = extensions[parts.slice(i).join('.')]
    if (found) return found
  }
  return undefined
}

/** Nome do ícone de um arquivo; `light` prefere as variantes para temas claros. */
export function iconNameFor(path: string, light = false): string {
  const base = (path.split('/').pop() ?? path).toLowerCase()
  const found = (light ? lookup(base, LIGHT_ICON_BY_FILENAME, LIGHT_ICON_BY_EXTENSION) : undefined) ?? lookup(base, ICON_BY_FILENAME, ICON_BY_EXTENSION)
  return found && FILE_ICON_SVGS[found] ? found : FILE_ICON_DEFAULT
}

/** SVG do ícone (do pacote Material Icon Theme, sem alterações além de espaços). */
export const iconSvg = (name: string): string => FILE_ICON_SVGS[name] ?? FILE_ICON_SVGS[FILE_ICON_DEFAULT]

export const folderIconSvg = (open: boolean): string => FILE_ICON_SVGS[open ? FOLDER_ICON_OPEN : FOLDER_ICON] ?? FILE_ICON_SVGS[FILE_ICON_DEFAULT]
