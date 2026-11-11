import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { isLightTheme, subscribeTheme } from '../appearance'
import { ensureIconSymbol, folderIconName, iconNameFor } from '../fileIcons'
import { buildTree, flattenTree, parseFileViewMode, splitPath, type FileViewMode } from '../fileTree'
import { t } from '../i18n'
import { useLayout } from '../layout'

/** Modo de exibição das listas de arquivos — um só para o aplicativo todo. */
export function useFileViewMode() {
  return useLayout<FileViewMode>('files.viewMode', parseFileViewMode)
}

/** Tema claro? Reage à troca de tema (do GitTools, do sistema ou do VS Code). */
const useLightTheme = () => useSyncExternalStore(subscribeTheme, isLightTheme)

/**
 * Ícone do tipo do arquivo (ou da pasta). Só recebe primitivos: não lê contexto, então um item da lista
 * não redesenha quando o aplicativo muda outra coisa. O desligar pelas configurações é feito no CSS
 * (`data-file-icons`, em appearance.ts).
 */
export const FileIcon = memo(function FileIcon({ path, folder, light }: { path?: string; folder?: 'open' | 'closed'; light: boolean }) {
  const name = folder ? folderIconName(folder === 'open') : iconNameFor(path ?? '', light)
  // Inserir o símbolo durante o desenho é aceitável: a inserção é idempotente (uma vez por tipo de ícone)
  // e o navegador só resolve o <use> se o símbolo já estiver no documento. O conteúdo é a tabela embutida.
  const id = ensureIconSymbol(name)
  return (
    <svg className="file-icon" aria-hidden="true" focusable="false">
      <use href={`#${id}`} />
    </svg>
  )
})

/** Nome do arquivo em destaque e, ao lado, a pasta onde ele está; renomeações mostram de onde vieram. */
export const FileLabel = memo(function FileLabel({ path, oldPath, showDir = true, status, light }: { path: string; oldPath?: string; showDir?: boolean; status?: string; light: boolean }) {
  const { name, dir } = splitPath(path)
  return (
    <span className="file-label" data-status={status} title={oldPath ? `${oldPath} → ${path}` : path}>
      <FileIcon path={path} light={light} />
      <span className="file-name">{name}</span>
      {showDir && dir && <span className="file-dir">{dir}</span>}
      {oldPath && <span className="file-from">← {oldPath}</span>}
    </span>
  )
})

export interface FileRowContext {
  /** O que mostrar como nome do arquivo (no modo árvore, sem a pasta). */
  label: ReactNode
  /** Recuo (em px) da linha na árvore; ausente no modo lista. */
  style?: CSSProperties
  mode: FileViewMode
}

const INDENT = 14
/**
 * Linhas montadas de cada vez. O resto entra conforme a lista rola: a lista inteira continua na
 * memória, e "todos" / a seleção valem para todos os itens (só o desenho é adiado).
 */
export const ROW_BATCH = 300

/**
 * Linhas (`<li>`) de uma lista de arquivos no modo escolhido. A tela decide o que cada linha tem
 * (checkbox, status, ações…) em `render`; aqui ficam a ordem, as pastas, o recolher/expandir e o
 * carregamento por partes (com milhares de arquivos, montar todas as linhas trava a tela).
 */
export function FileEntries<T>({
  items,
  pathOf,
  oldPathOf,
  statusOf,
  render
}: {
  items: readonly T[]
  pathOf(item: T): string
  oldPathOf?(item: T): string | undefined
  /** Código de status do arquivo (M, A, D…): o nome ganha a cor dele. */
  statusOf?(item: T): string | undefined
  render(item: T, context: FileRowContext): ReactNode
}) {
  const [mode] = useFileViewMode()
  // O tema é lido uma vez por lista (não por linha) e passado às linhas como primitivo.
  const light = useLightTheme()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [shown, setShown] = useState(ROW_BATCH)
  const sentinel = useRef<HTMLLIElement>(null)
  const tree = useMemo(() => (mode === 'tree' ? buildTree(items, pathOf) : []), [mode, items]) // eslint-disable-line react-hooks/exhaustive-deps
  const treeRows = useMemo(() => (mode === 'tree' ? flattenTree(tree, collapsed) : []), [mode, tree, collapsed])
  const total = mode === 'list' ? items.length : treeRows.length

  // Ao chegar o marcador do fim (ou a lista ser rolada até ele), monta o lote seguinte. Refaz o
  // observador a cada lote, para que um marcador que continue visível dispare de novo.
  const observable = typeof IntersectionObserver !== 'undefined'
  useEffect(() => {
    const el = sentinel.current
    if (!el || !observable || shown >= total) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShown((n) => n + ROW_BATCH)
      },
      { rootMargin: '300px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [shown, total, observable])

  const more =
    shown < total ? (
      <li ref={sentinel} className="file-more" aria-live="polite">
        {observable ? <span className="spinner" /> : null} {t('longList.loading')}
        {!observable && (
          <button className="link" onClick={() => setShown((n) => n + ROW_BATCH)}>
            {t('longList.showMore')}
          </button>
        )}
      </li>
    ) : null

  if (mode === 'list') {
    return (
      <>
        {items.slice(0, shown).map((item) => render(item, { mode, label: <FileLabel path={pathOf(item)} oldPath={oldPathOf?.(item)} status={statusOf?.(item)} light={light} /> }))}
        {more}
      </>
    )
  }

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(path)) next.add(path)
      return next
    })

  return (
    <>
      {treeRows.slice(0, shown).map((row) => {
        if (row.kind === 'file') {
          const item = row.node.item
          const from = oldPathOf?.(item)
          return render(item, {
            mode,
            style: { paddingInlineStart: 6 + INDENT * row.depth + 16 },
            label: <FileLabel path={row.node.path} oldPath={from} showDir={false} status={statusOf?.(item)} light={light} />
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
            <FileIcon folder={row.collapsed ? 'closed' : 'open'} light={light} />
            <span className="tree-dir-name">{row.node.name}</span>
            <span className="count">{row.node.fileCount}</span>
          </li>
        )
      })}
      {more}
    </>
  )
}
