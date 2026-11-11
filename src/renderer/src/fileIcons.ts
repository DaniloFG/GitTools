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

/** Nome do ícone de pasta (aberta ou fechada); cai no ícone de arquivo comum se a tabela não o tiver. */
export function folderIconName(open: boolean): string {
  const name = open ? FOLDER_ICON_OPEN : FOLDER_ICON
  return FILE_ICON_SVGS[name] ? name : FILE_ICON_DEFAULT
}

/** Id do `<symbol>` de um ícone no sprite. */
export function iconSymbolId(name: string): string {
  return `fi-${name}`
}

/** Atributos da raiz que não servem ao símbolo (o namespace e o espaço XML). */
const DROPPED_ROOT_ATTRS = new Set(['xmlns', 'xmlns:xlink', 'xml:space'])

/**
 * Converte o SVG de um ícone em `<symbol>`. Todos os símbolos vivem no mesmo documento, então os ids
 * internos (gradientes, clipPaths) ganham o prefixo do ícone: três ícones usam `id="a"`, e o segundo
 * sobrescreveria o primeiro. `url(#…)` e `href="#…"` são reescritos junto, para continuarem apontando
 * para o mesmo elemento.
 */
export function symbolMarkup(name: string, svg: string): string {
  const root = /^<svg\b([^>]*)>/.exec(svg)
  if (!root) throw new Error(`ícone "${name}" sem <svg> na raiz`)
  const attrs: Record<string, string> = {}
  for (const m of root[1].matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[m[1]] = m[2]
  const inner = svg.slice(root[0].length).replace(/<\/svg>\s*$/, '')
  const prefix = `fi-${name}`
  const rewritten = inner
    .replace(/(\s)id="([^"]*)"/g, (_, sp: string, id: string) => `${sp}id="${prefix}-${id}"`)
    .replace(/url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g, (_, _q: string, id: string) => `url(#${prefix}-${id})`)
    .replace(/(\s(?:xlink:)?href)="#([^"]*)"/g, (_, attr: string, id: string) => `${attr}="#${prefix}-${id}"`)
  // Atributos do <svg> raiz que não são do símbolo (fill, clip-rule…) vão para um <g> em volta do conteúdo.
  const viewBox = attrs.viewBox ?? '0 0 24 24'
  const group = Object.entries(attrs).filter(([k]) => !DROPPED_ROOT_ATTRS.has(k) && k !== 'viewBox')
  const body = group.length ? `<g ${group.map(([k, v]) => `${k}="${v}"`).join(' ')}>${rewritten}</g>` : rewritten
  return `<symbol id="${iconSymbolId(name)}" viewBox="${viewBox}">${body}</symbol>`
}

/**
 * Só o que o sprite usa do DOM. Os tipos do navegador não existem na checagem do Node
 * (tsconfig.node.json, sem a lib "dom"), então o documento é acessado por `globalThis`.
 */
interface SpriteElement {
  setAttribute(name: string, value: string): void
  insertAdjacentHTML(position: 'beforeend', html: string): void
}
interface SpriteDocument {
  body: { appendChild(el: SpriteElement): unknown } | null
  documentElement: { appendChild(el: SpriteElement): unknown }
  createElementNS(ns: string, tag: string): SpriteElement
}

/** Ícones já inseridos no sprite (cada um entra uma vez só). */
const inserted = new Set<string>()
let sprite: SpriteElement | null = null

/**
 * Garante que o `<symbol>` do ícone existe no sprite compartilhado e devolve o id. Só entram os
 * ícones efetivamente usados na tela.
 *
 * O conteúdo inserido com `insertAdjacentHTML` é a tabela embutida do pacote de ícones, nunca dados
 * do repositório, então não há risco de injeção.
 */
export function ensureIconSymbol(name: string): string {
  const key = FILE_ICON_SVGS[name] ? name : FILE_ICON_DEFAULT
  const id = iconSymbolId(key)
  const doc = (globalThis as unknown as { document?: SpriteDocument }).document
  // Sem documento (testes em Node): só o id, nada a inserir.
  if (!doc || inserted.has(key)) return id
  if (!sprite) {
    // Escondido com width/height 0 e não com display:none: gradientes referenciados por <use> não
    // são desenhados dentro de display:none em alguns navegadores.
    sprite = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
    sprite.setAttribute('aria-hidden', 'true')
    sprite.setAttribute('width', '0')
    sprite.setAttribute('height', '0')
    sprite.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden')
    ;(doc.body ?? doc.documentElement).appendChild(sprite)
  }
  sprite.insertAdjacentHTML('beforeend', symbolMarkup(key, FILE_ICON_SVGS[key]))
  inserted.add(key)
  return id
}
