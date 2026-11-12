import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { getLocale, t, type MessageKey } from '../i18n'
import { readLayout, writeLayout } from '../layout'
import { advance, markSeen, parseSeen, placeCard, progressOf, restoreTarget, settle, startTour, TOUR_SEEN_KEY, type TourInitial, type TourState, type TourStep, type TourStepId } from '../tour'
import { loadTourTexts, tourT } from '../tourText'
import './tour.css'

// Passeio guiado (issue #98). Este módulo é um pedaço à parte do pacote (lazyScreens.ts):
// fechado, o Tour não custa nada. Aberto: um destaque fixo, um cartão e nenhum ouvinte na window além do `resize` (e um `focusin` no document que prende o foco no cartão).
// Nunca clica em nada do app nem executa ação de git; o único efeito fora dele é abrir a tela de um passo (`onOpenView`).

export interface TourProps {
  /** Há um repositório aberto (decide a lista de passos). */
  hasRepo: boolean
  /** Telas escondidas em Aparência → Telas: os passos delas saem da lista. */
  hiddenScreens: readonly string[]
  /** Tela, Dashboards e Conflitos de antes de começar; só o valor da abertura vale. */
  initial: TourInitial
  /** Abre a tela de um passo pelo mesmo caminho do clique na aba. */
  onOpenView(screen: string): void
  /** Sair (Sair, Esc ou fim): devolve a tela e o Dashboards ao que eram na partida. */
  onClose(restore: TourInitial): void
}

/** Chave do layout com o prefixo `pref.` (o "restaurar padrão" não apaga o progresso; ver layout.ts). */
const SEEN_LAYOUT_KEY = `pref.${TOUR_SEEN_KEY}`
/** Quadros esperados por um alvo que ainda não está na tela (a troca de tela leva 1 ou 2); depois disso o passo é pulado. */
const MAX_FRAMES = 12
/** Janela estreita: o cartão vira faixa no rodapé (o CSS decide; aqui só não posicionamos). Mesmo valor do tour.css. */
const NARROW = 640
/** Folga do destaque em volta do alvo. */
const PAD = 4

/** Nome curto de cada passo, para as listas do cartão final (reaproveita textos do catálogo comum). */
const STEP_NAME: Record<TourStepId, MessageKey> = {
  open: 'toolbar.openRepository',
  clone: 'clone.menu',
  branch: 'toolbar.branch',
  fetch: 'toolbar.fetch',
  pull: 'toolbar.pull',
  push: 'toolbar.push',
  new: 'toolbar.new',
  studio: 'studio.name',
  conflicts: 'conflictsScreen.title',
  settings: 'toolbar.settings',
  screens: 'workbench.screens',
  history: 'tabs.history',
  'history-diff': 'workbench.views.commitDiff',
  'changes-commit': 'tabs.changes',
  'changes-diff': 'workbench.views.changesDiff',
  files: 'tabs.files',
  compare: 'tabs.compare',
  branches: 'workbench.views.branches',
  gitlog: 'gitlog.title',
  dashboards: 'dash.title'
}

/** O alvo do passo existe agora? Passos de outra tela só existem depois de abri-la, então valem até lá. */
const exists = (step: TourStep): boolean => step.screen !== undefined || document.querySelector(step.target) !== null

export function Tour({ hasRepo, hiddenScreens, initial, onOpenView, onClose }: TourProps) {
  const [state, setState] = useState<TourState>(() => startTour({ hasRepo, hiddenScreens }, parseSeen(readLayout(SEEN_LAYOUT_KEY)), initial))
  const [ready, setReady] = useState(false)
  const titleId = useId()
  const bodyId = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  const spotRef = useRef<HTMLDivElement>(null)
  /** Quem tinha o foco ao abrir: para onde o foco volta ao fechar. */
  const opener = useRef<Element | null>(null)
  if (opener.current === null) opener.current = document.activeElement
  /** Direção do último movimento: o passo sem alvo é pulado para o lado em que o usuário vai. */
  const direction = useRef<1 | -1>(1)
  /** Última tela aberta pelo Tour: passos seguidos da mesma tela não a reabrem. */
  const lastScreen = useRef<string | null>(null)
  const openView = useRef(onOpenView)
  openView.current = onOpenView

  // Os textos dos passos são um pedaço à parte por idioma: só se baixa aqui. Falha ao baixar fecha o Tour (nada mudou).
  useEffect(() => {
    let cancelled = false
    loadTourTexts(getLocale()).then(
      () => !cancelled && setReady(true),
      () => !cancelled && onClose(restoreTarget(state))
    )
    return () => {
      cancelled = true
    }
    // Só na abertura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Foco preso no cartão (diálogo modal): uma tela aberta por um passo pode pegar o foco (o filtro da lista de
  // Arquivos, por exemplo), e aí setas e Esc não chegam ao onKeyDown do cartão. Quando o foco sai para fora dele,
  // o cartão o recebe de volta. Ouve só `focusin` (sem setState); a limpeza vem ANTES do efeito de devolver o foco
  // ao elemento de origem (abaixo), senão esse foco seria roubado de volta pelo cartão ao fechar.
  useEffect(() => {
    if (!ready) return
    const onFocusIn = (event: FocusEvent) => {
      const card = cardRef.current
      if (card && event.target instanceof Node && !card.contains(event.target)) card.focus({ preventScroll: true })
    }
    document.addEventListener('focusin', onFocusIn, { passive: true })
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [ready])

  // Ao fechar, o foco volta ao elemento que abriu o Tour (se ele ainda estiver na tela).
  useEffect(
    () => () => {
      const el = opener.current
      if (el instanceof HTMLElement && el.isConnected) el.focus({ preventScroll: true })
    },
    []
  )

  const report = !state.hasRepo || state.skipped.length > 0 || state.hidden.length > 0
  const exit = () => onClose(restoreTarget(state))

  // Fim do passeio sem nada a contar: sai sem cartão final.
  useEffect(() => {
    if (state.done && !report) onClose(restoreTarget(state))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.done])

  // Mostra o passo: abre a tela (se for outra), espera o alvo, rola até ele, lê o retângulo UMA vez e escreve o
  // destaque e o cartão direto no estilo. Depois só o ResizeObserver do alvo e o `resize` da janela refazem isso,
  // no máximo uma vez por quadro e sem setState.
  useEffect(() => {
    const spot = spotRef.current
    const card = cardRef.current
    if (!ready || !spot || !card) return
    spot.hidden = true
    if (state.done) {
      // Cartão final: centralizado (o CSS), sem alvo.
      card.dataset.centered = ''
      card.style.left = ''
      card.style.top = ''
      return
    }
    const step = state.list[state.index]
    let cancelled = false
    let tries = 0
    let frame = 0
    let paintFrame = 0
    let target: Element | null = null
    let observer: ResizeObserver | undefined

    /** Um quadro: lê o alvo e o cartão (tudo de uma vez) e só então escreve. */
    const paint = () => {
      paintFrame = 0
      if (!target || cancelled) return
      const rect = target.getBoundingClientRect()
      const view = { width: window.innerWidth, height: window.innerHeight }
      const size = { width: card.offsetWidth, height: card.offsetHeight }
      spot.style.transform = `translate(${rect.left - PAD}px, ${rect.top - PAD}px)`
      spot.style.width = `${rect.width + PAD * 2}px`
      spot.style.height = `${rect.height + PAD * 2}px`
      delete card.dataset.centered
      if (view.width <= NARROW) {
        // Faixa no rodapé: a posição é do CSS.
        card.style.left = ''
        card.style.top = ''
      } else {
        const at = placeCard({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }, size, view)
        card.style.left = `${at.left}px`
        card.style.top = `${at.top}px`
      }
      spot.hidden = false
    }
    const schedule = () => {
      if (!paintFrame) paintFrame = requestAnimationFrame(paint)
    }

    /** Sem alvo na tela: o passo vai para os pulados e o Tour segue no sentido em que o usuário andava. */
    const miss = () => {
      const without = (s: TourStep) => s.id !== step.id
      setState((s) => {
        if (direction.current === -1) {
          const skipped = s.skipped.includes(step.id) ? s.skipped : [...s.skipped, step.id]
          const back = advance({ ...s, skipped }, -1, without)
          if (back.index !== s.index) return back
        }
        return settle(s, without)
      })
    }

    const reveal = (el: Element) => {
      target = el
      el.scrollIntoView?.({ block: 'nearest' })
      const rect = el.getBoundingClientRect()
      // Alvo escondido (display: none, painel fechado): conta como ausente.
      if (rect.width === 0 && rect.height === 0) return miss()
      paint()
      const seen = parseSeen(readLayout(SEEN_LAYOUT_KEY))
      if (!seen.includes(step.id)) writeLayout(SEEN_LAYOUT_KEY, markSeen(seen, step.id))
      if (typeof ResizeObserver !== 'undefined') {
        // A primeira chamada do observador vem ao observar, sem mudança: ignora.
        let first = true
        observer = new ResizeObserver(() => {
          if (first) first = false
          else schedule()
        })
        observer.observe(el)
      }
      window.addEventListener('resize', schedule, { passive: true })
    }

    const tick = () => {
      frame = 0
      if (cancelled) return
      const el = document.querySelector(step.target)
      if (el) return reveal(el)
      if (++tries < MAX_FRAMES) frame = requestAnimationFrame(tick)
      else miss()
    }

    if (step.screen !== undefined && step.screen !== lastScreen.current) {
      lastScreen.current = step.screen
      openView.current(step.screen)
      // Espera o React desenhar a tela nova antes de procurar o alvo.
      frame = requestAnimationFrame(tick)
    } else {
      tick()
    }

    return () => {
      cancelled = true
      if (frame) cancelAnimationFrame(frame)
      if (paintFrame) cancelAnimationFrame(paintFrame)
      observer?.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [ready, state.index, state.done, state.list])

  // O botão que tinha o foco pode ter ficado desabilitado ou sumido: o foco volta ao cartão, para o teclado seguir valendo.
  useEffect(() => {
    const card = cardRef.current
    if (ready && card && !card.contains(document.activeElement)) card.focus({ preventScroll: true })
  }, [ready, state.index, state.done])

  if (!ready) return null

  const { current, total } = progressOf(state)
  const atStart = !state.done && state.index === 0
  const isLast = !state.done && state.index === state.list.length - 1

  const go = (dir: 1 | -1) => {
    direction.current = dir
    if (state.done) {
      // Voltar do cartão final: ao último passo.
      if (dir === -1 && state.list.length > 0) setState({ ...state, done: false, index: state.list.length - 1 })
      return
    }
    setState(advance(state, dir, exists))
  }
  const next = () => (state.done ? exit() : go(1))

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      return exit()
    }
    if (event.key === 'Tab') {
      // O foco circula só dentro do cartão.
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
      if (buttons.length === 0) return event.preventDefault()
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || active === event.currentTarget)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
      return
    }
    // Setas: a direita avança, exceto na leitura da direita para a esquerda.
    const rtl = document.documentElement.dir === 'rtl'
    if (event.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) {
      event.preventDefault()
      next()
    } else if (event.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) {
      event.preventDefault()
      go(-1)
    }
  }

  /** Clicar fora do cartão não faz nada, nem tira o foco dele. */
  const keepFocus = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) event.preventDefault()
  }

  const step = state.list[state.index]
  const nextLabel = state.done || (isLast && !report) ? tourT('card.finish') : tourT('card.next')

  return (
    <div className="tour-overlay" onMouseDown={keepFocus} onContextMenu={(e) => e.preventDefault()}>
      <div ref={spotRef} className="tour-spot" hidden aria-hidden />
      <div ref={cardRef} className="tour-card" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="tour-head">
          <strong id={titleId}>{tourT('card.title')}</strong>
          <span className="muted small">{tourT('card.progress', { current, total })}</span>
        </div>
        <div id={bodyId} className="tour-body" aria-live="polite">
          {state.done ? (
            <>
              {!state.hasRepo && <p>{tourT('card.noRepoEnd')}</p>}
              {state.skipped.length > 0 && <StepList title={tourT('card.skippedTitle')} ids={state.skipped} />}
              {state.hidden.length > 0 && <StepList title={tourT('card.hiddenTitle')} ids={state.hidden} />}
            </>
          ) : (
            step && <p>{tourT(`step.${step.id}`)}</p>
          )}
        </div>
        <div className="tour-actions">
          <button onClick={exit}>{tourT('card.exit')}</button>
          <span className="tour-spacer" />
          <button disabled={atStart} onClick={() => go(-1)}>
            {tourT('card.previous')}
          </button>
          <button className="primary" onClick={next}>
            {nextLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Lista curta (no máximo 20 passos) de nomes, como texto do React. */
function StepList({ title, ids }: { title: string; ids: readonly TourStepId[] }) {
  return (
    <>
      <p className="tour-list-title">{title}</p>
      <ul className="tour-list">
        {ids.map((id) => (
          <li key={id}>{t(STEP_NAME[id])}</li>
        ))}
      </ul>
    </>
  )
}
