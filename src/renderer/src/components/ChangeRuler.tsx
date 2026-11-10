import { useEffect, useRef, useState } from 'react'
import { rulerMarks, scrollTargetFor, viewportBox, type RulerMark, type RulerRow } from '../changeRuler'

/** Largura da faixa, em pixels: fica à esquerda da barra de rolagem, sobre o conteúdo. */
const WIDTH = 10
/** Altura mínima de cada marca na faixa, em pixels da tela (uma linha isolada continua visível). */
const MIN_MARK_PX = 3

interface Props {
  /** Seletor das linhas ou blocos marcados. Cada um traz o tipo em data-kind (add, del, mod, conflict, resolved). */
  selector: string
  /** Seletor do elemento que rola, dentro do contêiner. Sem ele (ou se não rolar), usa o ancestral rolável mais próximo. */
  scroller?: string
}

/** Estado desenhado: posição da faixa na tela, marcas e área visível. */
interface View {
  left: number
  top: number
  height: number
  marks: RulerMark[]
  viewport: { top: number; height: number }
}

function isScrollable(el: HTMLElement): boolean {
  const overflow = getComputedStyle(el).overflowY
  return (overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight + 1
}

/** Elemento que rola: o indicado dentro do contêiner, ou o ancestral rolável mais próximo. */
function findScroller(host: HTMLElement, selector?: string): HTMLElement | null {
  const own = selector ? host.querySelector<HTMLElement>(selector) : null
  if (own && isScrollable(own)) return own
  for (let el = host.parentElement; el; el = el.parentElement) if (isScrollable(el)) return el
  return null
}

const pct = (fraction: number) => `${fraction * 100}%`

/**
 * Régua de alterações: uma faixa estreita ao lado da barra de rolagem, com uma marca colorida para cada
 * alteração (como o "overview ruler" do VS Code). Mostra a área visível, rola ao clicar e some sem rolagem.
 * Deve ser filho direto do contêiner que tem as linhas; o elemento que rola é achado a partir dele.
 */
export function ChangeRuler({ selector, scroller: scrollerSelector }: Props) {
  const anchor = useRef<HTMLSpanElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLElement | null>(null)
  const marksRef = useRef<RulerMark[]>([])
  const [view, setView] = useState<View | null>(null)

  useEffect(() => {
    const host = anchor.current?.parentElement
    if (!host) return
    let raf = 0
    let rebuildAll = false

    /** Só a posição da faixa e a área visível (barato: roda a cada quadro de scroll). */
    const place = () => {
      const el = scrollerRef.current
      const marks = marksRef.current
      if (!el || !el.isConnected || marks.length === 0 || el.scrollHeight <= el.clientHeight + 1) {
        setView(null)
        return
      }
      const box = el.getBoundingClientRect()
      setView({
        // clientWidth já deixa de fora a barra de rolagem, então a faixa fica logo à esquerda dela.
        left: box.left + el.clientLeft + el.clientWidth - WIDTH,
        top: box.top + el.clientTop,
        height: el.clientHeight,
        marks,
        viewport: viewportBox(el.scrollTop, el.clientHeight, el.scrollHeight)
      })
    }

    /** Relê as linhas e recalcula as marcas (quando o conteúdo ou o tamanho mudam). */
    const rebuild = () => {
      const el = findScroller(host, scrollerSelector)
      scrollerRef.current = el
      if (el) {
        ro.observe(el)
        const box = el.getBoundingClientRect()
        // Posição de uma linha no conteúdo que rola: a distância ao topo do conteúdo, não da tela.
        const origin = box.top + el.clientTop - el.scrollTop
        const rows: RulerRow[] = [...host.querySelectorAll<HTMLElement>(selector)].map((row) => {
          const r = row.getBoundingClientRect()
          return { top: r.top - origin, height: r.height, kind: row.dataset.kind ?? 'mod' }
        })
        const total = el.scrollHeight
        marksRef.current = rulerMarks(rows, total, (MIN_MARK_PX * total) / Math.max(1, el.clientHeight))
      } else {
        marksRef.current = []
      }
      place()
    }

    // Agrupa os pedidos de atualização num único quadro de animação.
    const queue = (all: boolean) => {
      rebuildAll = rebuildAll || all
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const full = rebuildAll
        rebuildAll = false
        if (full) rebuild()
        else place()
      })
    }

    // Conteúdo novo ou classes mudadas. As mudanças da própria faixa não contam, para não entrar em laço.
    const mo = new MutationObserver((records) => {
      if (records.every((r) => track.current?.contains(r.target))) return
      queue(true)
    })
    mo.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'data-kind', 'data-change'] })
    const ro = new ResizeObserver(() => queue(true))
    ro.observe(host)
    const onScroll = () => queue(false)
    const onResize = () => queue(true)
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('resize', onResize)

    queue(true)
    return () => {
      cancelAnimationFrame(raf)
      mo.disconnect()
      ro.disconnect()
      window.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', onResize)
    }
  }, [selector, scrollerSelector])

  /** Clique (ou arrasto parado) na faixa: centraliza na tela a posição clicada. */
  const jump = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = scrollerRef.current
    if (!el) return
    e.preventDefault()
    const box = e.currentTarget.getBoundingClientRect()
    const fraction = (e.clientY - box.top) / Math.max(1, box.height)
    el.scrollTo({ top: scrollTargetFor(fraction, el.scrollHeight, el.clientHeight), behavior: 'smooth' })
  }

  return (
    <>
      <span ref={anchor} hidden />
      {view && (
        <div ref={track} className="change-ruler" style={{ left: view.left, top: view.top, height: view.height }} onMouseDown={jump} aria-hidden>
          <div className="change-ruler-view" style={{ top: pct(view.viewport.top), height: pct(view.viewport.height) }} />
          {view.marks.map((m, i) => (
            <div key={i} className={`change-ruler-mark ${m.kind}`} style={{ top: pct(m.top), height: pct(m.height) }} />
          ))}
        </div>
      )}
    </>
  )
}
