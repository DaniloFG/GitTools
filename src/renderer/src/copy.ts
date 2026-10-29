// Copiar texto das telas: área de transferência (com plano B para o webview do VS Code), Ctrl+C na linha
// focada e os itens "Copiar ..." do menu de contexto. Elementos dizem o que copiam com `data-copy` (o
// texto) e `data-copy-what` (line, text, path, sha ou message, que dá o nome do item no menu).

import type { ToastKind } from './context'
import type { MenuItem, MenuState } from './components/ContextMenu'
import { t, type MessageKey } from './i18n'

export type CopyWhat = 'line' | 'text' | 'path' | 'sha' | 'message'

const LABEL: Record<CopyWhat, MessageKey> = {
  line: 'copy.line',
  text: 'copy.text',
  path: 'copy.path',
  sha: 'copy.sha',
  message: 'copy.message'
}

type Notify = (kind: ToastKind, text: string) => void

/** Copia para a área de transferência; true se deu certo. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return legacyCopy(text)
  }
}

/**
 * Plano B para quando a API assíncrona é negada (o webview do VS Code faz isso em alguns casos):
 * seleciona um campo escondido e pede a cópia ao navegador.
 */
function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  return ok
}

/** Copia e avisa o resultado com um toast (quando há onde mostrar). */
export async function copyAndNotify(text: string, notify?: Notify): Promise<boolean> {
  const ok = await copyText(text)
  notify?.(ok ? 'info' : 'error', t(ok ? 'copy.copied' : 'copy.failed'))
  return ok
}

/** Item de menu que copia `value`, com o nome conforme o que é copiado. */
export function copyItem(what: CopyWhat, value: string, notify?: Notify): MenuItem {
  return { label: t(LABEL[what]), onClick: () => void copyAndNotify(value, notify) }
}

/** Campos de texto: neles Ctrl+C e o botão direito são do próprio campo. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
}

/** Texto selecionado na página (vazio se nada estiver selecionado). */
export function selectionText(): string {
  return window.getSelection()?.toString() ?? ''
}

/** Itens de cópia para o que está sob `target`: a seleção de texto e o `data-copy` do elemento mais próximo. */
export function copyItemsAt(target: EventTarget | null, notify?: Notify): MenuItem[] {
  if (!(target instanceof Element) || isTyping(target)) return []
  const items: MenuItem[] = []
  const selected = selectionText()
  if (selected.trim()) items.push({ label: t('copy.selection'), onClick: () => void copyAndNotify(selected, notify) })
  const el = target.closest<HTMLElement>('[data-copy]')
  if (el) items.push(copyItem((el.dataset.copyWhat as CopyWhat) || 'text', el.dataset.copy ?? '', notify))
  return items
}

/**
 * Liga a cópia em toda a tela. Ctrl+C sem texto selecionado copia a linha focada (`data-copy`). O botão
 * direito num lugar sem menu próprio mostra os itens de cópia (`show` recebe o menu). Devolve a função que desliga.
 */
export function installCopy({ show, notify }: { show(menu: MenuState): void; notify?: Notify }): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'c') return
    if (isTyping(e.target) || selectionText()) return
    const row = document.activeElement?.closest<HTMLElement>('[data-copy]')
    if (!row) return
    e.preventDefault()
    void copyAndNotify(row.dataset.copy ?? '', notify)
  }
  const onContext = (e: MouseEvent) => {
    const items = copyItemsAt(e.target, notify)
    if (!items.length) return
    e.preventDefault()
    show({ x: e.clientX, y: e.clientY, items })
  }
  window.addEventListener('keydown', onKey)
  window.addEventListener('contextmenu', onContext)
  return () => {
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('contextmenu', onContext)
  }
}
