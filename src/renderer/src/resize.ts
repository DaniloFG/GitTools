// Arrasto das alças de redimensionamento (divisórias, bordas de diálogos, colunas).

/**
 * Acompanha o arrasto de uma alça de redimensionamento até o botão ser solto.
 * `onMove` recebe o evento e o deslocamento desde o início.
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
  const move = (event: PointerEvent) => onMove(event, event.clientX - x0, event.clientY - y0)
  const end = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    window.removeEventListener('blur', end)
    body.classList.remove('resizing')
    body.style.cursor = ''
    onEnd?.()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
  window.addEventListener('blur', end)
}
