import { useEffect, useRef } from 'react'
import { rulerMarks, scrollTargetFor, viewportBox, type RulerMark, type RulerRow } from '../changeRuler'

/** Largura da faixa, em pixels: fica à esquerda da barra de rolagem, sobre o conteúdo. */
const WIDTH = 10
/** Altura mínima de cada marca na faixa, em pixels da tela (uma linha isolada continua visível). */
const MIN_MARK_PX = 3

// Níveis de trabalho, do mais barato ao mais caro. Pedidos no mesmo quadro ficam com o maior.
/** Só a posição da faixa e a área visível (rolagem). */
const VIEW = 1
/** Redesenha o canvas (mudou o tamanho da régua). */
const DRAW = 2
/** Relê as marcas (mudou o conteúdo, as marcas ou os blocos). */
const GEOMETRY = 3

interface Props {
  /** Seletor do elemento que rola, procurado dentro do pai da régua (ou o ancestral rolável mais próximo). */
  scroller: string
  /**
   * Modo por dados (o diff): marcas já em frações (0 a 1) da altura do conteúdo. A régua não lê nenhuma linha
   * do DOM; só a posição de rolagem do elemento que rola.
   */
  marks?: readonly RulerMark[]
  /**
   * Modo por DOM (editor de conflitos, poucos blocos): seletor dos blocos marcados (cada um com data-kind).
   * Eles são medidos de novo só quando `version` muda ou o conteúdo muda de tamanho, nunca por MutationObserver.
   */
  selector?: string
  /** Muda quando os blocos do modo por DOM mudam de tipo ou de texto (o tamanho é observado sozinho). */
  version?: unknown
}

interface Ctl {
  update: (marks: readonly RulerMark[] | undefined, selector: string | undefined) => void
  request: (level: number) => void
}

function isScrollable(el: HTMLElement): boolean {
  const overflow = getComputedStyle(el).overflowY
  return (overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight + 1
}

/** Elemento que rola: o indicado dentro do contêiner, ou o ancestral rolável mais próximo. */
function findScroller(host: HTMLElement, selector: string): HTMLElement | null {
  const own = host.querySelector<HTMLElement>(selector)
  if (own && isScrollable(own)) return own
  for (let el = host.parentElement; el; el = el.parentElement) if (isScrollable(el)) return el
  return null
}

const pct = (fraction: number) => `${fraction * 100}%`

/**
 * Régua de alterações: uma faixa estreita ao lado da barra de rolagem, com uma marca colorida para cada
 * alteração (como o "overview ruler" do VS Code). Mostra a área visível, rola ao clicar e some sem rolagem.
 * Deve ser filho direto do contêiner que tem as linhas; o elemento que rola é achado a partir dele.
 *
 * A faixa não tem estado de React: posição, área visível e marcas são escritas direto no elemento, dentro de
 * um quadro de animação. Assim a rolagem não passa pelo React.
 */
export function ChangeRuler({ scroller, marks, selector, version }: Props) {
  const anchor = useRef<HTMLSpanElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const thumb = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const scrollerRef = useRef<HTMLElement | null>(null)
  const ctl = useRef<Ctl | null>(null)

  // Ouvintes e observador do elemento que rola. Montados de novo só quando o seletor do elemento muda.
  useEffect(() => {
    const host = anchor.current?.parentElement
    const box = track.current
    const area = thumb.current
    const cv = canvas.current
    if (!host || !box || !area || !cv) return
    const ctx = cv.getContext('2d')

    let el: HTMLElement | null = null
    let observed: Element[] = []
    let inputMarks: readonly RulerMark[] | undefined
    let inputSelector: string | undefined
    // Marcas em frações do conteúdo, as que o canvas desenha.
    let source: readonly RulerMark[] = []
    let pending = 0
    let raf = 0

    /** Modo por DOM: mede os blocos. Todas as leituras vêm antes de qualquer conta. */
    const measureBlocks = (scrollEl: HTMLElement, sel: string): RulerMark[] => {
      // Só os blocos dentro do elemento que rola: o editor de conflitos repete os blocos em cada painel.
      const nodes = [...scrollEl.querySelectorAll<HTMLElement>(sel)]
      const origin = scrollEl.getBoundingClientRect().top + scrollEl.clientTop - scrollEl.scrollTop
      // Leituras em lote (uma passada, sem escrever no DOM no meio): o navegador calcula o layout uma vez.
      const rects = nodes.map((n) => n.getBoundingClientRect())
      const rows: RulerRow[] = rects.map((r, i) => ({ top: r.top - origin, height: r.height, kind: nodes[i].dataset.kind ?? 'mod' }))
      const total = scrollEl.scrollHeight
      return rulerMarks(rows, total, (MIN_MARK_PX * total) / Math.max(1, scrollEl.clientHeight))
    }

    /** Relê as marcas (só quando o conteúdo ou as marcas mudam). */
    const measure = () => {
      attach(findScroller(host, scroller))
      const s = el
      if (!s) source = []
      else if (inputMarks) source = inputMarks
      else if (inputSelector) source = measureBlocks(s, inputSelector)
      else source = []
    }

    /** Posição da faixa e área visível: só leituras e escritas de estilo, nenhuma lista. */
    const place = () => {
      const s = el
      if (!s || !s.isConnected || source.length === 0 || s.scrollHeight <= s.clientHeight + 1) {
        box.hidden = true
        return
      }
      box.hidden = false
      const r = s.getBoundingClientRect()
      // clientWidth já deixa de fora a barra de rolagem, então a faixa fica logo à esquerda dela.
      box.style.left = `${r.left + s.clientLeft + s.clientWidth - WIDTH}px`
      box.style.top = `${r.top + s.clientTop}px`
      box.style.height = `${s.clientHeight}px`
      const v = viewportBox(s.scrollTop, s.clientHeight, s.scrollHeight)
      area.style.top = pct(v.top)
      area.style.height = pct(v.height)
    }

    /** Desenha as marcas no canvas. Uma leitura das cores por desenho, não uma por marca. */
    const draw = () => {
      const s = el
      if (!ctx || !s) return
      const h = s.clientHeight
      const dpr = window.devicePixelRatio || 1
      // Redimensionar o canvas limpa o contexto, por isso só quando o tamanho muda.
      const pxW = Math.round(WIDTH * dpr)
      const pxH = Math.max(1, Math.round(h * dpr))
      if (cv.width !== pxW) cv.width = pxW
      if (cv.height !== pxH) cv.height = pxH
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, WIDTH, h)
      const cs = getComputedStyle(box)
      const color: Record<RulerMark['kind'], string> = {
        add: cs.getPropertyValue('--ruler-add'),
        del: cs.getPropertyValue('--ruler-del'),
        mod: cs.getPropertyValue('--ruler-mod'),
        conflict: cs.getPropertyValue('--ruler-conflict'),
        resolved: cs.getPropertyValue('--ruler-resolved')
      }
      for (const m of source) {
        const height = Math.min(h, Math.max(m.height * h, MIN_MARK_PX))
        const top = Math.min(Math.max(0, m.top * h), h - height)
        ctx.fillStyle = color[m.kind]
        // Retângulo simples (sem canto arredondado): o canvas não precisa de um caminho por marca.
        ctx.fillRect(2, top, WIDTH - 4, height)
      }
    }

    // Um quadro por vez: os pedidos que chegam antes do quadro se juntam no mais caro.
    const frame = () => {
      raf = 0
      const level = pending
      pending = 0
      if (level >= GEOMETRY) measure()
      const wasHidden = box.hidden
      place()
      if (level >= DRAW || (wasHidden && !box.hidden)) draw()
    }

    const request = (level: number) => {
      pending = Math.max(pending, level)
      if (!raf) raf = requestAnimationFrame(frame)
    }

    const onScroll = () => request(VIEW)
    // Tamanho do elemento que rola (DRAW) e do conteúdo dele (GEOMETRY, pode mudar as marcas do DOM).
    const ro = new ResizeObserver((entries) => request(entries.some((e) => e.target !== el) ? GEOMETRY : DRAW))

    // Troca os ouvintes e o observador só quando o elemento que rola ou o primeiro filho mudam.
    const attach = (next: HTMLElement | null) => {
      if (next !== el) {
        el?.removeEventListener('scroll', onScroll)
        next?.addEventListener('scroll', onScroll, { passive: true })
        el = next
        scrollerRef.current = next
      }
      const want: Element[] = next ? [next, ...(next.firstElementChild ? [next.firstElementChild] : [])] : []
      if (want.length !== observed.length || want.some((w, i) => w !== observed[i])) {
        ro.disconnect()
        for (const w of want) ro.observe(w)
        observed = want
      }
    }

    ctl.current = {
      update: (m, s) => {
        inputMarks = m
        inputSelector = s
        request(GEOMETRY)
      },
      request
    }
    return () => {
      cancelAnimationFrame(raf)
      raf = 0
      ro.disconnect()
      el?.removeEventListener('scroll', onScroll)
      el = null
      observed = []
      scrollerRef.current = null
      ctl.current = null
    }
  }, [scroller])

  // Marcas novas, blocos novos ou `version` novo: relê as marcas. `version` existe só para isto.
  useEffect(() => {
    ctl.current?.update(marks, selector)
  }, [scroller, marks, selector, version])

  /** Clique na faixa: centraliza na tela a posição clicada. */
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
      {/* Começa escondida; a posição e a visibilidade são escritas direto no elemento (ver place). */}
      <div ref={track} className="change-ruler" hidden onMouseDown={jump} aria-hidden>
        <div ref={thumb} className="change-ruler-view" />
        <canvas ref={canvas} />
      </div>
    </>
  )
}
