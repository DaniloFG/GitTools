// Onde abrir um popover ancorado num botão, sem medir nada além da âncora e da janela (funções puras, sem DOM).

export interface PopoverAnchor {
  top: number
  bottom: number
  left: number
  right: number
}

export interface PlacePopoverInput {
  /** Retângulo do botão, em pixels da janela. */
  anchor: PopoverAnchor
  /** Largura do popover e a altura que ele quer ter. */
  size: { width: number; maxHeight: number }
  viewport: { width: number; height: number }
  /** Espaço entre o botão e o popover. */
  gap: number
  /** Distância mínima que o popover mantém das bordas da janela. */
  margin: number
}

export interface PopoverPlacement {
  /** true: a lista sobe, acima do botão. false: desce, abaixo dele. */
  openUp: boolean
  /** true: a borda direita do popover fica alinhada à do botão (cabe assim, e não cabe começando no botão). */
  alignEnd: boolean
  /** Altura máxima da lista; a lista rola quando é menor que a altura desejada. */
  maxHeight: number
}

export function placePopover({ anchor, size, viewport, gap, margin }: PlacePopoverInput): PopoverPlacement {
  // Espaço útil de cada lado: a distância até a borda, menos o espaço entre o botão e o popover, menos a margem.
  // Nunca negativo: um botão fora da janela não pode produzir altura negativa.
  const below = Math.max(0, viewport.height - anchor.bottom - gap - margin)
  const above = Math.max(0, anchor.top - gap - margin)

  // Desce quando a altura desejada cabe embaixo. Só sobe quando não cabe e em cima há mais espaço.
  // Espaço igual vai para baixo: é a leitura natural e evita oscilar entre os dois lados.
  const openUp = below < size.maxHeight && above > below
  // Altura da lista: a desejada, limitada ao espaço do lado escolhido.
  const maxHeight = Math.min(size.maxHeight, openUp ? above : below)

  // Passa da borda direita quando o início do popover somado à largura ultrapassa a janela menos a margem.
  // Alinha ao fim só se couber assim: a borda direita do popover no fim do botão, sem passar da margem à esquerda.
  const overflowsRight = anchor.left + size.width > viewport.width - margin
  const endFits = anchor.right - size.width >= margin
  const alignEnd = overflowsRight && endFits

  return { openUp, alignEnd, maxHeight }
}
