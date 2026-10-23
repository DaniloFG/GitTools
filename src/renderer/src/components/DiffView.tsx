import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DiffLine, FileDiff, LineKey } from '../../../shared/types'
import { changeKeys, hunkKeys, lineKey, splitRows } from '../../../shared/diffKeys'
import { DEFAULT_SETTINGS, type DiffLayout } from '../../../shared/settings'
import { AppContext } from '../context'
import { stepIndex, useDiffNav } from '../diffNav'
import { t, type MessageKey } from '../i18n'
import { useLayout } from '../layout'
import { displayCombo, resolveBindings } from '../shortcuts'

/**
 * Escolha entre "cima e baixo" e "lado a lado": todo diff abre no modo padrão das configurações;
 * os botões do cabeçalho trocam o modo só enquanto o diff está aberto.
 */
export function useDiffLayout(): [DiffLayout, (layout: DiffLayout) => void] {
  const preferred = useContext(AppContext)?.settings.diffLayout ?? DEFAULT_SETTINGS.diffLayout
  const [override, setOverride] = useState<{ preferred: DiffLayout; layout: DiffLayout } | null>(null)
  // Se o padrão mudar nas configurações, a escolha temporária deixa de valer.
  const layout = override && override.preferred === preferred ? override.layout : preferred
  return [layout, (next) => setOverride({ preferred, layout: next })]
}

/**
 * Mostrar o arquivo inteiro (todo o contexto) em vez de só os trechos alterados. O padrão vem das
 * configurações (Editor e diff); o botão do cabeçalho do diff troca para todos os diffs e a escolha fica
 * guardada até o padrão das configurações mudar. Quem busca o diff a inclui no pedido (`fullFile`).
 */
export function useFullFile(): [boolean, (full: boolean) => void] {
  const preferred = useContext(AppContext)?.settings.diffFullFile ?? DEFAULT_SETTINGS.diffFullFile
  const [override, setOverride] = useLayout<{ preferred: boolean; full: boolean } | undefined>('diff.fullFile', parseFullFileOverride)
  // Se o padrão mudar nas configurações, a escolha temporária deixa de valer.
  const full = override && override.preferred === preferred ? override.full : preferred
  return [full, (next) => setOverride(next === preferred ? undefined : { preferred, full: next })]
}

function parseFullFileOverride(value: unknown): { preferred: boolean; full: boolean } | undefined {
  const raw = value as { preferred?: unknown; full?: unknown } | null
  return raw && typeof raw === 'object' && typeof raw.preferred === 'boolean' && typeof raw.full === 'boolean' ? { preferred: raw.preferred, full: raw.full } : undefined
}

interface Props {
  file: FileDiff
  /** Quando informado, as linhas alteradas podem ser selecionadas. */
  selection?: Set<LineKey>
  onSelectionChange?(selection: Set<LineKey>): void
  /** Quando há uma lista de arquivos ao lado: posição do arquivo e como ir para o anterior/próximo. */
  fileNav?: { index: number; count: number; go(delta: 1 | -1): void }
}

/** Teclas atuais de uma ação (as personalizadas das configurações, se houver). */
function useShortcutOf(): (action: string) => string {
  const overrides = useContext(AppContext)?.settings.shortcuts
  return (action) => displayCombo(resolveBindings(overrides ?? {})[action])
}

const TYPE_LABEL: Record<FileDiff['changeType'], MessageKey> = {
  added: 'status.untracked',
  deleted: 'status.deleted',
  modified: 'status.modified',
  renamed: 'status.renamed',
  copied: 'status.copied'
}

/**
 * Exibe o diff de um arquivo. Com seleção ativa: clique numa linha para marcar/desmarcar,
 * arraste o mouse para marcar várias, Shift+clique para marcar um intervalo, ou use a
 * caixa do bloco (hunk) para marcá-lo inteiro.
 */
export function DiffView({ file, selection, onSelectionChange, fileNav }: Props) {
  const selectable = !!selection && !!onSelectionChange && !file.binary
  const [layout, setLayout] = useDiffLayout()
  const [fullFile, setFullFile] = useFullFile()
  const dragMode = useRef<'add' | 'remove' | null>(null)
  const lastClicked = useRef<LineKey | null>(null)
  const all = changeKeys(file)
  const root = useRef<HTMLDivElement>(null)
  const shortcutOf = useShortcutOf()
  /** Alteração atual da navegação (índice entre os blocos de linhas alteradas) e quantas existem. */
  const [cursor, setCursor] = useState(-1)
  const [blocks, setBlocks] = useState(0)

  /** Primeira linha de cada bloco de linhas alteradas seguidas (cada linha alterada tem data-change). */
  const changeBlocks = () => {
    const rows = [...(root.current?.querySelectorAll<HTMLElement>('tr.hunk-header, tr.line') ?? [])]
    const blocks: HTMLElement[][] = []
    rows.forEach((row, i) => {
      if (!row.hasAttribute('data-change')) return
      if (i > 0 && rows[i - 1].hasAttribute('data-change')) blocks[blocks.length - 1].push(row)
      else blocks.push([row])
    })
    return blocks
  }

  const goChange = (delta: 1 | -1) => {
    const list = changeBlocks()
    const next = stepIndex(cursor, delta, list.length)
    if (next < 0) return
    setCursor(next)
    list[next][0].scrollIntoView({ block: 'center', behavior: 'smooth' })
    for (const row of list[next]) {
      row.classList.remove('nav-flash')
      void row.offsetWidth // reinicia a animação se a mesma alteração for escolhida de novo
      row.classList.add('nav-flash')
      setTimeout(() => row.classList.remove('nav-flash'), 1400)
    }
  }

  // Outro arquivo, outro modo de exibição ou "arquivo inteiro": a contagem recomeça.
  useLayoutEffect(() => {
    setCursor(-1)
    setBlocks(changeBlocks().length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, layout, fullFile])

  useDiffNav({
    el: () => root.current,
    go: (kind, delta) => (kind === 'change' ? goChange(delta) : fileNav?.go(delta))
  })

  useEffect(() => {
    const stop = () => (dragMode.current = null)
    window.addEventListener('mouseup', stop)
    return () => window.removeEventListener('mouseup', stop)
  }, [])

  const update = (keys: LineKey[], add: boolean) => {
    if (!selection || !onSelectionChange) return
    const next = new Set(selection)
    for (const k of keys) {
      if (add) next.add(k)
      else next.delete(k)
    }
    onSelectionChange(next)
  }

  const onLineDown = (e: React.MouseEvent, key: LineKey) => {
    if (!selectable) return
    e.preventDefault()
    if (e.shiftKey && lastClicked.current) {
      const a = all.indexOf(lastClicked.current)
      const b = all.indexOf(key)
      const [from, to] = [a, b].sort((m, n) => m - n)
      update(all.slice(from, to + 1), true)
      return
    }
    const add = !selection!.has(key)
    dragMode.current = add ? 'add' : 'remove'
    lastClicked.current = key
    update([key], add)
  }

  const onLineEnter = (key: LineKey) => {
    if (dragMode.current) update([key], dragMode.current === 'add')
  }

  const allSelected = selectable && all.length > 0 && all.every((k) => selection!.has(k))

  return (
    <div className="diff-file" ref={root}>
      <div className="diff-file-header">
        {selectable && (
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = !allSelected && all.some((k) => selection!.has(k))
            }}
            onChange={(e) => update(all, e.target.checked)}
            title={t('diff.selectFile')}
          />
        )}
        <span className="diff-path">
          {file.changeType === 'renamed' && file.oldPath ? `${file.oldPath} → ` : ''}
          {file.path}
        </span>
        <span className={`tag tag-${file.changeType}`}>{t(TYPE_LABEL[file.changeType])}</span>
        <span className="diff-stats">
          <span className="add">+{file.additions}</span> <span className="del">−{file.deletions}</span>
        </span>
        {selectable && <span className="muted small">{selection!.size ? t('diff.selectedOf', { selected: all.filter((k) => selection!.has(k)).length, count: all.length }) : t('diff.selectHint')}</span>}
        <span className="toolbar-spacer" />
        {blocks > 0 && (
          <div className="diff-nav" dir="ltr" role="group" aria-label={t('diffNav.group')}>
            <button onClick={() => goChange(-1)} title={`${t('diffNav.prevChange')} (${shortcutOf('diff.prevChange')})`}>
              ▲
            </button>
            <span className="diff-nav-count" title={t('diffNav.count')}>
              {cursor < 0 ? '–' : cursor + 1}/{blocks}
            </span>
            <button onClick={() => goChange(1)} title={`${t('diffNav.nextChange')} (${shortcutOf('diff.nextChange')})`}>
              ▼
            </button>
          </div>
        )}
        {fileNav && fileNav.count > 1 && (
          <div className="diff-nav" dir="ltr" role="group" aria-label={t('diffNav.fileGroup')}>
            <button onClick={() => fileNav.go(-1)} title={`${t('diffNav.prevFile')} (${shortcutOf('diff.prevFile')})`}>
              ◀
            </button>
            <span className="diff-nav-count" title={t('diffNav.fileCount')}>
              {fileNav.index + 1}/{fileNav.count}
            </span>
            <button onClick={() => fileNav.go(1)} title={`${t('diffNav.nextFile')} (${shortcutOf('diff.nextFile')})`}>
              ▶
            </button>
          </div>
        )}
        {!file.binary && file.hunks.length > 0 && (
          <button
            className={`diff-full ${fullFile ? 'active' : ''}`}
            aria-pressed={fullFile}
            onClick={() => setFullFile(!fullFile)}
            title={fullFile ? t('diffExtra.changesOnlyHelp') : t('diffExtra.fullFileHelp')}
          >
            ⇕ {t('diffExtra.fullFile')}
          </button>
        )}
        {!file.binary && file.hunks.length > 0 && (
          <div className="segmented diff-layout" role="group" aria-label={t('diff.layout')}>
            <button className={layout === 'inline' ? 'active' : ''} onClick={() => setLayout('inline')} title={t('diff.inlineHelp')}>
              ☰ {t('diff.inline')}
            </button>
            <button className={layout === 'split' ? 'active' : ''} onClick={() => setLayout('split')} title={t('diff.splitHelp')}>
              ◫ {t('diff.split')}
            </button>
          </div>
        )}
      </div>
      <div className="diff-body">
      {file.binary ? (
        <p className="empty">{t('diff.binary')}</p>
      ) : file.hunks.length === 0 ? (
        <p className="empty">{t('diff.noContent')}</p>
      ) : layout === 'split' ? (
        <table className={`diff-table diff-split ${selectable ? 'selectable' : ''}`}>
          <colgroup>
            <col className="sel" />
            <col className="ln" />
            <col />
            <col className="sel" />
            <col className="ln" />
            <col />
          </colgroup>
          <tbody>
            {file.hunks.map((hunk, h) => {
              const keys = hunkKeys(file, h)
              const hunkAll = selectable && keys.every((k) => selection!.has(k))
              const side = (index: number | null, which: 'old' | 'new') => {
                const half = which === 'new' ? 'half' : ''
                if (index === null) return <td colSpan={3} className={`cell-empty ${half}`} />
                const line: DiffLine = hunk.lines[index]
                const key = lineKey(h, index)
                const change = line.kind !== 'context'
                const isSelected = change && selection?.has(key)
                const cls = `cell-${line.kind} ${isSelected ? 'line-selected' : ''}`
                const handlers = change ? { onMouseDown: (e: React.MouseEvent) => onLineDown(e, key), onMouseEnter: () => onLineEnter(key) } : {}
                return (
                  <>
                    <td className={`sel ${half} ${cls}`} {...handlers}>
                      {selectable && change && <span className={`tick ${isSelected ? 'on' : ''}`} />}
                    </td>
                    <td className={`ln ${cls}`} {...handlers}>
                      {(which === 'old' ? line.oldLine : line.newLine) ?? ''}
                    </td>
                    <td className={`code ${cls}`} {...handlers}>
                      {line.content || ' '}
                      {line.noNewline && <span className="no-newline" title={t('diff.noNewline')}>⏎̸</span>}
                    </td>
                  </>
                )
              }
              return [
                <tr key={`h${h}`} className="hunk-header">
                  <td className="sel">
                    {selectable && (
                      <input
                        type="checkbox"
                        checked={hunkAll}
                        ref={(el) => {
                          if (el) el.indeterminate = !hunkAll && keys.some((k) => selection!.has(k))
                        }}
                        onChange={(e) => update(keys, e.target.checked)}
                        title={t('diff.selectHunk')}
                      />
                    )}
                  </td>
                  <td colSpan={5}>
                    @@ −{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@ <span className="muted">{hunk.section}</span>
                  </td>
                </tr>,
                ...splitRows(hunk).map((row) => (
                  <tr
                    key={`${h}:${row.left ?? '-'}:${row.right ?? '-'}`}
                    className="line"
                    data-change={[row.left, row.right].some((i) => i !== null && hunk.lines[i].kind !== 'context') || undefined}
                  >
                    {side(row.left, 'old')}
                    {side(row.right, 'new')}
                  </tr>
                ))
              ]
            })}
          </tbody>
        </table>
      ) : (
        <table className={`diff-table ${selectable ? 'selectable' : ''}`}>
          <tbody>
            {file.hunks.map((hunk, h) => {
              const keys = hunkKeys(file, h)
              const hunkAll = selectable && keys.every((k) => selection!.has(k))
              return [
                <tr key={`h${h}`} className="hunk-header">
                  <td className="sel">
                    {selectable && (
                      <input
                        type="checkbox"
                        checked={hunkAll}
                        ref={(el) => {
                          if (el) el.indeterminate = !hunkAll && keys.some((k) => selection!.has(k))
                        }}
                        onChange={(e) => update(keys, e.target.checked)}
                        title={t('diff.selectHunk')}
                      />
                    )}
                  </td>
                  <td colSpan={4}>
                    @@ −{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@ <span className="muted">{hunk.section}</span>
                  </td>
                </tr>,
                ...hunk.lines.map((line, l) => {
                  const key = lineKey(h, l)
                  const change = line.kind !== 'context'
                  const isSelected = change && selection?.has(key)
                  return (
                    <tr
                      key={key}
                      className={`line line-${line.kind} ${isSelected ? 'line-selected' : ''}`}
                      data-change={change || undefined}
                      onMouseDown={change ? (e) => onLineDown(e, key) : undefined}
                      onMouseEnter={change ? () => onLineEnter(key) : undefined}
                    >
                      <td className="sel">{selectable && change && <span className={`tick ${isSelected ? 'on' : ''}`} />}</td>
                      <td className="ln">{line.oldLine ?? ''}</td>
                      <td className="ln">{line.newLine ?? ''}</td>
                      <td className="sign">{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}</td>
                      <td className="code">
                        {line.content || ' '}
                        {line.noNewline && <span className="no-newline" title={t('diff.noNewline')}>⏎̸</span>}
                      </td>
                    </tr>
                  )
                })
              ]
            })}
          </tbody>
        </table>
      )}
      </div>
    </div>
  )
}
