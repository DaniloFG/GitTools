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
      /** Opção marcável: com `checked` (true ou false) o item ganha uma coluna à esquerda do rótulo, com ✓ quando marcado. */
      checked?: boolean
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
      x: Math.max(8, Math.min(menu.x, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - height - 8))
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
              {typeof item.checked === 'boolean' ? (
                <>
                  <span className="menu-main">
                    <span className="menu-check" aria-hidden>
                      {item.checked ? '✓' : ''}
                    </span>
                    <span>{item.label}</span>
                  </span>
                  {item.hint && <small>{item.hint}</small>}
                </>
              ) : (
                <>
                  <span>{item.label}</span>
                  {item.hint && <small>{item.hint}</small>}
                </>
              )}
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

/**
 * Submenu: fica fixo na janela (assim o menu pai, que rola quando é longo, não o corta). Abre ao lado do item;
 * sem espaço desse lado, abre do outro; e nunca sai da janela.
 */
function Submenu({ items, onClose }: { items: MenuItem[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const anchor = el?.parentElement
    if (!el || !anchor) return
    const a = anchor.getBoundingClientRect()
    const { width, height } = el.getBoundingClientRect()
    const rtl = document.documentElement.dir === 'rtl'
    const fitsRight = a.right + width <= window.innerWidth - 8
    const fitsLeft = a.left - width >= 8
    const openRight = fitsRight || (!fitsLeft && !rtl)
    const left = openRight ? a.right : a.left - width
    setPos({
      left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(a.top - 5, window.innerHeight - height - 8))
    })
  }, [])
  return (
    <div ref={ref} className="context-menu context-submenu" style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}>
      <MenuItems items={items} onClose={onClose} />
    </div>
  )
}
