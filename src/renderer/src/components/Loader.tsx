import { useEffect, useReducer, useState, type HTMLAttributes, type ReactNode } from 'react'
import { t } from '../i18n'
import { IDLE_LOADING, planLoading, type LoadingMemory } from '../loading'

export type LoaderSize = 'sm' | 'md' | 'lg'

/**
 * Indicador de carregamento: anéis orbitais, arco de varredura, partículas e núcleo pulsante, tudo em SVG e CSS
 * (sem imagens). Cores e brilho vêm das variáveis do tema, então funciona no claro e no escuro.
 * Com `prefers-reduced-motion` ele para de girar e só pulsa suavemente (ver styles.css).
 */
export function Loader({ size = 'md', label, className }: { size?: LoaderSize; label?: string; className?: string }) {
  return (
    <span
      className={`loader loader-${size} ${className ?? ''}`}
      role={label ? undefined : 'img'}
      aria-label={label ? undefined : t('loader.loading')}
    >
      <svg className="loader-svg" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <circle className="loader-halo" cx="24" cy="24" r="22" />
        <g className="loader-ring loader-ring-outer">
          <circle cx="24" cy="24" r="20" />
        </g>
        <g className="loader-ring loader-ring-inner">
          <circle cx="24" cy="24" r="13" />
        </g>
        <g className="loader-scan">
          <path d="M24 24 L24 4 A20 20 0 0 1 41.3 14 Z" />
        </g>
        <g className="loader-orbit loader-orbit-a">
          <circle cx="24" cy="4" r="2" />
        </g>
        <g className="loader-orbit loader-orbit-b">
          <circle cx="24" cy="11" r="1.4" />
        </g>
        <circle className="loader-core" cx="24" cy="24" r="3.5" />
      </svg>
      {label && <span className="loader-label">{label}</span>}
    </span>
  )
}

/**
 * Diz se o indicador deve estar na tela: só depois de `LOADING_TIMING.delayMs` de operação (para não piscar)
 * e por pelo menos `minMs` depois de aparecer. A regra fica em `planLoading`; aqui só se agenda o próximo desenho.
 */
export function useDelayedLoading(active: boolean): boolean {
  const [memory, setMemory] = useState<LoadingMemory>(IDLE_LOADING)
  const [, wake] = useReducer((n: number) => n + 1, 0)
  const plan = planLoading(active, memory, Date.now())

  useEffect(() => {
    if (plan.startedAt !== memory.startedAt || plan.shownAt !== memory.shownAt) {
      setMemory({ startedAt: plan.startedAt, shownAt: plan.shownAt })
    }
  })

  useEffect(() => {
    if (plan.wakeIn === null) return
    const timer = setTimeout(wake, plan.wakeIn)
    return () => clearTimeout(timer)
  }, [plan.wakeIn])

  return plan.visible
}

/** Último valor que não era null: o texto da operação continua na tela enquanto o indicador ainda aparece depois dela. */
export function useLastDefined<T>(value: T | null): T | null {
  const [last, setLast] = useState<T | null>(value)
  // Ajuste de estado durante o desenho (padrão do React para valor derivado de outro).
  if (value !== null && value !== last) setLast(value)
  return value ?? last
}

/** Lugar de um painel que ainda não tem o que mostrar porque está carregando: o indicador centralizado. */
export function LoaderPane({ label, size = 'md' }: { label: string; size?: LoaderSize }) {
  return (
    <div className="loader-pane" role="status" aria-busy="true">
      <Loader size={size} label={label} />
    </div>
  )
}

interface LoadingOverlayProps extends HTMLAttributes<HTMLDivElement> {
  /** A operação está em andamento: o overlay aparece (com atraso curto) e cobre o conteúdo. */
  active: boolean
  /** Texto da operação, mostrado sob o indicador. */
  label?: string
  children?: ReactNode
}

/**
 * Camada translúcida com desfoque sobre um painel: bloqueia cliques só naquele componente enquanto ele carrega.
 * Envolve o conteúdo (que continua montado por baixo). Marca `aria-busy` no contêiner.
 */
export function LoadingOverlay({ active, label, children, className, ...rest }: LoadingOverlayProps) {
  const visible = useDelayedLoading(active)
  return (
    <div className={`loading-host ${className ?? ''}`} aria-busy={visible || undefined} {...rest}>
      {children}
      {visible && (
        <div className="loading-overlay" role="status" aria-live="polite">
          <Loader size="md" label={label ?? t('loader.loading')} />
        </div>
      )}
    </div>
  )
}
