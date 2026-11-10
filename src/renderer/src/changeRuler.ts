// Lógica pura da régua de alterações (a faixa ao lado da barra de rolagem, como o "overview ruler" do VS Code).
// O componente ChangeRuler mede o DOM e usa estas funções; tudo aqui é testável sem navegador.

/** Tipo de cada marca. Cada linha ou bloco marcado informa o seu no atributo data-kind. */
export type RulerKind = 'add' | 'del' | 'mod' | 'conflict' | 'resolved'

const KINDS: readonly RulerKind[] = ['add', 'del', 'mod', 'conflict', 'resolved']

/** Linha medida em pixels do conteúdo (não da tela): posição no topo do conteúdo que rola. */
export interface RulerRow {
  top: number
  height: number
  kind: string
}

/** Marca já convertida em frações (0 a 1) da altura total do conteúdo. */
export interface RulerMark {
  top: number
  height: number
  kind: RulerKind
}

/** Só existe o que está em RulerKind; qualquer outro valor vira 'mod' (alteração genérica). */
function toKind(raw: string): RulerKind {
  return (KINDS as readonly string[]).includes(raw) ? (raw as RulerKind) : 'mod'
}

/** Cor de uma marca que junta duas: conflito prevalece; tipos diferentes viram modificação. */
function combineKinds(a: RulerKind, b: RulerKind): RulerKind {
  if (a === b) return a
  if (a === 'conflict' || b === 'conflict') return 'conflict'
  return 'mod'
}

/**
 * Marcas da régua. `rows` vêm em pixels do conteúdo e `totalHeight` é a altura total desse conteúdo.
 * `minPx` é a altura mínima de cada marca (também em pixels do conteúdo), para uma linha isolada aparecer.
 * Marcas que se sobrepõem depois disso são juntadas numa só. O resultado é em frações de `totalHeight`.
 */
export function rulerMarks(rows: RulerRow[], totalHeight: number, minPx: number): RulerMark[] {
  if (!(totalHeight > 0)) return []
  const spans = rows
    .filter((r) => Number.isFinite(r.top) && Number.isFinite(r.height))
    .map((r) => {
      const height = Math.min(totalHeight, Math.max(r.height, minPx, 0))
      // Limitado para que a marca nunca passe do fim do conteúdo.
      const top = Math.min(Math.max(0, r.top), totalHeight - height)
      return { top, end: top + height, kind: toKind(r.kind) }
    })
    .sort((x, y) => x.top - y.top || x.end - y.end)

  const merged: { top: number; end: number; kind: RulerKind }[] = []
  for (const span of spans) {
    const last = merged[merged.length - 1]
    if (last && span.top <= last.end) {
      last.end = Math.max(last.end, span.end)
      last.kind = combineKinds(last.kind, span.kind)
    } else {
      merged.push({ ...span })
    }
  }
  return merged.map((m) => ({ top: m.top / totalHeight, height: (m.end - m.top) / totalHeight, kind: m.kind }))
}

/**
 * Área visível (viewport) em frações da altura total: a parte que aparece na tela, para desenhar sobre a régua.
 */
export function viewportBox(scrollTop: number, clientHeight: number, scrollHeight: number): { top: number; height: number } {
  if (!(scrollHeight > 0)) return { top: 0, height: 1 }
  const height = Math.min(1, clientHeight / scrollHeight)
  const top = Math.min(Math.max(0, scrollTop / scrollHeight), 1 - height)
  return { top, height }
}

/**
 * Posição de rolagem (scrollTop) que centraliza, na tela, a fração `fraction` (0 a 1) do conteúdo.
 */
export function scrollTargetFor(fraction: number, scrollHeight: number, clientHeight: number): number {
  const max = Math.max(0, scrollHeight - clientHeight)
  const wanted = Math.min(1, Math.max(0, fraction)) * scrollHeight - clientHeight / 2
  return Math.min(max, Math.max(0, wanted))
}
