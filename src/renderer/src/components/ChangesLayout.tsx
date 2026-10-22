import { Fragment, useContext, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AppContext } from '../context'
import {
  DEFAULT_WIDTHS,
  moveByStep,
  moveSection,
  parseChangesLayout,
  resizePair,
  visibleColumns,
  weightOf,
  type ChangesLayout as Layout,
  type ChangesMode,
  type DropTarget,
  type SectionId
} from '../changesLayout'
import { t } from '../i18n'
import { useLayout } from '../layout'
import { startResize } from '../resize'

/** Painéis recolhidos (só o cabeçalho aparece); vale para as duas visões. */
export type CollapsedSections = Partial<Record<SectionId, boolean>>
const parseCollapsed = (value: unknown): CollapsedSections => {
  const out: CollapsedSections = {}
  if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) if (v === true) out[key as SectionId] = true
  }
  return out
}
export function useCollapsedSections() {
  return useLayout<CollapsedSections>('changes.collapsed', parseCollapsed)
}

export interface SectionDef {
  title: ReactNode
  badge?: number
  /** Botões do cabeçalho (ex.: "Stage tudo"). */
  actions?: ReactNode
  body: ReactNode
  /** Altura do próprio conteúdo, sem dividir o espaço da coluna (ex.: a caixa de commit). */
  auto?: boolean
  /** Altura mínima, em pixels, quando divide o espaço. */
  minSize?: number
}

/** Abaixo desta largura as colunas viram uma pilha só. */
const NARROW = 560
/** Faixa junto às bordas onde soltar um painel cria uma coluna nova. */
const EDGE = 44
const DRAG_THRESHOLD = 5

interface StackItem {
  key: string
  weight: number
  /** Divide o espaço com os vizinhos (e pode ser redimensionado). */
  flex: boolean
  min: number
  node: ReactNode
}

/** Itens em linha ou coluna, com divisórias arrastáveis entre os que dividem o espaço. */
function Stack({ axis, items, onResize }: { axis: 'row' | 'column'; items: StackItem[]; onResize(index: number, weightA: number, weightB: number): void }) {
  const row = axis === 'row'
  const begin = (e: React.PointerEvent<HTMLDivElement>, index: number) => {
    const divider = e.currentTarget
    const prev = divider.previousElementSibling as HTMLElement | null
    const next = divider.nextElementSibling as HTMLElement | null
    if (!prev || !next) return
    const size = (el: HTMLElement) => (row ? el.getBoundingClientRect().width : el.getBoundingClientRect().height)
    const [a, b] = [items[index - 1], items[index]]
    const [sa, sb] = [size(prev), size(next)]
    const rtl = row && getComputedStyle(divider).direction === 'rtl'
    startResize(e, row ? 'col-resize' : 'row-resize', (_event, dx, dy) => {
      const delta = (row ? (rtl ? -dx : dx) : dy) as number
      const [wa, wb] = resizePair(a.weight, b.weight, sa, sb, delta, a.min, b.min)
      onResize(index - 1, wa, wb)
    })
  }

  return (
    <div className={`stack stack-${axis}`}>
      {items.map((item, i) => {
        const resizable = i > 0 && items[i - 1].flex && item.flex
        const style: CSSProperties = item.flex ? { flex: `${item.weight} 1 0px`, [row ? 'minWidth' : 'minHeight']: item.min } : { flex: '0 0 auto' }
        return (
          <Fragment key={item.key}>
            {i > 0 && (
              <div
                className={`stack-divider ${resizable ? 'resizable' : ''}`}
                role="separator"
                aria-orientation={row ? 'vertical' : 'horizontal'}
                onPointerDown={resizable ? (e) => begin(e, i) : undefined}
              />
            )}
            <div className="stack-item" style={style}>
              {item.node}
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}

interface DragState {
  id: SectionId
  target: DropTarget | null
}

interface Props {
  mode: ChangesMode
  /** Painéis que existem agora (ex.: "conflitos" só aparece quando há conflitos). */
  sections: Partial<Record<SectionId, SectionDef>>
  /** Ao lado do botão de restaurar, na barra de cima. */
  toolbar?: ReactNode
}

/**
 * Os painéis da aba Alterações em colunas. Cada painel tem um cabeçalho (título, botões e uma alça):
 * arraste-o para antes/depois de outro painel, ou para a borda para abrir uma coluna nova; o menu
 * do cabeçalho tem os mesmos movimentos para quem não arrasta. Tudo fica guardado por visão.
 */
export function ChangesLayout({ mode, sections, toolbar }: Props) {
  const app = useContext(AppContext)
  const [layout, setLayout] = useLayout<Layout>(`changes.layout.${mode}`, (v) => parseChangesLayout(v, mode))
  const [collapsed, setCollapsed] = useCollapsedSections()
  const rootRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(Infinity)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [indicator, setIndicator] = useState<{ left: number; top: number; width: number; height: number; edge: boolean } | null>(null)

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const present = new Set(Object.keys(sections) as SectionId[])
  const columns = visibleColumns(layout, present)
  const narrow = width < NARROW && columns.length > 1
  const shown = narrow ? [columns.flat()] : columns
  const widths = !narrow && layout.widths.length === shown.length ? layout.widths : shown.length === 2 ? DEFAULT_WIDTHS : shown.map(() => 1)

  /** Onde um painel solto em (x, y) ficaria; null fora de qualquer alvo. */
  const targetAt = (x: number, y: number, dragged: SectionId): { target: DropTarget; rect: DOMRect; edge: boolean } | null => {
    const root = rootRef.current
    if (!root) return null
    const box = root.getBoundingClientRect()
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) return null
    const rtl = getComputedStyle(root).direction === 'rtl'
    if (!narrow) {
      const startSide = x < box.left + EDGE
      const endSide = x > box.right - EDGE
      if (startSide || endSide) {
        const atStart = rtl ? endSide : startSide
        const width = Math.min(box.width * 0.3, 260)
        const left = startSide ? box.left : box.right - width
        return { target: { kind: 'edge', side: atStart ? 'start' : 'end' }, rect: new DOMRect(left, box.top, width, box.height), edge: true }
      }
    }
    for (const el of root.querySelectorAll<HTMLElement>('[data-section]')) {
      const id = el.dataset.section as SectionId
      if (id === dragged) continue
      const r = el.getBoundingClientRect()
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue
      const where = y < r.top + r.height / 2 ? 'before' : 'after'
      return { target: { kind: 'section', id, where }, rect: where === 'before' ? new DOMRect(r.left, r.top - 1, r.width, 3) : new DOMRect(r.left, r.bottom - 2, r.width, 3), edge: false }
    }
    return null
  }

  const startDrag = (e: React.PointerEvent, id: SectionId) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.csection-actions, input, textarea, select')) return
    const x0 = e.clientX
    const y0 = e.clientY
    let active = false
    let target: DropTarget | null = null
    const move = (event: PointerEvent) => {
      if (!active) {
        if (Math.hypot(event.clientX - x0, event.clientY - y0) < DRAG_THRESHOLD) return
        active = true
        document.body.classList.add('docking')
      }
      const hit = targetAt(event.clientX, event.clientY, id)
      target = hit?.target ?? null
      setDrag({ id, target })
      setIndicator(hit ? { left: hit.rect.left, top: hit.rect.top, width: hit.rect.width, height: hit.rect.height, edge: hit.edge } : null)
    }
    const finish = (drop: boolean) => () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (!active) return
      document.body.classList.remove('docking')
      setDrag(null)
      setIndicator(null)
      if (drop && target) setLayout(moveSection(layout, id, target))
      // O clique que vem depois de soltar não deve recolher/abrir o painel.
      const swallow = (event: MouseEvent) => {
        event.stopPropagation()
        event.preventDefault()
      }
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
    }
    const onUp = finish(true)
    const onCancel = finish(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  const menu = (e: React.MouseEvent, id: SectionId) =>
    app?.showMenu(e, [
      { label: `↑ ${t('changes.layout.moveUp')}`, onClick: () => setLayout(moveByStep(layout, id, 'up')) },
      { label: `↓ ${t('changes.layout.moveDown')}`, onClick: () => setLayout(moveByStep(layout, id, 'down')) },
      { label: `← ${t('changes.layout.moveLeft')}`, onClick: () => setLayout(moveByStep(layout, id, 'left')) },
      { label: `→ ${t('changes.layout.moveRight')}`, onClick: () => setLayout(moveByStep(layout, id, 'right')) },
      'separator',
      { label: t('changes.layout.restore'), onClick: () => setLayout(undefined) }
    ])

  const toggle = (id: SectionId) => setCollapsed((prev) => ({ ...prev, [id]: prev[id] ? undefined : true }))

  const frame = (id: SectionId) => {
    const def = sections[id]!
    const closed = !!collapsed[id]
    return (
      <section className={`csection csection-${id} ${closed ? 'closed' : ''} ${drag?.id === id ? 'dragging' : ''}`} data-section={id}>
        <header className="csection-header" onPointerDown={(e) => startDrag(e, id)} onContextMenu={(e) => menu(e, id)} title={t('changes.layout.drag')}>
          <button className="csection-toggle" onClick={() => toggle(id)} aria-expanded={!closed} title={closed ? t('layout.expand') : t('layout.collapse')}>
            <span className="csection-caret">{closed ? '▸' : '▾'}</span>
            <span className="csection-title">{def.title}</span>
            {def.badge !== undefined && <span className="csection-count">{def.badge}</span>}
          </button>
          <span className="csection-actions">{def.actions}</span>
          <span className="csection-grip" aria-hidden>
            ⠿
          </span>
        </header>
        {!closed && <div className="csection-body">{def.body}</div>}
      </section>
    )
  }

  const sectionItems = (ids: SectionId[]): StackItem[] =>
    ids.map((id) => {
      const def = sections[id]!
      return { key: id, weight: weightOf(layout, id), flex: !def.auto && !collapsed[id], min: def.minSize ?? 90, node: frame(id) }
    })

  return (
    <div className="changes-layout-wrap">
      <div className="changes-toolbar">
        {toolbar}
        <button className="icon-button ghost" onClick={() => setLayout(undefined)} title={t('changes.layout.restore')} aria-label={t('changes.layout.restore')}>
          ⊞
        </button>
      </div>
      <div ref={rootRef} className={`changes-layout ${narrow ? 'narrow' : ''}`}>
        <Stack
          axis="row"
          items={shown.map((ids, ci) => ({
            key: ids.join('+'),
            weight: widths[ci],
            flex: true,
            min: 220,
            node: (
              <Stack
                axis="column"
                items={sectionItems(ids)}
                onResize={(index, wa, wb) => setLayout({ ...layout, weights: { ...layout.weights, [ids[index]]: wa, [ids[index + 1]]: wb } })}
              />
            )
          }))}
          onResize={(index, wa, wb) => {
            // Só guarda as larguras quando todas as colunas do arranjo estão visíveis.
            if (narrow || shown.length !== layout.columns.length) return
            const next = widths.slice()
            next[index] = wa
            next[index + 1] = wb
            setLayout({ ...layout, widths: next })
          }}
        />
      </div>
      {indicator && (
        <div className={`changes-drop ${indicator.edge ? 'edge' : 'line'}`} style={{ left: indicator.left, top: indicator.top, width: indicator.width, height: indicator.height }} aria-hidden>
          {indicator.edge && <span>{t('changes.layout.newColumn')}</span>}
        </div>
      )}
    </div>
  )
}
