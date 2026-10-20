import { useEffect, useRef } from 'react'
import type { FileDiff, LineKey } from '../../../shared/types'
import { changeKeys, hunkKeys, lineKey } from '../../../shared/diffKeys'

interface Props {
  file: FileDiff
  /** Quando informado, as linhas alteradas podem ser selecionadas. */
  selection?: Set<LineKey>
  onSelectionChange?(selection: Set<LineKey>): void
}

const TYPE_LABEL = { added: 'novo', deleted: 'removido', modified: 'modificado', renamed: 'renomeado', copied: 'copiado' }

/**
 * Exibe o diff de um arquivo. Com seleção ativa: clique numa linha para marcar/desmarcar,
 * arraste o mouse para marcar várias, Shift+clique para marcar um intervalo, ou use a
 * caixa do bloco (hunk) para marcá-lo inteiro.
 */
export function DiffView({ file, selection, onSelectionChange }: Props) {
  const selectable = !!selection && !!onSelectionChange && !file.binary
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
            title="Selecionar todas as linhas do arquivo"
          />
        )}
        <span className="diff-path">
          {file.changeType === 'renamed' && file.oldPath ? `${file.oldPath} → ` : ''}
          {file.path}
        </span>
        <span className={`tag tag-${file.changeType}`}>{TYPE_LABEL[file.changeType]}</span>
        <span className="diff-stats">
          <span className="add">+{file.additions}</span> <span className="del">−{file.deletions}</span>
        </span>
        {selectable && <span className="muted small">{selection!.size ? `${all.filter((k) => selection!.has(k)).length} de ${all.length} linhas` : 'clique ou arraste sobre as linhas para selecionar'}</span>}
      </div>
      {file.binary ? (
        <p className="empty">Arquivo binário — não é possível mostrar as linhas.</p>
      ) : file.hunks.length === 0 ? (
        <p className="empty">Sem alterações de conteúdo (apenas nome ou permissões).</p>
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
                        title="Selecionar este bloco"
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
                        {line.noNewline && <span className="no-newline" title="Sem quebra de linha no fim do arquivo">⏎̸</span>}
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
