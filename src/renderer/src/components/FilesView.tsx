import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { BlameResult, FileDiff, FileHistoryEntry, LineKey } from '../../../shared/types'
import { currentBranch, useAppActions, useAppSettings, useRepoData } from '../context'
import { useActions } from '../actions'
import { editorKind, editorLabelKey, openEditorItem } from '../editorLabel'
import { insideVsCode } from '../vscodeBridge'
import { errorMessage, fullDate, relativeDate, shortSha } from '../format'
import { t } from '../i18n'
import { git } from '../git'
import { useLayout } from '../layout'
import { startResize } from '../resize'
import { copyText } from '../copy'
import { fileMenuItems } from '../fileMenu'
import { DiffView, useFullFile } from './DiffView'
import { useDiffUncapped } from '../diffLimit'
import { revealView } from '../dockStore'
import { PaneSlot, useAnyShown } from '../slots'
import { useSessionState } from '../useSessionState'
import { LineStats } from './LineStats'
import { FileEditor } from '../lazyScreens'
import { draftPaths, useDraftsVersion } from '../editorDrafts'
import { FileEntries, useFileViewMode } from './FileList'
import { firstFileShown } from '../fileTree'
import { FileViewOptions } from './ViewOptions'
import { Loader, LoaderPane } from './Loader'
import { VirtualList } from './VirtualList'
import { BLOCK_ROWS, chunkRows } from '../diffBlocks'
import { blameColors, blameRowFlags, blameSignature, isUncommitted } from '../blameRows'

const MAX_LISTED = 500
const GUTTER_DEFAULT = 260
const GUTTER_MIN = 120
const GUTTER_MAX = 640
const parseGutter = (value: unknown) => (typeof value === 'number' && value >= GUTTER_MIN && value <= GUTTER_MAX ? value : GUTTER_DEFAULT)

/**
 * Explorador de arquivos com editor, blame por linha e histórico de cada arquivo. São painéis independentes:
 * a lista de arquivos (`files.list`), o editor (`files.editor`), o blame (`files.blame`), as versões do arquivo
 * (`files.history`) e o diff da versão escolhida (`files.diff`) — cada um pode ficar em qualquer lugar da janela.
 */
export function FilesPanes({ path, onPath }: { path: string | null; onPath(path: string): void }) {
  const [blameRev, setBlameRev] = useState<string | undefined>(undefined)
  useEffect(() => setBlameRev(undefined), [path])

  return (
    <>
      <PaneSlot id="files.list">
        <FilesList path={path} onPath={onPath} />
      </PaneSlot>
      <PaneSlot id="files.editor">
        {path ? (
          <Suspense fallback={<Loader size="sm" />}>
            <FileEditor key={path} path={path} />
          </Suspense>
        ) : (
          <p className="empty">{t('files.empty')}</p>
        )}
      </PaneSlot>
      <PaneSlot id="files.blame">
        <section className="details file-details">
          {!path ? (
            <p className="empty">{t('files.empty')}</p>
          ) : (
            <>
              <FileHeader path={path} title={blameRev ? t('files.blameAt', { sha: shortSha(blameRev) }) : t('files.blame')} />
              <div className="file-details-body">
                <BlameView path={path} rev={blameRev} onClearRev={() => setBlameRev(undefined)} />
              </div>
            </>
          )}
        </section>
      </PaneSlot>
      <FileHistoryPanes
        path={path}
        onBlameAt={(sha) => {
          setBlameRev(sha)
          revealView('files.blame')
        }}
      />
    </>
  )
}

function FileHeader({ path, title }: { path: string; title: string }) {
  const { openInEditor } = useAppActions()
  return (
    <div className="file-header">
      <strong>{title}</strong>
      <code className="diff-path">{path}</code>
      <span className="toolbar-spacer" />
      <button onClick={() => openInEditor(path)}>{t('common.openInEditor')}</button>
    </div>
  )
}

function FilesList({ path, onPath }: { path: string | null; onPath(path: string): void }) {
  const { data, repo } = useRepoData()
  const { toast, showMenu, openInEditor, openFileView } = useAppActions()
  const { settings } = useAppSettings()
  const editor = editorKind(settings.editor, insideVsCode())
  const [files, setFiles] = useState<string[]>([])
  const [filter, setFilter] = useSessionState('files.filter', '')
  // Arquivos com alterações ainda não salvas no editor.
  useDraftsVersion()
  const unsaved = new Set(draftPaths(repo.root))

  // Menu de contexto de um arquivo da lista (#82): abrir no editor em uso e copiar o caminho, como no Histórico.
  // Fica aqui, e não no <li>, para a linha não ler contexto; os textos são lidos só ao abrir o menu.
  // No editor do GitTools o arquivo já está nesta tela: `openFileView` só o seleciona.
  const fileMenu = (e: React.MouseEvent, f: string) =>
    showMenu(
      e,
      fileMenuItems({
        path: f,
        canOpen: true,
        openInEditor: (p) => openEditorItem(editor, p, { openFileView, openInEditor })(),
        copy: copyText,
        labels: { openInEditor: t(editorLabelKey(editor)), copyPath: t('history.files.copyPath') }
      })
    )

  useEffect(() => {
    git.listFiles().then(setFiles, (e) => toast('error', errorMessage(e)))
  }, [data.status.headSha, toast])

  const filtered = useMemo(() => {
    const terms = filter.toLowerCase().split(/\s+/).filter(Boolean)
    return files.filter((f) => terms.every((t) => f.toLowerCase().includes(t)))
  }, [files, filter])
  const shown = useMemo(() => filtered.slice(0, MAX_LISTED), [filtered])

  // Sem arquivo aberto, abre o primeiro da lista como ela aparece (editor e blame já carregam). Não troca o escolhido.
  const [viewMode] = useFileViewMode()
  const firstPath = useMemo(() => firstFileShown(shown, viewMode), [shown, viewMode])
  useEffect(() => {
    if (path === null && firstPath) onPath(firstPath)
  }, [path, firstPath, onPath])

  return (
    <div className="files-list">
      <div className="files-list-header">
        <input className="files-filter" aria-label={t('files.filter', { count: files.length })} placeholder={t('files.filter', { count: files.length })} value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
        <FileViewOptions />
      </div>
      <ul className="file-list">
        <FileEntries
          items={shown}
          pathOf={(f) => f}
          render={(f, { label, style }) => (
            <li
              key={f}
              className={`file-item ${f === path ? 'active' : ''}`}
              style={style}
              onClick={() => {
                onPath(f)
                revealView('files.editor')
              }}
              title={f}
              onContextMenu={(e) => fileMenu(e, f)}
            >
              {label}
              {unsaved.has(f) && (
                <span className="file-unsaved" title={t('editor.unsavedHelp')} aria-label={t('editor.unsaved')}>
                  ●
                </span>
              )}
            </li>
          )}
        />
      </ul>
      {filtered.length > MAX_LISTED && <p className="muted small">{t('files.truncated', { shown: MAX_LISTED, count: filtered.length })}</p>}
    </div>
  )
}

/** Altura estimada de um bloco de linhas. As linhas têm 18 px, mas o código quebra linha: por isso todo bloco é medido. */
const BLOCK_HEIGHT = BLOCK_ROWS * 18
/** Margem montada acima e abaixo da tela: rolar não mostra espaço em branco. */
const OVERSCAN = 800
/** Todo bloco é de altura variável. Constante de módulo: a identidade não muda. */
const alwaysVariable = () => true

/**
 * Cada blame carregado ganha prefixo de chave novo, para as alturas medidas de um arquivo (ou de outra versão)
 * não valerem para o seguinte. Mesmo truque do diff (`diffEpoch`).
 */
let blameEpoch = 0

/**
 * Estado que o bloco lê no momento do desenho e dos eventos. Os manipuladores ficam numa ref, atualizada a cada
 * desenho do blame: um bloco memorizado não é refeito só porque o menu ou o histórico mudou.
 */
interface BlameLive {
  tip(sha: string): string
  menu(e: React.MouseEvent, sha: string): void
}

interface BlameBlockProps {
  blame: BlameResult
  colors: ReadonlyMap<string, string>
  start: number
  end: number
  live: RefObject<BlameLive | null>
}

/**
 * Um bloco de linhas do blame: uma tabela própria, com as mesmas larguras de coluna das demais (o gutter vem de
 * --blame-gutter e o número de --ln-digits, no contêiner). Só os blocos perto da tela são montados.
 */
const BlameBlock = memo(function BlameBlock({ blame, colors, start, end, live }: BlameBlockProps) {
  const rows: React.ReactNode[] = []
  for (let i = start; i < end; i++) {
    const line = blame.lines[i]
    const { first, second } = blameRowFlags(blame.lines, i)
    const uncommitted = isUncommitted(line.sha)
    const commit = blame.commits[line.sha]
    rows.push(
      <tr key={i} className={first ? 'blame-first' : ''}>
        <td
          className="blame-gutter"
          style={{ borderInlineStartColor: colors.get(line.sha) }}
          // A dica (title) é montada só ao passar o mouse, e não a cada linha desenhada.
          onMouseEnter={(e) => {
            if (!e.currentTarget.title) e.currentTarget.title = live.current?.tip(line.sha) ?? ''
          }}
          onContextMenu={uncommitted ? undefined : (e) => live.current?.menu(e, line.sha)}
        >
          {first &&
            (uncommitted ? (
              <span className="muted">{t('files.uncommitted')}</span>
            ) : (
              <div className="blame-info">
                <code>{shortSha(line.sha)}</code> <span className="blame-author">{commit.author}</span>{' '}
                <span className="muted">{relativeDate(commit.date)}</span>
              </div>
            ))}
          {second && !uncommitted && <div className="blame-summary">{commit.summary}</div>}
        </td>
        <td className="ln">{line.line}</td>
        <td className="code">{line.content || ' '}</td>
      </tr>
    )
  }
  // Layout fixo, com as mesmas colunas em todos os blocos: as larguras vêm dos <col> (ver styles.css).
  return (
    <table className="blame-table">
      <colgroup>
        <col className="blame-col-gutter" />
        <col className="ln" />
        <col />
      </colgroup>
      <tbody>{rows}</tbody>
    </table>
  )
})

/**
 * Blame do arquivo, linha a linha, com o commit de cada uma. O corpo é uma lista em janela de blocos: só o
 * contêiner `.blame-body` rola. A releitura só acontece quando a assinatura muda (ver blameSignature).
 */
function BlameView({ path, rev, onClearRev }: { path: string; rev?: string; onClearRev(): void }) {
  const { data, repo } = useRepoData()
  const { selectCommit, showMenu } = useAppActions()
  const [blame, setBlame] = useState<BlameResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [gutter, setGutter] = useLayout('blame.gutter', parseGutter)
  const wrapRef = useRef<HTMLDivElement>(null)
  const live = useRef<BlameLive | null>(null)

  useEffect(() => {
    setBlame(null)
    setError(null)
  }, [path, rev])

  // Relê só quando o que o blame mostra mudou (HEAD, ou o próprio arquivo, ou o repositório); não a cada status.
  const sig = useMemo(() => blameSignature(repo.root, data.status, path, rev), [repo.root, data.status, path, rev])
  useEffect(() => {
    let cancelled = false
    git.blame(path, rev).then(
      (b) => !cancelled && setBlame(b),
      (e) => !cancelled && setError(errorMessage(e))
    )
    return () => {
      cancelled = true
    }
  }, [path, rev, sig])

  // Estes derivados são feitos uma vez por blame, e não a cada linha desenhada.
  const colors = useMemo(() => (blame ? blameColors(blame.commits) : new Map<string, string>()), [blame])
  const blocks = useMemo(() => chunkRows(blame?.lines.length ?? 0), [blame])
  const epoch = useMemo(() => ++blameEpoch, [blame])
  const keyOf = useCallback((i: number) => `${epoch}:${i}`, [epoch])
  const digits = String(blame?.lines.length ?? 0).length

  if (error) return <p className="empty">{error}</p>
  if (!blame) return <LoaderPane label={t('loader.blame')} />

  const resizeGutter = (e: React.PointerEvent) => {
    const start = gutter
    const rtl = !!wrapRef.current && getComputedStyle(wrapRef.current).direction === 'rtl'
    startResize(e, 'col-resize', (_event, dx) => setGutter(Math.round(Math.min(Math.max(start + (rtl ? -dx : dx), GUTTER_MIN), GUTTER_MAX))))
  }

  // Os blocos leem o menu e a dica daqui. Atualizada a cada desenho, antes de qualquer evento.
  live.current = {
    tip: (sha) => {
      if (isUncommitted(sha)) return t('files.uncommittedHelp')
      const commit = blame.commits[sha]
      return commit ? `${commit.summary}\n${commit.author} · ${fullDate(commit.date)}\n${commit.sha}` : ''
    },
    menu: (e, sha) =>
      showMenu(e, [
        { label: t('compare.openInHistory'), onClick: () => selectCommit(sha) },
        { label: t('history.menu.copySha'), onClick: () => copyText(sha) }
      ])
  }

  const renderItem = (i: number) => {
    const { start, end } = blocks[i]
    return <BlameBlock blame={blame} colors={colors} start={start} end={end} live={live} />
  }

  return (
    <>
      {rev && (
        <p className="muted small">
          {t('files.showingAt', { sha: shortSha(rev) })}{' '}
          <button className="link" onClick={onClearRev}>
            {t('files.showCurrent')}
          </button>
        </p>
      )}
      <div className="blame-wrap" ref={wrapRef} style={{ '--blame-gutter': `${gutter}px`, '--ln-digits': digits } as React.CSSProperties}>
        <VirtualList
          className="blame-body"
          count={blocks.length}
          rowHeight={BLOCK_HEIGHT}
          keyOf={keyOf}
          isVariable={alwaysVariable}
          overscan={OVERSCAN}
          renderItem={renderItem}
        />
        {/* Fora da lista de propósito: a alça fica na altura visível e não rola junto com o texto. */}
        <div className="column-resize blame-resize" title={t('layout.resize')} onPointerDown={resizeGutter} onDoubleClick={() => setGutter(undefined)} />
      </div>
    </>
  )
}

function FileHistoryPanes({ path, onBlameAt }: { path: string | null; onBlameAt(sha: string): void }) {
  // As versões só são lidas enquanto algum dos dois painéis está na tela.
  const shown = useAnyShown(['files.history', 'files.diff'])
  return shown && path ? <FileHistoryLoaded key={path} path={path} onBlameAt={onBlameAt} /> : <HistoryMessage>{path ? <Loader size="sm" label={t('loader.fileHistory')} /> : t('files.empty')}</HistoryMessage>
}

/** Mensagem nos dois painéis do histórico do arquivo (nada escolhido, carregando, sem commits). */
function HistoryMessage({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PaneSlot id="files.history">
        <p className="empty">{children}</p>
      </PaneSlot>
      <PaneSlot id="files.diff">
        <p className="empty">{children}</p>
      </PaneSlot>
    </>
  )
}

function FileHistoryLoaded({ path, onBlameAt }: { path: string; onBlameAt(sha: string): void }) {
  const { data } = useRepoData()
  const { run, confirm, toast, selectCommit, openDiffWindow } = useAppActions()
  const actions = useActions()
  const head = currentBranch(data)
  const [entries, setEntries] = useState<FileHistoryEntry[] | null>(null)
  const [active, setActive] = useState<FileHistoryEntry | null>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [selection, setSelection] = useState<Set<LineKey>>(new Set())
  const [fullFile] = useFullFile()
  const uncapped = useDiffUncapped(active?.path)

  useEffect(() => {
    setEntries(null)
    git.fileHistory(path).then(
      (list) => {
        setEntries(list)
        setActive(list[0] ?? null)
      },
      (e) => toast('error', errorMessage(e))
    )
  }, [path, toast])

  useEffect(() => {
    setDiff(null)
    setSelection(new Set())
    if (!active) return
    git.diff({ kind: 'commit', sha: active.sha, path: active.path, fullFile, uncapped }).then(
      (files) => setDiff(files.find((f) => f.path === active.path || f.oldPath === active.path) ?? files[0] ?? null),
      (e) => toast('error', errorMessage(e))
    )
  }, [active, toast, fullFile, uncapped])

  if (!entries) return <HistoryMessage><Loader size="sm" label={t('loader.fileHistory')} /></HistoryMessage>
  if (entries.length === 0) return <HistoryMessage>{t('files.noCommits')}</HistoryMessage>

  const restore = async (entry: FileHistoryEntry) => {
    const ok = await confirm({
      title: t('files.restoreTitle'),
      message: t('files.restoreMessage', { path: entry.path, sha: shortSha(entry.sha), subject: entry.subject }),
      confirmLabel: t('files.restore')
    })
    if (ok) await run(t('busy.restoring'), () => git.restoreFile(entry.sha, entry.path))
  }

  const applyLines = async () => {
    if (!head || !active || !diff) return
    const done = await actions.applyLines(
      head,
      { kind: 'commit', sha: active.sha, fullFile },
      diff.path,
      [...selection],
      t('details.linesContext', { path: diff.path, sha: shortSha(active.sha), subject: active.subject }),
      `${active.subject}\n\n${t('messages.linesFrom', { path: diff.path, sha: active.sha })}`
    )
    if (done) setSelection(new Set())
  }

  return (
    <>
      <PaneSlot id="files.history">
        <section className="details file-details">
          <FileHeader path={path} title={t('files.history')} />
          <ul className="compare-commits history-list">
            {entries.map((e) => (
              <li
                key={e.sha}
                className={active?.sha === e.sha ? 'active' : ''}
                onClick={() => {
                  setActive(e)
                  revealView('files.diff')
                }}
              >
                <code>{shortSha(e.sha)}</code>
                <span className="commit-subject">{e.subject}</span>
                {e.path !== path && <span className="tag" title={t('files.nameAtCommit')}>{e.path}</span>}
                <LineStats stats={e} />
                <small className="muted">
                  {e.author} · {relativeDate(e.date)}
                </small>
              </li>
            ))}
          </ul>
        </section>
      </PaneSlot>
      <PaneSlot id="files.diff">
        {active ? (
          <div className="diff-panel file-history-diff">
            {diff ? (
              <DiffView
                file={diff}
                selection={head ? selection : undefined}
                onSelectionChange={setSelection}
                panelActions={[
                  {
                    label: `⧉ ${t('diffExtra.openWindow')}`,
                    hint: t('diffExtra.openWindowHelp'),
                    onClick: () => openDiffWindow({ source: { kind: 'commit', sha: active.sha }, path: active.path, title: `${active.path} · ${shortSha(active.sha)}` })
                  },
                  { label: t('files.viewCommit'), onClick: () => selectCommit(active.sha) },
                  { label: t('files.blameThisVersion'), onClick: () => onBlameAt(active.sha) },
                  { label: t('files.restoreThisVersion'), onClick: () => restore(active) },
                  ...(head
                    ? [
                        {
                          label: t('common.applyLinesInto', { count: selection.size, target: head }),
                          disabled: !selection.size,
                          hint: selection.size ? undefined : t('feedback.blocked.noSelection'),
                          onClick: applyLines
                        }
                      ]
                    : [])
                ]}
              />
            ) : <LoaderPane label={t('loader.diff')} />}
          </div>
        ) : (
          <p className="empty">{t('files.noCommits')}</p>
        )}
      </PaneSlot>
    </>
  )
}
