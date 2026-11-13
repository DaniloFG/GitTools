import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type UIEvent,
  type UIEventHandler
} from 'react'
import { anchoredScrollTop, buildOffsets, indexAt, nextRange, sameRange, scrollToReveal, type RowRange } from '../virtual'

/** Altura considerada antes do primeiro ResizeObserver responder: uma tela típica. */
const FALLBACK_VIEWPORT = 1200
const DEFAULT_OVERSCAN = 600
/** Diferença (px) que conta como mudança de altura: evita novo render por arredondamento de subpixel. */
const EPSILON = 0.5

export interface VirtualListProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  count: number
  /** Altura fixa das linhas comuns (o histórico usa 30). */
  rowHeight: number
  /** Chave estável do item (ex.: sha). Deve ser estável (useCallback) ou mudar só quando os dados mudarem. */
  keyOf(index: number): string
  renderItem(index: number): ReactNode
  /**
   * Itens de altura variável (ex.: commit com arquivos abertos): são medidos. Os demais têm `rowHeight`.
   * Deve ser estável (useCallback): cada mudança de identidade recalcula todas as posições.
   */
  isVariable?(index: number): boolean
  /** Margem em px montada acima e abaixo da área visível. Padrão 600. */
  overscan?: number
  header?: ReactNode
  footer?: ReactNode
  /** Altura coberta no topo por uma linha sticky do header, para a rolagem por teclado não esconder o item. */
  stickyTop?: number
  /**
   * Quando as posições mudam sem o usuário ter rolado (alturas medidas depois, chaves trocadas, contagem diferente),
   * mantém no topo o mesmo ponto do mesmo item, em vez de deixar o scrollTop em pixels e o conteúdo andar.
   * Opt-in: o diff usa porque alterna a quebra de linha, que muda as alturas de todos os blocos de uma vez.
   */
  anchorTop?: boolean
}

export interface VirtualListHandle {
  /** Rola o mínimo para o item ficar à vista (como scrollIntoView 'nearest'), calculado dos dados, sem medir linhas. */
  scrollToIndex(index: number): void
  readonly element: HTMLDivElement | null
}

/** Só a faixa perto da área visível fica no DOM: o resto é um espaçador com a altura exata. */
function fallbackRange(offsets: Float64Array): RowRange {
  // indexAt devolve -1 para lista vazia, então o cálculo dá 0 sem caso especial.
  return { start: 0, end: Math.min(offsets.length - 1, indexAt(offsets, FALLBACK_VIEWPORT) + 1) }
}

/**
 * Lista em janela, em fluxo normal (sem posicionamento absoluto): as linhas ficam filhas diretas do contêiner,
 * e o `header` (ex.: uma linha `position: sticky`) também. Por isso o contêiner precisa rolar (overflow-y).
 *
 * Desempenho: a rolagem só agenda um quadro (rAF), e o estado só muda quando a faixa montada muda. Itens de
 * altura variável são medidos por um ResizeObserver compartilhado, guardados por chave (não por índice),
 * e só disparam nova renderização quando alguma altura muda.
 */
export const VirtualList = forwardRef<VirtualListHandle, VirtualListProps>(function VirtualList(props, handleRef) {
  // `count` sai do rest para não virar atributo do <div>; a lista real é `offsets`.
  const { count: itemCount, rowHeight, keyOf, renderItem, isVariable, overscan = DEFAULT_OVERSCAN, header, footer, stickyTop = 0, anchorTop = false, onScroll, style, ...rest } = props

  const containerRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  /** Alturas medidas, por chave do item. Só itens de altura variável são guardados. */
  const heights = useRef(new Map<string, number>())
  const [version, setVersion] = useState(0)
  const offsets = useMemo(
    () => buildOffsets(itemCount, rowHeight, isVariable ? (i) => (isVariable(i) ? heights.current.get(keyOf(i)) : undefined) : undefined),
    // `version` existe só para refazer as posições quando uma altura medida muda.
    [itemCount, rowHeight, keyOf, isVariable, version] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const count = offsets.length - 1

  const [range, setRange] = useState<RowRange>(() => fallbackRange(offsets))
  // Espelhos em ref: a rolagem e a medição recalculam a faixa sem ler o DOM de novo.
  const rangeRef = useRef(range)
  const offsetsRef = useRef(offsets)
  const overscanRef = useRef(overscan)
  const rowHeightRef = useRef(rowHeight)
  const scrollRef = useRef(0)
  const baseRef = useRef(0)
  const viewportRef = useRef(0)
  const frameRef = useRef(0)
  const onScrollRef = useRef<UIEventHandler<HTMLDivElement> | undefined>(onScroll)
  const itemObserver = useRef<ResizeObserver | null>(null)
  const observed = useRef(new Set<HTMLElement>())

  /** Só mexe no estado se a faixa mudou: a rolagem quase sempre não muda o que está montado. */
  const commit = useCallback((next: RowRange) => {
    if (sameRange(rangeRef.current, next)) return
    rangeRef.current = next
    setRange(next)
  }, [])

  /** Calcula a faixa com o último estado conhecido. Não lê o DOM. A folga (nextRange) evita mexer a cada item. */
  const recompute = useCallback(() => {
    const o = offsetsRef.current
    commit(
      viewportRef.current > 0
        ? nextRange(o, rangeRef.current, scrollRef.current - baseRef.current, viewportRef.current, overscanRef.current)
        : fallbackRange(o)
    )
  }, [commit])

  /** Lê o DOM (uma vez, sem escrever no meio) e recalcula. Chamada no quadro de rolagem e na mudança de tamanho. */
  const sync = useCallback(() => {
    const el = containerRef.current
    const spacer = topRef.current
    if (!el || !spacer) return
    scrollRef.current = el.scrollTop
    viewportRef.current = el.clientHeight
    baseRef.current = spacer.offsetTop
    recompute()
  }, [recompute])

  // Mudou a lista (ex.: pesquisa encolheu) ou as alturas: recalcula antes de pintar, com os últimos valores conhecidos.
  useLayoutEffect(() => {
    const prev = offsetsRef.current
    offsetsRef.current = offsets
    // Âncora do topo: usa a rolagem e a base conhecidas (não o DOM, que o navegador já pode ter limitado ao novo
    // máximo quando a lista encolheu). Uma escrita e uma leitura por mudança de posições, nunca por evento de rolagem.
    if (anchorTop && prev !== offsets) {
      const el = containerRef.current
      const current = scrollRef.current
      const target = anchoredScrollTop(prev, offsets, current, baseRef.current)
      if (el && target !== current) {
        el.scrollTop = target
        // Relê o valor aceito: o navegador limita ao máximo rolável.
        scrollRef.current = el.scrollTop
      }
    }
    overscanRef.current = overscan
    rowHeightRef.current = rowHeight
    recompute()
  }, [offsets, overscan, rowHeight, anchorTop, recompute])

  useLayoutEffect(() => {
    onScrollRef.current = onScroll
  })

  // Um ResizeObserver para o próprio contêiner (altura da área visível) e um para os itens variáveis.
  useLayoutEffect(() => {
    const ro = new ResizeObserver((entries) => {
      let changed = false
      for (const entry of entries) {
        const el = entry.target as HTMLElement
        const key = el.dataset.virtualKey
        if (key === undefined) continue
        // borderBoxSize é a altura que ocupa no fluxo; contentRect é a alternativa para navegadores antigos.
        const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
        const prev = heights.current.get(key) ?? rowHeightRef.current
        if (Math.abs(prev - h) > EPSILON) {
          heights.current.set(key, h)
          changed = true
        }
      }
      // Só renderiza se alguma altura de fato mudou.
      if (changed) setVersion((v) => v + 1)
    })
    itemObserver.current = ro
    const set = observed.current
    return () => {
      ro.disconnect()
      itemObserver.current = null
      set.clear()
    }
  }, [])

  // Após cada render, observa os itens variáveis montados e desobserva os que saíram do DOM.
  useLayoutEffect(() => {
    const el = containerRef.current
    const ro = itemObserver.current
    if (!el || !ro) return
    // Só filhos diretos: uma lista aninhada dentro de um item não pode contar como deste contêiner.
    const present = new Set<HTMLElement>(el.querySelectorAll<HTMLElement>(':scope > [data-virtual-key]'))
    for (const node of [...observed.current]) {
      if (present.has(node)) continue
      ro.unobserve(node)
      observed.current.delete(node)
    }
    for (const node of present) {
      if (observed.current.has(node)) continue
      ro.observe(node)
      observed.current.add(node)
    }
  })

  // Rolagem e tamanho do contêiner. O listener é nativo e passivo; o evento só agenda um quadro.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const frame = () => {
      frameRef.current = 0
      sync()
    }
    const onNativeScroll = (e: Event) => {
      // O consumidor recebe o mesmo evento que receberia do React; o tipo é só uma conversão.
      onScrollRef.current?.(e as unknown as UIEvent<HTMLDivElement>)
      if (frameRef.current === 0) frameRef.current = requestAnimationFrame(frame)
    }
    el.addEventListener('scroll', onNativeScroll, { passive: true })
    const resize = new ResizeObserver(() => sync())
    resize.observe(el)
    return () => {
      el.removeEventListener('scroll', onNativeScroll)
      resize.disconnect()
      cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
    }
  }, [sync])

  /**
   * Elemento que tinha o foco dentro do contêiner. Quando a linha focada sai da janela, o React a desmonta e o
   * navegador põe o foco no `body`, e as setas param de chegar ao contêiner. Então, após cada desenho, o foco volta
   * ao contêiner, mas só se o elemento guardado foi desmontado (`!isConnected`) e o foco caiu no `body`.
   * Um clique numa área sem foco fora da lista não desmonta nada, então não rouba o foco numa atualização.
   * `focusout` sem destino (`relatedTarget` nulo) mantém a referência: é o caso da remoção.
   * Limite: se o usuário clica fora e depois rola a lista até a linha clicada sair da janela, o foco volta à lista.
   */
  const focused = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onFocusIn = (e: FocusEvent) => {
      focused.current = e.target as HTMLElement
    }
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null
      if (next && !el.contains(next)) focused.current = null
    }
    el.addEventListener('focusin', onFocusIn)
    el.addEventListener('focusout', onFocusOut)
    return () => {
      el.removeEventListener('focusin', onFocusIn)
      el.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  // Sem lista de dependências de propósito: a remoção de uma linha focada acontece em qualquer desenho.
  useLayoutEffect(() => {
    const el = containerRef.current
    const lost = focused.current
    if (!el || !lost || lost.isConnected) return
    const active = document.activeElement
    if (active === null || active === document.body) {
      focused.current = null
      // O foco no contêiner dispara `focusin` e volta a guardá-lo.
      el.focus({ preventScroll: true })
    }
  })

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = containerRef.current
      const spacer = topRef.current
      if (!el || !spacer) return
      const current = el.scrollTop
      const base = spacer.offsetTop
      const viewport = el.clientHeight
      const target = scrollToReveal(offsetsRef.current, index, current, viewport, base, stickyTop)
      if (target !== null) el.scrollTop = target
      // A faixa é calculada já para a nova posição: o item fica montado neste render, sem esperar o evento de rolagem.
      scrollRef.current = target ?? current
      viewportRef.current = viewport
      baseRef.current = base
      recompute()
    },
    [recompute, stickyTop]
  )

  useImperativeHandle(
    handleRef,
    () => ({
      scrollToIndex,
      get element() {
        return containerRef.current
      }
    }),
    [scrollToIndex]
  )

  // Se a lista encolheu, a faixa guardada pode passar do fim: o recálculo do layout effect corrige antes de pintar.
  const start = Math.min(range.start, count)
  const end = Math.min(range.end, count)
  const rows: ReactNode[] = []
  for (let i = start; i < end; i++) {
    const key = keyOf(i)
    rows.push(
      isVariable?.(i) ? (
        // Envoltório sem margem: a altura medida (borderBoxSize) precisa ser a que ocupa no fluxo.
        <div key={key} data-virtual-key={key}>
          {renderItem(i)}
        </div>
      ) : (
        <Fragment key={key}>{renderItem(i)}</Fragment>
      )
    )
  }

  return (
    // position: relative faz o offsetTop do espaçador ser relativo a este contêiner, e não muda com a rolagem dele.
    // Por isso a base é só `topRef.current.offsetTop`. O consumidor pode sobrescrever o style, mas então
    // precisa manter o contêiner posicionado (ou a base sai errada).
    <div {...rest} ref={containerRef} style={{ position: 'relative', ...style }}>
      {header}
      {/* Espaçadores com a altura exata dos itens que não estão montados: a barra de rolagem continua fiel. */}
      <div aria-hidden ref={topRef} style={{ height: offsets[start] }} />
      {rows}
      <div aria-hidden style={{ height: offsets[count] - offsets[end] }} />
      {footer}
    </div>
  )
})
