import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type MenuItem =
  | {
      label: string
      /** Ausente quando o item só abre um submenu. */
      onClick?(): void
      /** Itens que abrem ao lado ao passar o mouse (ou clicar) no item. */
      submenu?: MenuItem[]
      danger?: boolean
      disabled?: boolean
      hint?: string
      /** Botões pequenos ao lado do item (ex.: ★ favoritar, ✕ remover); fecham o menu ao serem usados. */
      actions?: { icon: string; title: string; onClick(): void }[]
    }
  | 'separator'

export interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: menu.x, y: menu.y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      x: Math.min(menu.x, window.innerWidth - width - 8),
      y: Math.min(menu.y, window.innerHeight - height - 8)
    })
  }, [menu])

  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return
      onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return (
    <div ref={ref} className="context-menu" style={{ left: pos.x, top: pos.y }}>
      <MenuItems items={menu.items} onClose={onClose} />
    </div>
  )
}

/** Itens de um menu; os que têm submenu abrem outro menu ao lado (que inverte de lado se faltar espaço). */
function MenuItems({ items, onClose }: { items: MenuItem[]; onClose(): void }) {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <>
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="menu-separator" />
        ) : item.submenu ? (
          <div key={i} className="menu-item menu-parent" onMouseEnter={() => setOpen(i)} onMouseLeave={() => setOpen((o) => (o === i ? null : o))}>
            <button
              className={open === i ? 'open' : ''}
              disabled={item.disabled}
              aria-haspopup="menu"
              aria-expanded={open === i}
              onClick={() => setOpen(open === i ? null : i)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') setOpen(i)
              }}
            >
              <span>{item.label}</span>
              <small className="menu-arrow" aria-hidden>
                ▸
              </small>
            </button>
            {open === i && !item.disabled && <Submenu items={item.submenu} onClose={onClose} />}
          </div>
        ) : (
          <div key={i} className={item.actions?.length ? 'menu-row' : 'menu-item'}>
            <button
              className={item.danger ? 'danger' : ''}
              disabled={item.disabled}
              onClick={() => {
                onClose()
                item.onClick?.()
              }}
            >
              <span>{item.label}</span>
              {item.hint && <small>{item.hint}</small>}
            </button>
            {item.actions?.map((action) => (
              <button
                key={action.icon}
                className="menu-action"
                title={action.title}
                aria-label={action.title}
                onClick={() => {
                  onClose()
                  action.onClick()
                }}
              >
                {action.icon}
              </button>
            ))}
          </div>
        )
      )}
    </>
  )
}

function Submenu({ items, onClose }: { items: MenuItem[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [flip, setFlip] = useState(false)
  const [shift, setShift] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    // Sem espaço do lado em que abriria: abre do outro lado do menu pai.
    setFlip(document.documentElement.dir === 'rtl' ? r.left < 8 : r.right > window.innerWidth - 8)
    setShift(Math.min(0, window.innerHeight - 8 - r.bottom))
  }, [])
  return (
    <div ref={ref} className={`context-menu context-submenu ${flip ? 'flip' : ''}`} style={{ marginTop: shift }}>
      <MenuItems items={items} onClose={onClose} />
    </div>
  )
}
