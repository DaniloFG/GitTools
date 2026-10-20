// Arrastar e soltar: o conteúdo arrastado fica guardado aqui, pois o navegador só
// expõe os dados do dataTransfer no momento do "drop", e os alvos precisam saber
// durante o "dragover" se aceitam o item.

export type DragPayload =
  | { type: 'branch'; name: string; remote: boolean }
  | { type: 'commits'; shas: string[]; label: string }
  | { type: 'commit-files'; sha: string; paths: string[] }
  | { type: 'files'; area: 'unstaged' | 'staged'; paths: string[] }

let current: DragPayload | null = null

export const MIME = 'application/x-gittools'

export function startDrag(event: React.DragEvent, payload: DragPayload, label: string) {
  current = payload
  event.dataTransfer.effectAllowed = 'copyMove'
  event.dataTransfer.setData(MIME, JSON.stringify(payload))
  event.dataTransfer.setData('text/plain', label)
  const ghost = document.createElement('div')
  ghost.className = 'drag-ghost'
  ghost.textContent = label
  document.body.appendChild(ghost)
  event.dataTransfer.setDragImage(ghost, 12, 12)
  setTimeout(() => ghost.remove(), 0)
}

export function endDrag() {
  current = null
}

export function currentDrag(): DragPayload | null {
  return current
}
