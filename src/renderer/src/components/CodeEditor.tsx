import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { caretPosition, detectIndent, lineText, visualColumn } from '../editorText'

/** Largura mínima (px) que o balão do fim da linha precisa para caber ao lado do texto; sem ela, ele desce para a linha de baixo. */
const POPUP_MIN_WIDTH = 150
/** Espaço entre o fim do texto da linha e o balão, em largura de caracteres. */
const POPUP_GAP = 3
const TAB_SIZE = 4

interface Metrics {
  /** Largura de um caractere (a fonte é de largura fixa). */
  charWidth: number
  lineHeight: number
  padTop: number
  padLeft: number
}

interface Props {
  value: string
  onChange(next: string): void
  onSave?(): void
  readOnly?: boolean
  /** Balão mostrado ao final da linha onde está o cursor (null = nada). Recebe o número da linha (1 a n). */
  lineEnd?: (line: number) => ReactNode
  /** Rótulo para leitores de tela. */
  label: string
}

interface Caret {
  line: number
  column: number
  /** Há texto selecionado em mais de uma linha: o balão some. */
  multiLine: boolean
}

/**
 * Editor de texto simples: números de linha, Tab para recuar, recuo automático no Enter, Ctrl+S para salvar e um
 * balão opcional ao final da linha do cursor. É uma caixa de texto de verdade (desfazer, copiar, colar e seleção
 * funcionam como no sistema); o balão é posicionado pelas medidas da fonte, que tem largura fixa.
 */
export function CodeEditor({ value, onChange, onSave, readOnly = false, lineEnd, label }: Props) {
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const probeRef = useRef<HTMLSpanElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [caret, setCaret] = useState<Caret | null>(null)
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [metrics, setMetrics] = useState<Metrics>({ charWidth: 7.5, lineHeight: 19, padTop: 8, padLeft: 8 })

  const lineCount = useMemo(() => {
    let n = 1
    for (let i = value.indexOf('\n'); i !== -1; i = value.indexOf('\n', i + 1)) n++
    return n
  }, [value])
  const numbers = useMemo(() => Array.from({ length: lineCount }, (_, i) => i + 1).join('\n'), [lineCount])
  const digits = Math.max(3, String(lineCount).length)

  const measure = useCallback(() => {
    const area = areaRef.current
    const probe = probeRef.current
    if (!area || !probe) return
    const style = getComputedStyle(area)
    const charWidth = probe.getBoundingClientRect().width / probe.textContent!.length
    const lineHeight = parseFloat(style.lineHeight)
    if (!charWidth || !lineHeight) return
    setMetrics((prev) => {
      const next = { charWidth, lineHeight, padTop: parseFloat(style.paddingTop) || 0, padLeft: parseFloat(style.paddingLeft) || 0 }
      return prev.charWidth === next.charWidth && prev.lineHeight === next.lineHeight && prev.padTop === next.padTop && prev.padLeft === next.padLeft ? prev : next
    })
  }, [])

  useLayoutEffect(() => {
    measure()
    // A fonte pode terminar de carregar depois do primeiro desenho.
    void document.fonts?.ready.then(measure)
  }, [measure])

  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const observe = () => {
      const r = body.getBoundingClientRect()
      setSize({ width: r.width, height: r.height })
      measure()
    }
    observe()
    const observer = new ResizeObserver(observe)
    observer.observe(body)
    return () => observer.disconnect()
  }, [measure])

  const syncCaret = useCallback((text: string) => {
    const area = areaRef.current
    if (!area) return
    const end = caretPosition(text, area.selectionEnd)
    const start = caretPosition(text, area.selectionStart)
    setCaret({ line: end.line, column: end.column, multiLine: start.line !== end.line })
  }, [])

  /** Troca um trecho pelo texto novo mantendo o "desfazer" do navegador; devolve o texto resultante. */
  const replaceRange = (start: number, end: number, replacement: string, selStart: number, selEnd: number) => {
    const area = areaRef.current!
    area.focus()
    area.setSelectionRange(start, end)
    if (!document.execCommand('insertText', false, replacement)) {
      area.setRangeText(replacement, start, end, 'end')
      onChange(area.value)
    }
    area.setSelectionRange(selStart, selEnd)
    syncCaret(area.value)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const area = e.currentTarget
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault()
      onSave?.()
      return
    }
    if (readOnly || e.nativeEvent.isComposing) return
    const text = area.value
    const { selectionStart: from, selectionEnd: to } = area

    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      const unit = detectIndent(text)
      const blockStart = text.lastIndexOf('\n', from - 1) + 1
      const multiLine = text.slice(from, to).includes('\n')
      if (!multiLine && !e.shiftKey) {
        replaceRange(from, to, unit, from + unit.length, from + unit.length)
        return
      }
      // Recua ou desfaz o recuo de todas as linhas tocadas pela seleção.
      // Uma seleção que termina logo depois de uma quebra de linha não inclui a linha de baixo.
      const lastLineEnd = text.indexOf('\n', to > from && text[to - 1] === '\n' ? to - 1 : to)
      const blockEnd = lastLineEnd === -1 ? text.length : lastLineEnd
      const block = text.slice(blockStart, blockEnd)
      const changed = block
        .split('\n')
        .map((line) => {
          if (!e.shiftKey) return line.length ? unit + line : line
          if (line.startsWith(unit)) return line.slice(unit.length)
          return line.replace(/^( {1,4}|\t)/, '')
        })
        .join('\n')
      const firstDelta = changed.split('\n')[0].length - block.split('\n')[0].length
      replaceRange(blockStart, blockEnd, changed, Math.max(blockStart, from + firstDelta), to + (changed.length - block.length))
      return
    }

    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      // Nova linha com o mesmo recuo da linha de cima.
      const lineStart = text.lastIndexOf('\n', from - 1) + 1
      const indent = /^[\t ]*/.exec(text.slice(lineStart, from))![0]
      e.preventDefault()
      replaceRange(from, to, `\n${indent}`, from + 1 + indent.length, from + 1 + indent.length)
    }
  }

  // Balão ao final da linha do cursor.
  const popup = (() => {
    if (!lineEnd || !caret || caret.multiLine) return null
    const content = lineEnd(caret.line)
    if (!content) return null
    const { charWidth, lineHeight, padTop, padLeft } = metrics
    const text = lineText(value, caret.line)
    const top = padTop + (caret.line - 1) * lineHeight - scroll.top
    if (top < -lineHeight || top > size.height) return null
    const left = padLeft + visualColumn(text, text.length, TAB_SIZE) * charWidth - scroll.left + POPUP_GAP * charWidth
    const fits = size.width - left >= POPUP_MIN_WIDTH
    return (
      <div
        className={`editor-popup ${fits ? '' : 'below'}`}
        style={fits ? { top, left, maxWidth: size.width - left - 12 } : { top: top + lineHeight, left: 8, maxWidth: size.width - 24 }}
      >
        {content}
      </div>
    )
  })()

  const currentLineTop = caret ? metrics.padTop + (caret.line - 1) * metrics.lineHeight - scroll.top : null

  return (
    <div className="code-editor" style={{ '--editor-digits': digits } as React.CSSProperties}>
      <div className="editor-gutter" aria-hidden>
        <pre style={{ transform: `translateY(${-scroll.top}px)` }}>{numbers}</pre>
      </div>
      <div className="editor-body" ref={bodyRef}>
        {currentLineTop !== null && <div className="editor-current-line" style={{ top: currentLineTop, height: metrics.lineHeight }} aria-hidden />}
        <textarea
          ref={areaRef}
          className="editor-area"
          aria-label={label}
          value={value}
          readOnly={readOnly}
          wrap="off"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(e) => {
            onChange(e.target.value)
            syncCaret(e.target.value)
          }}
          onKeyDown={onKeyDown}
          onSelect={(e) => syncCaret(e.currentTarget.value)}
          onClick={(e) => syncCaret(e.currentTarget.value)}
          onKeyUp={(e) => syncCaret(e.currentTarget.value)}
          onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft })}
        />
        {popup}
        <span className="editor-probe" ref={probeRef} aria-hidden>
          0000000000
        </span>
      </div>
    </div>
  )
}
