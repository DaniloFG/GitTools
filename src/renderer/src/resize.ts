// Arrasto das alças de redimensionamento (divisórias, bordas de diálogos, colunas).

import { beginLayoutBatch, endLayoutBatch } from './layout'

/**
 * Acompanha o arrasto de uma alça de redimensionamento até o botão ser solto.
 * `onMove` recebe o evento e o deslocamento desde o início. Entrega no máximo um movimento por quadro (o mais
 * recente) e grava o layout no disco só ao soltar, em vez de a cada movimento do mouse.
 */
export function startResize(
  e: React.PointerEvent,
  cursor: string,
  onMove: (event: PointerEvent, dx: number, dy: number) => void,
  onEnd?: () => void
) {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  const x0 = e.clientX
  const y0 = e.clientY
  const body = document.body
  body.classList.add('resizing')
  body.style.cursor = cursor
  beginLayoutBatch()
  let frame = 0
  let latest: PointerEvent | null = null
  const deliver = () => {
    frame = 0
    const event = latest
    if (!event) return
    latest = null
    onMove(event, event.clientX - x0, event.clientY - y0)
  }
  const move = (event: PointerEvent) => {
    latest = event
    if (!frame) frame = requestAnimationFrame(deliver)
  }
  const end = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    window.removeEventListener('blur', end)
    // O quadro agendado não vale mais: o último movimento é entregue já, antes de terminar.
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    try {
      deliver()
    } finally {
      body.classList.remove('resizing')
      body.style.cursor = ''
      try {
        onEnd?.()
      } finally {
        // Fechar o lote grava o valor final de cada chave, uma vez.
        endLayoutBatch()
      }
    }
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
  window.addEventListener('blur', end)
}
