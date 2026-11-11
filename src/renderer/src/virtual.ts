/**
 * Lógica pura da lista em janela (ver components/VirtualList.tsx). Sem React e sem DOM, para ser testada em Node.
 *
 * Tudo trabalha com `offsets`: `offsets[i]` é a posição do topo do item i e `offsets[count]` é a altura total.
 * Assim, achar o que está visível é uma busca binária, e nenhum item precisa ser medido para isso.
 */

/** Faixa de itens [start, end): end é exclusivo. */
export interface RowRange {
  start: number
  end: number
}

/** Posição do início de cada item; `offsets[count]` é a altura total. */
export function buildOffsets(count: number, rowHeight: number, sizeOf?: (index: number) => number | undefined): Float64Array {
  // NaN ou infinito viram lista vazia: um tamanho inválido não pode quebrar a alocação.
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  const offsets = new Float64Array(n + 1)
  // Linear: a lista pode ter dezenas de milhares de commits, e isto roda a cada mudança de dados.
  for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i] + (sizeOf?.(i) ?? rowHeight)
  return offsets
}

/**
 * Primeiro índice com offsets[i] >= v, em [0, count]. Usa `count` como resposta quando nenhum item chega a v.
 * Com ela, "itens que começam antes de v" é exatamente [0, resposta).
 */
function lowerBound(offsets: Float64Array, v: number, count: number): number {
  let lo = 0
  let hi = count
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (offsets[mid] < v) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Índice do item que contém a posição y (o último i com offsets[i] <= y), limitado a [0, count-1]; -1 se count = 0. */
export function indexAt(offsets: Float64Array, y: number): number {
  const count = offsets.length - 1
  if (count <= 0) return -1
  let lo = 0
  let hi = count - 1
  // Busca binária pelo último índice cujo início não passa de y. Com itens de altura zero, o último
  // é o que de fato ocupa a posição, e não um item vazio que começa no mesmo ponto.
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (offsets[mid] <= y) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * Faixa dos itens que cruzam [top - overscan, top + height + overscan].
 * A margem (overscan) evita que a linha apareça em branco durante uma rolagem rápida.
 */
export function visibleRange(offsets: Float64Array, top: number, height: number, overscan: number): RowRange {
  const count = offsets.length - 1
  if (count <= 0) return { start: 0, end: 0 }
  const margin = Math.max(0, overscan)
  const from = top - margin
  const to = top + Math.max(0, height) + margin
  const start = Math.max(0, indexAt(offsets, from))
  // Item i cruza `to` se começa antes dele: é a contagem dos que começam antes de `to`.
  const end = Math.max(start, lowerBound(offsets, to, count))
  return { start, end }
}

/**
 * Faixa a montar, com folga (histerese): `current` continua valendo enquanto cobre a área visível mais
 * metade da margem para cada lado. Só então calcula a faixa nova, com a margem inteira.
 * Assim, uma rolagem lenta muda a faixa a cada `overscan / 2` px, e não a cada item. Devolve `current` (a mesma
 * referência) quando ainda cobre, para quem chama não precisar comparar.
 * Também recalcula se `current` passou do fim da lista (ela encolheu) ou se as posições mudaram sob ele.
 */
export function nextRange(offsets: Float64Array, current: RowRange, top: number, height: number, overscan: number): RowRange {
  const count = offsets.length - 1
  if (count <= 0) return sameRange(current, { start: 0, end: 0 }) ? current : { start: 0, end: 0 }
  const half = Math.max(0, overscan) / 2
  const needStart = Math.max(0, indexAt(offsets, top - half))
  const needEnd = Math.max(needStart, lowerBound(offsets, top + Math.max(0, height) + half, count))
  const covers = current.start <= current.end && current.start <= needStart && current.end >= needEnd && current.end <= count
  if (covers) return current
  return visibleRange(offsets, top, height, overscan)
}

/** Duas faixas iguais? Usado para não chamar setState quando a rolagem não muda o que está montado. */
export function sameRange(a: RowRange, b: RowRange): boolean {
  return a.start === b.start && a.end === b.end
}

/**
 * Nova posição de rolagem para o item `index` ficar inteiro à vista (como scrollIntoView 'nearest').
 * Devolve null se ele já está inteiro à vista.
 *
 * - `base`: distância do início do conteúdo que rola até o primeiro item (ex.: um cabeçalho antes da lista).
 * - `insetTop`: altura coberta no topo por algo fixo (ex.: uma linha sticky), que não conta como área visível.
 * Item mais alto que a área visível alinha o topo dele: não há como mostrá-lo inteiro.
 */
export function scrollToReveal(
  offsets: Float64Array,
  index: number,
  scrollTop: number,
  viewport: number,
  base: number,
  insetTop = 0
): number | null {
  const count = offsets.length - 1
  if (!Number.isInteger(index) || index < 0 || index >= count) return null
  const itemTop = base + offsets[index]
  const itemBottom = base + offsets[index + 1]
  const visibleTop = scrollTop + insetTop
  const visibleBottom = scrollTop + viewport
  const area = viewport - insetTop

  let target: number
  if (itemBottom - itemTop > area) target = itemTop - insetTop
  else if (itemTop >= visibleTop && itemBottom <= visibleBottom) return null
  else if (itemTop < visibleTop) target = itemTop - insetTop
  else target = itemBottom - viewport
  // Não existe rolagem negativa; o navegador também limita o máximo.
  return Math.max(0, target)
}
