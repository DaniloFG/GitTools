import { useContext, useEffect, useRef, useState } from 'react'
import type { DiffLine, FileDiff, LineKey } from '../../../shared/types'
import { changeKeys, hunkKeys, lineKey, splitRows } from '../../../shared/diffKeys'
import { DEFAULT_SETTINGS, type DiffLayout } from '../../../shared/settings'
import { AppContext } from '../context'
import { t, type MessageKey } from '../i18n'

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

interface Props {
  file: FileDiff
  /** Quando informado, as linhas alteradas podem ser selecionadas. */
  selection?: Set<LineKey>
  onSelectionChange?(selection: Set<LineKey>): void
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
export function DiffView({ file, selection, onSelectionChange }: Props) {
  const selectable = !!selection && !!onSelectionChange && !file.binary
  const [layout, setLayout] = useDiffLayout()
  const dragMode = useRef<'add' | 'remove' | null>(null)
  const lastClicked = useRef<LineKey | null>(null)
  const all = changeKeys(file)

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
    <div className="diff-file">
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
                  <tr key={`${h}:${row.left ?? '-'}:${row.right ?? '-'}`} className="line">
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
  )
}
