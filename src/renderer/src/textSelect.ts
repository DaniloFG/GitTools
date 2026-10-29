// Seleção de texto em elementos arrastáveis (linhas do histórico, branches, arquivos, linhas de conflito).
// Eles são `draggable`, então o navegador inicia um arrastar em vez de selecionar o texto. Enquanto a tecla
// Alt está pressionada, os arrastáveis deixam de ser arrastáveis e o arraste do mouse seleciona o texto.
// Fica num único ponto (aqui), e não em cada componente.

/** Liga o modo Alt; devolve a função que o desliga. */
export function installAltTextSelection(): () => void {
  const root = document.documentElement
  /** Elementos que estavam arrastáveis e foram desligados enquanto o Alt está pressionado. */
  const suspended = new Set<HTMLElement>()
  let active = false

  const suspend = (el: HTMLElement) => {
    if (el.draggable) {
      el.draggable = false
      suspended.add(el)
    }
  }

  const setActive = (next: boolean) => {
    if (next === active) return
    active = next
    if (active) {
      root.dataset.altSelect = ''
      document.querySelectorAll<HTMLElement>('[draggable="true"]').forEach(suspend)
      return
    }
    delete root.dataset.altSelect
    for (const el of suspended) {
      // Um elemento que o React já redesenhou sem o atributo não deve voltar a ser arrastável por aqui.
      if (el.isConnected && el.getAttribute('draggable') === 'false') el.draggable = true
    }
    suspended.clear()
  }

  // O Alt chega como tecla (altKey em todos os eventos de teclado); o soltar dele vem com altKey falso.
  const onKey = (e: KeyboardEvent) => setActive(e.altKey)
  // Um elemento montado com o Alt já pressionado ainda é arrastável: o arrastar dele é cancelado aqui.
  const onDragStart = (e: DragEvent) => {
    if (active) e.preventDefault()
  }
  // Um clique com Alt garante que o elemento do clique esteja desligado antes de o mouse se mover.
  const onMouseDown = (e: MouseEvent) => {
    if (!e.altKey || !(e.target instanceof Element)) return
    setActive(true)
    const el = e.target.closest<HTMLElement>('[draggable="true"]')
    if (el) suspend(el)
  }
  const onBlur = () => setActive(false)

  window.addEventListener('keydown', onKey, true)
  window.addEventListener('keyup', onKey, true)
  window.addEventListener('mousedown', onMouseDown, true)
  window.addEventListener('dragstart', onDragStart, true)
  window.addEventListener('blur', onBlur)
  return () => {
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('keyup', onKey, true)
    window.removeEventListener('mousedown', onMouseDown, true)
    window.removeEventListener('dragstart', onDragStart, true)
    window.removeEventListener('blur', onBlur)
    setActive(false)
  }
}
