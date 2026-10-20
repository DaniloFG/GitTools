import { useState } from 'react'
import { currentDrag, endDrag, MIME, type DragPayload } from './dnd'

/** Torna um elemento alvo de "soltar". Retorna props para espalhar no elemento e se está destacado. */
export function useDrop(accept: (payload: DragPayload) => boolean, onDrop: (payload: DragPayload) => void) {
  const [over, setOver] = useState(false)

  const read = (e: React.DragEvent): DragPayload | null => {
    const live = currentDrag()
    if (live) return live
    try {
      return JSON.parse(e.dataTransfer.getData(MIME)) as DragPayload
    } catch {
      return null
    }
  }

  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        const payload = currentDrag()
        if (!payload || !accept(payload)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
        if (!over) setOver(true)
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      },
      onDrop: (e: React.DragEvent) => {
        setOver(false)
        const payload = read(e)
        if (!payload || !accept(payload)) return
        e.preventDefault()
        e.stopPropagation()
        endDrag()
        onDrop(payload)
      }
    }
  }
}
