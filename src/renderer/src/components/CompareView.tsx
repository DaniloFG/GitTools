import { useEffect, useRef, useState } from 'react'
import type { ChangedFile, CommitInfo, Comparison, DiffSource, FileDiff, LineKey } from '../../../shared/types'
import { useActions } from '../actions'
import { currentBranch, useAppActions, useAppSettings, useRepoData, type CompareRequest } from '../context'
import { editorKind, editorLabelKey, openEditorItem } from '../editorLabel'
import { insideVsCode } from '../vscodeBridge'
import { errorMessage, relativeDate, shortSha, statusLabel } from '../format'
import { t } from '../i18n'
import { git } from '../git'
import { copyText } from '../copy'
import { canApplyFile, fileMenuItems, wholeFileKeys } from '../fileMenu'
import { DiffView, useFullFile } from './DiffView'
import { useDiffUncapped } from '../diffLimit'
import { revealView } from '../dockStore'
import { PaneSlot } from '../slots'
import { stepIndex } from '../diffNav'
import { FileEntries } from './FileList'
import { FileViewOptions } from './ViewOptions'
import { useSessionState } from '../useSessionState'
import { LineStats } from './LineStats'
import { Loader, LoaderPane, LoadingOverlay } from './Loader'

interface Props {
  request: CompareRequest
  onRequest(request: CompareRequest): void
}

/**
 * Compara duas branches, tags ou commits quaisquer. São painéis independentes: a configuração com os commits de
 * cada lado (`compare.setup`), os arquivos diferentes (`compare.files`) e o diff do arquivo (`compare.diff`).
 */
export function CompareView({ request, onRequest }: Props) {
  const { data } = useRepoData()
  const { run, toast, selectCommit, openFileView, showMenu, openDiffWindow, openInEditor } = useAppActions()
  const { settings } = useAppSettings()
  const editor = editorKind(settings.editor, insideVsCode())
  const actions = useActions()
  const head = currentBranch(data)
  const defaultTo = data.branches.find((b) => !b.remote && b.name !== head)?.name ?? ''
  // Os campos da comparação são lembrados ao navegar para outra tela ou outra aba de repositório e voltar.
  const [from, setFrom] = useSessionState('compare.from', request.from ?? head ?? 'HEAD')
  const [to, setTo] = useSessionState('compare.to', request.to ?? defaultTo)
  const [sinceBase, setSinceBase] = useSessionState('compare.sinceBase', true)
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState<ChangedFile | null>(null)
  /** Último commit clicado nas listas "Só em…" (só fica destacado; ir ao Histórico é pelo menu). */
  const [commit, setCommit] = useState<string | null>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [selection, setSelection] = useState<Set<LineKey>>(new Set())
  /**
   * Há uma "Aplicar arquivo inteiro" em curso (#59). Um segundo clique enquanto a pergunta stage/commit ou a
   * operação estão abertas é ignorado: não fica um segundo cherry-pick disputando o índice.
   */
  const applying = useRef(false)

  const refs = [
    'HEAD',
    ...data.branches.map((b) => b.name),
    ...data.tags.map((t) => t.name)
  ]

  // Uma nova solicitação (vinda de um menu) substitui os campos.
  useEffect(() => {
    if (request.from) setFrom(request.from)
    if (request.to) setTo(request.to)
  }, [request])

  const doCompare = async (a = from, b = to) => {
    if (!a.trim() || !b.trim()) return
    setLoading(true)
    setActive(null)
    setCommit(null)
    try {
      const result = await git.compare(a.trim(), b.trim(), sinceBase)
      setComparison(result)
      setActive(result.files[0] ?? null)
    } catch (e) {
      setComparison(null)
      toast('error', errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const a = request.from ?? from
    const b = request.to ?? to
    if (a && b) void doCompare(a, b)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, sinceBase])

  const base = comparison ? (sinceBase && comparison.mergeBase ? comparison.mergeBase : comparison.from) : null
  const [fullFile] = useFullFile()
  const uncapped = useDiffUncapped(active?.path)
  const source: DiffSource | null = comparison && base ? { kind: 'range', from: base, to: comparison.to, fullFile } : null

  useEffect(() => {
    setDiff(null)
    setSelection(new Set())
    if (!source || !active) return
    let cancelled = false
    git.diff({ ...source, path: active.path, uncapped }).then(
      (files) => !cancelled && setDiff(files.find((f) => f.path === active.path) ?? files[0] ?? null),
      (e) => !cancelled && toast('error', errorMessage(e))
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, comparison, fullFile, uncapped])

  // Clicar num commit das listas só o destaca aqui: a comparação continua na tela (ir ao Histórico é pelo menu).
  const openCommit = (sha: string) => setCommit(sha)
  const commitMenu = (e: React.MouseEvent, sha: string) =>
    showMenu(e, [
      { label: t('compare.openInHistory'), onClick: () => selectCommit(sha) },
      'separator',
      actions.copyMessageMenu([sha])
    ])

  /**
   * Aplica no `head` tudo o que há no arquivo da comparação (#59), sem abrir o diff para marcar linhas. Busca o diff
   * completo (`uncapped`) e marca todas as linhas alteradas; daí segue o mesmo caminho de "Aplicar linhas", que
   * pergunta stage ou commit e chama `cherryPickLines`.
   */
  const applyFile = async (file: ChangedFile) => {
    if (!head || !source || !comparison || applying.current) return
    applying.current = true
    try {
      let files: FileDiff[]
      try {
        files = await git.diff({ ...source, path: file.path, uncapped: true })
      } catch (e) {
        toast('error', errorMessage(e))
        return
      }
      const whole = wholeFileKeys(files, file.path)
      if ('error' in whole) {
        toast('error', t(whole.error === 'binary' ? 'core.binaryNoLines' : 'core.noChangesIn', { path: file.path }))
        return
      }
      await actions.applyLines(
        head,
        source,
        file.path,
        whole.keys,
        t('compare.linesContext', { path: file.path, from: comparison.from, to: comparison.to }),
        t('messages.linesFromRef', { path: file.path, ref: comparison.to })
      )
    } finally {
      applying.current = false
    }
  }

  /**
   * Menu de contexto de um arquivo da lista (#82). Arquivo apagado na comparação (status D) não existe na árvore de
   * trabalho, então o menu não oferece "Abrir no editor". Pelo mesmo motivo, "Aplicar arquivo inteiro" (#59)
   * não é oferecido para D: não há o que trazer para a branch atual. E não se oferece quando a branch atual já é a
   * própria `to`: aplicar a branch nela mesma não faz sentido.
   */
  const fileMenu = (e: React.MouseEvent, f: ChangedFile) =>
    showMenu(
      e,
      fileMenuItems({
        path: f.path,
        canOpen: f.status !== 'D',
        openInEditor: (p) => openEditorItem(editor, p, { openFileView, openInEditor })(),
        copy: copyText,
        labels: { openInEditor: t(editorLabelKey(editor)), copyPath: t('history.files.copyPath') },
        apply: head && canApplyFile({ head, to: comparison?.to, status: f.status }) ? { label: t('compare.applyFile', { target: head }), onClick: () => applyFile(f) } : undefined
      })
    )

  const swap = () => {
    setFrom(to)
    setTo(from)
    onRequest({ from: to, to: from })
  }

  const applyLines = async () => {
    if (!head || !diff || !source || !comparison) return
    const done = await actions.applyLines(
      head,
      source,
      diff.path,
      [...selection],
      t('compare.linesContext', { path: diff.path, from: comparison.from, to: comparison.to }),
      t('messages.linesFromRef', { path: diff.path, ref: comparison.to })
    )
    if (done) setSelection(new Set())
  }

  const copyVersion = async (file: ChangedFile) => {
    if (!head || !comparison) return
    await run(t('busy.copyingVersion'), () =>
      git.cherryPickFiles(head, [comparison.to], file.oldPath ? [file.path, file.oldPath] : [file.path], 'version')
    )
  }

  const setup = (
    <div className="compare">
      <div className="compare-bar">
        <datalist id="compare-refs">
          {refs.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        <label className="field inline">
          <span>{t('compare.from')}</span>
          <input list="compare-refs" value={from} onChange={(e) => setFrom(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !loading && doCompare()} placeholder={t('compare.refPlaceholder')} />
        </label>
        <button className="icon-button" onClick={swap} title={t('compare.swap')}>
          ⇄
        </button>
        <label className="field inline">
          <span>{t('compare.to')}</span>
          <input list="compare-refs" value={to} onChange={(e) => setTo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !loading && doCompare()} placeholder={t('compare.refPlaceholder')} />
        </label>
        <label className="checkbox" title={t('compare.sinceBaseHelp')}>
          <input type="checkbox" checked={sinceBase} onChange={(e) => setSinceBase(e.target.checked)} />
          {t('compare.sinceBase')}
        </label>
        <button className="primary" onClick={() => onRequest({ from, to })} disabled={loading}>
          {loading ? <Loader size="sm" /> : t('compare.compare')}
        </button>
      </div>
      {!comparison ? (
        <p className="empty">{t('compare.empty')}</p>
      ) : (
        <div className="compare-side">
          <CommitGroup
            title={t('compare.onlyIn', { ref: comparison.to })}
            commits={comparison.onlyTo}
            active={commit}
            onOpen={openCommit}
            onMenu={commitMenu}
            action={
              head && comparison.onlyTo.length > 0 && head !== comparison.to
                ? { label: `🍒 ${t('compare.takeTo', { target: head })}`, run: () => actions.cherryPickCommits(head, [...comparison.onlyTo].reverse().map((c) => c.sha)) }
                : undefined
            }
          />
          <CommitGroup title={t('compare.onlyIn', { ref: comparison.from })} commits={comparison.onlyFrom} active={commit} onOpen={openCommit} onMenu={commitMenu} />
        </div>
      )}
    </div>
  )

  const filesPane = (
    <LoadingOverlay active={loading} label={t('loader.compare')} className="loading-fill">
      {!comparison ? (
      <p className="empty">{t('compare.empty')}</p>
    ) : (
      <div className="compare-side">
        <div className="group-header">
          <strong>{t('compare.differentFiles')}</strong> <span className="count">{comparison.files.length}</span>
          <span className="toolbar-spacer" />
          <FileViewOptions />
        </div>
        {comparison.files.length === 0 ? (
          <p className="empty small">{t('compare.identical')}</p>
        ) : (
          <ul className="file-list">
            <FileEntries
              items={comparison.files}
              pathOf={(f) => f.path}
              oldPathOf={(f) => f.oldPath}
              statusOf={(f) => f.status}
              render={(f, { label, style }) => (
                <li
                  key={f.path}
                  style={style}
                  className={`file-item ${active?.path === f.path ? 'active' : ''}`}
                  onClick={() => {
                    setCommit(null)
                    setActive(f)
                    revealView('compare.diff')
                  }}
                  onContextMenu={(e) => fileMenu(e, f)}
                >
                  <span className={`status status-${f.status}`} title={statusLabel(f.status)}>
                    {f.status}
                  </span>
                  {label}
                  <LineStats stats={f} />
                </li>
              )}
            />
          </ul>
        )}
      </div>
    )}
    </LoadingOverlay>
  )

  const diffPane = (
    <section className="details">
      {!comparison || !active ? (
        <p className="empty">{t('compare.selectFile')}</p>
      ) : !diff ? (
        <LoaderPane label={t('loader.diff')} />
      ) : (
        <div className="diff-panel">
          <DiffView
            file={diff}
            selection={head ? selection : undefined}
            onSelectionChange={setSelection}
            panelActions={[
              // As refs comparadas ficavam na barra removida; no menu continuam à vista.
              { label: `${shortSha(base!)} → ${comparison.to}`, disabled: true },
              {
                label: `⧉ ${t('diffExtra.openWindow')}`,
                hint: t('diffExtra.openWindowHelp'),
                onClick: () => source && openDiffWindow({ source, path: active.path, title: `${active.path} · ${shortSha(base!)} → ${comparison.to}` })
              },
              ...(head
                ? [
                    {
                      label: t('common.applyLinesInto', { count: selection.size, target: head }),
                      disabled: !selection.size,
                      hint: selection.size ? undefined : t('feedback.blocked.noSelection'),
                      onClick: applyLines
                    },
                    { label: t('compare.copyVersion', { ref: comparison.to }), hint: t('compare.copyVersionHelp', { target: head, ref: comparison.to }), onClick: () => copyVersion(active) }
                  ]
                : []),
              { label: t('common.blameHistory'), onClick: () => openFileView(active.path) }
            ]}
            fileNav={{
              index: Math.max(0, comparison.files.findIndex((f) => f.path === active?.path)),
              count: comparison.files.length,
              go: (delta) => {
                const next = comparison.files[stepIndex(comparison.files.findIndex((f) => f.path === active?.path), delta, comparison.files.length)]
                if (next) setActive(next)
              }
            }}
          />
        </div>
      )}
    </section>
  )

  return (
    <>
      <PaneSlot id="compare.setup">{setup}</PaneSlot>
      <PaneSlot id="compare.files">{filesPane}</PaneSlot>
      <PaneSlot id="compare.diff">{diffPane}</PaneSlot>
    </>
  )
}

function CommitGroup({
  title,
  commits,
  active,
  onOpen,
  onMenu,
  action
}: {
  title: string
  commits: CommitInfo[]
  active: string | null
  onOpen(sha: string): void
  onMenu(e: React.MouseEvent, sha: string): void
  action?: { label: string; run(): void }
}) {
  const [open, setOpen] = useState(commits.length <= 15)
  return (
    <div className="compare-group">
      <div className="group-header">
        <button className="link" onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'}
        </button>
        <strong>{title}</strong> <span className="count">{commits.length}</span>
        <span className="toolbar-spacer" />
        {action && <button onClick={action.run}>{action.label}</button>}
      </div>
      {open &&
        (commits.length === 0 ? (
          <p className="empty small">{t('compare.noCommits')}</p>
        ) : (
          <ul className="compare-commits">
            {commits.map((c) => (
              <li
                key={c.sha}
                className={active === c.sha ? 'active' : ''}
                onClick={() => onOpen(c.sha)}
                onContextMenu={(e) => onMenu(e, c.sha)}
                title={t('compare.showCommitHelp')}
              >
                <code>{shortSha(c.sha)}</code>
                <span className="commit-subject">{c.subject}</span>
                <small className="muted">
                  {c.author} · {relativeDate(c.date)}
                </small>
              </li>
            ))}
          </ul>
        ))}
    </div>
  )
}
