import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { buildTree, flattenTree, parseFileViewMode, splitPath, type FileViewMode } from '../fileTree'
import { t } from '../i18n'
import { useLayout } from '../layout'

/** Modo de exibição das listas de arquivos — um só para o aplicativo todo. */
export function useFileViewMode() {
  return useLayout<FileViewMode>('files.viewMode', parseFileViewMode)
}

/** Alterna entre "lista" (nome + pasta) e "árvore" (agrupado por pasta); vale para todas as listas. */
export function FileViewToggle({ compact = false }: { compact?: boolean }) {
  const [mode, setMode] = useFileViewMode()
  return (
    <div className="segmented file-view-toggle" role="group" aria-label={t('fileList.viewMode')} title={t('fileList.viewModeHelp')} dir="ltr">
      <button className={mode === 'list' ? 'active' : ''} aria-pressed={mode === 'list'} onClick={() => setMode(undefined)}>
        ☰{!compact && ` ${t('fileList.list')}`}
      </button>
      <button className={mode === 'tree' ? 'active' : ''} aria-pressed={mode === 'tree'} onClick={() => setMode('tree')}>
        ⊟{!compact && ` ${t('fileList.tree')}`}
      </button>
    </div>
  )
}

/** Nome do arquivo em destaque e, ao lado, a pasta onde ele está; renomeações mostram de onde vieram. */
export function FileLabel({ path, oldPath, showDir = true }: { path: string; oldPath?: string; showDir?: boolean }) {
  const { name, dir } = splitPath(path)
  return (
    <span className="file-label" title={oldPath ? `${oldPath} → ${path}` : path}>
      <span className="file-name">{name}</span>
      {showDir && dir && <span className="file-dir">{dir}</span>}
      {oldPath && <span className="file-from">← {oldPath}</span>}
    </span>
  )
}

export interface FileRowContext {
  /** O que mostrar como nome do arquivo (no modo árvore, sem a pasta). */
  label: ReactNode
  /** Recuo (em px) da linha na árvore; ausente no modo lista. */
  style?: CSSProperties
  mode: FileViewMode
}

const INDENT = 14

/**
 * Linhas (`<li>`) de uma lista de arquivos no modo escolhido. A tela decide o que cada linha tem
 * (checkbox, status, ações…) em `render`; aqui ficam a ordem, as pastas e o recolher/expandir.
 */
export function FileEntries<T>({
  items,
  pathOf,
  oldPathOf,
  render
}: {
  items: readonly T[]
  pathOf(item: T): string
  oldPathOf?(item: T): string | undefined
  render(item: T, context: FileRowContext): ReactNode
}) {
  const [mode] = useFileViewMode()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const tree = useMemo(() => (mode === 'tree' ? buildTree(items, pathOf) : []), [mode, items]) // eslint-disable-line react-hooks/exhaustive-deps

  if (mode === 'list') {
    return <>{items.map((item) => render(item, { mode, label: <FileLabel path={pathOf(item)} oldPath={oldPathOf?.(item)} /> }))}</>
  }

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(path)) next.add(path)
      return next
    })

  return (
    <>
      {flattenTree(tree, collapsed).map((row) => {
        if (row.kind === 'file') {
          const item = row.node.item
          const from = oldPathOf?.(item)
          return render(item, {
            mode,
            style: { paddingInlineStart: 6 + INDENT * row.depth + 16 },
            label: <FileLabel path={row.node.path} oldPath={from} showDir={false} />
          })
        }
        return (
          <li
            key={`dir:${row.node.path}`}
            className="tree-dir"
            style={{ paddingInlineStart: 6 + INDENT * row.depth }}
            onClick={(e) => {
              e.stopPropagation()
              toggle(row.node.path)
            }}
            title={`${row.node.path} — ${t('fileList.folderFiles', { count: row.node.fileCount })}`}
            aria-expanded={!row.collapsed}
          >
            <span className="tree-caret">{row.collapsed ? '▸' : '▾'}</span>
            <span className="tree-dir-name">{row.node.name}</span>
            <span className="count">{row.node.fileCount}</span>
          </li>
        )
      })}
    </>
  )
}
