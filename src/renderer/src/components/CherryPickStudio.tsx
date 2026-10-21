import { useEffect, useMemo, useState } from 'react'
import type { BranchCommit, ChangedFile, DiffSource, FileApplyMode, FileDiff, LineKey, OperationResult } from '../../../shared/types'
import { currentBranch, useApp, type StudioRequest } from '../context'
import { errorMessage, relativeDate, shortSha, statusLabel } from '../format'
import { t, type MessageKey } from '../i18n'
import { git } from '../git'
import { DiffView } from './DiffView'
import { Modal } from './Modal'
import { ResizableBox } from './ResizableBox'
import { Split } from './Split'

type Mode = 'branch' | 'commits' | 'files' | 'lines'

const MODES: { id: Mode; label: MessageKey; help: MessageKey }[] = [
  { id: 'branch', label: 'studio.modes.branch', help: 'studio.modes.branchHelp' },
  { id: 'commits', label: 'studio.modes.commits', help: 'studio.modes.commitsHelp' },
  { id: 'files', label: 'studio.modes.files', help: 'studio.modes.filesHelp' },
  { id: 'lines', label: 'studio.modes.lines', help: 'studio.modes.linesHelp' }
]

/** Valor especial de origem: commits escolhidos no histórico, sem branch de origem. */
const SELECTION = '\u0000selection'

export function CherryPickStudio({ request, onClose }: { request: StudioRequest; onClose(): void }) {
  const { data, run, toast } = useApp()
  const head = currentBranch(data)
  const local = data.branches.filter((b) => !b.remote)
  const fromSelection = !!request.commits?.length && !request.source

  const [source, setSource] = useState<string>(
    fromSelection ? SELECTION : request.source ?? data.branches.find((b) => b.name !== (request.target ?? head))?.name ?? ''
  )
  const [target, setTarget] = useState<string>(request.target ?? head ?? local[0]?.name ?? '')
  const [mode, setMode] = useState<Mode>(request.mode ?? (fromSelection ? 'commits' : 'branch'))
  const [commits, setCommits] = useState<BranchCommit[] | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [recordOrigin, setRecordOrigin] = useState(true)
  const [noCommit, setNoCommit] = useState(false)
  const [autoCommit, setAutoCommit] = useState(true)
  const [message, setMessage] = useState('')
  const [messageTouched, setMessageTouched] = useState(false)

  const [files, setFiles] = useState<ChangedFile[]>([])
  const [checkedFiles, setCheckedFiles] = useState<Set<string>>(new Set())
  const [fileMode, setFileMode] = useState<FileApplyMode>('changes')
  const [linePath, setLinePath] = useState<string | null>(null)
  const [lineDiff, setLineDiff] = useState<FileDiff | null>(null)
  const [lineSelection, setLineSelection] = useState<Set<LineKey>>(new Set())

  // Carrega os commits candidatos.
  useEffect(() => {
    setCommits(null)
    let cancelled = false
    const load = async (): Promise<BranchCommit[]> => {
      if (source === SELECTION) {
        const details = await Promise.all(request.commits!.map((sha) => git.commitDetails(sha)))
        return details.sort((a, b) => b.date - a.date).map((d) => ({ ...d, alreadyApplied: false }))
      }
      if (!source || !target || source === target) return []
      return git.branchCommits(source, target)
    }
    load().then(
      (list) => {
        if (cancelled) return
        setCommits(list)
        const preset = request.commits?.length ? new Set(request.commits) : null
        setChecked(new Set(list.filter((c) => (preset ? preset.has(c.sha) : !c.alreadyApplied)).map((c) => c.sha)))
      },
      (e) => {
        if (cancelled) return
        setCommits([])
        toast('error', errorMessage(e))
      }
    )
    return () => {
      cancelled = true
    }
  }, [source, target, request.commits, toast])

  const chosen = useMemo(() => (commits ?? []).filter((c) => checked.has(c.sha)), [commits, checked])
  const pending = (commits ?? []).filter((c) => !c.alreadyApplied)

  // Arquivos alterados pelos commits marcados.
  useEffect(() => {
    if (mode !== 'files' && mode !== 'lines') return
    if (!chosen.length) {
      setFiles([])
      return
    }
    let cancelled = false
    git.filesChangedBy(chosen.map((c) => c.sha)).then(
      (list) => {
        if (cancelled) return
        setFiles(list)
        setCheckedFiles((prev) => new Set(list.map((f) => f.path).filter((p) => prev.has(p))))
        setLinePath((prev) => (prev && list.some((f) => f.path === prev) ? prev : list[0]?.path ?? null))
      },
      (e) => !cancelled && toast('error', errorMessage(e))
    )
    return () => {
      cancelled = true
    }
  }, [mode, chosen, toast])

  // Diferença usada no modo "Linhas": um commit, ou do pai do mais antigo até o mais novo marcado.
  const lineSource = useMemo<DiffSource | null>(() => {
    if (!chosen.length) return null
    if (chosen.length === 1) return { kind: 'commit', sha: chosen[0].sha }
    const newest = chosen[0]
    const oldest = chosen[chosen.length - 1]
    if (!oldest.parents[0]) return null
    return { kind: 'range', from: oldest.parents[0], to: newest.sha }
  }, [chosen])

  useEffect(() => {
    setLineDiff(null)
    setLineSelection(new Set())
    if (mode !== 'lines' || !lineSource || !linePath) return
    let cancelled = false
    git.diff({ ...lineSource, path: linePath }).then(
      (list) => !cancelled && setLineDiff(list.find((f) => f.path === linePath) ?? list[0] ?? null),
      (e) => !cancelled && toast('error', errorMessage(e))
    )
    return () => {
      cancelled = true
    }
  }, [mode, lineSource, linePath, toast])

  // Mensagem de commit sugerida.
  useEffect(() => {
    if (messageTouched) return
    const origin = source === SELECTION ? t('studio.selectedCommits') : source
    if (chosen.length === 1) {
      const note =
        mode === 'lines'
          ? t('messages.partialLines', { path: linePath ?? '', sha: shortSha(chosen[0].sha) })
          : t('messages.partialFiles', { sha: shortSha(chosen[0].sha) })
      setMessage(`${chosen[0].subject}\n\n${note}`)
    } else if (chosen.length > 1) {
      setMessage(
        `${t('messages.partialFrom', { origin })}\n\n${t('messages.sourceCommits')}\n${chosen.map((c) => `- ${shortSha(c.sha)} ${c.subject}`).join('\n')}`
      )
    }
  }, [chosen, mode, linePath, source, messageTouched])

  const targetIsHead = target === head
  const sourceLabel = source === SELECTION ? t('studio.selectedCommits') : source

  const finish = (result: OperationResult | undefined) => {
    if (result) onClose()
  }

  const apply = async () => {
    const commitMessage = autoCommit && message.trim() ? message : undefined
    if (mode === 'branch') {
      finish(await run(t('busy.cherryPickFrom', { ref: source }), () => git.cherryPickBranch(source, target, { recordOrigin })))
    } else if (mode === 'commits') {
      finish(await run(t('busy.cherryPick'), () => git.cherryPickCommits(target, chosen.map((c) => c.sha), { recordOrigin, noCommit })))
    } else if (mode === 'files') {
      const paths = files.filter((f) => checkedFiles.has(f.path)).flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path]))
      finish(
        await run(t('busy.applyingFiles'), () =>
          git.cherryPickFiles(target, chosen.map((c) => c.sha), paths, fileMode, { commitMessage })
        )
      )
    } else if (lineSource && lineDiff) {
      finish(
        await run(t('busy.applyingLines'), () =>
          git.cherryPickLines(target, lineSource, lineDiff.path, [...lineSelection], { commitMessage })
        )
      )
    }
  }

  const canApply =
    !!target &&
    commits !== null &&
    (mode === 'branch'
      ? source !== SELECTION && pending.length > 0
      : mode === 'commits'
        ? chosen.length > 0
        : mode === 'files'
          ? chosen.length > 0 && checkedFiles.size > 0
          : !!lineDiff && lineSelection.size > 0)

  const into = target || '…'
  const applyLabel =
    mode === 'branch'
      ? t('studio.applyCommits', { count: pending.length, target: into })
      : mode === 'commits'
        ? t('studio.applyCommits', { count: chosen.length, target: into })
        : mode === 'files'
          ? t('studio.applyFiles', { count: checkedFiles.size, target: into })
          : t('common.applyLinesInto', { count: lineSelection.size, target: into })

  const toggle = (sha: string, on: boolean) => {
    const next = new Set(checked)
    if (on) next.add(sha)
    else next.delete(sha)
    setChecked(next)
  }

  return (
    <Modal
      title={`🍒 ${t('studio.name')}`}
      onClose={onClose}
      size="large"
      id="studio"
      footer={
        <>
          <span className="muted footer-summary">
            {target && !targetIsHead && `${t('studio.willCheckout', { target })} `}
            {mode !== 'branch' && mode !== 'commits' && !autoCommit && t('studio.leftStaged')}
          </span>
          <button onClick={onClose}>{t('common.cancel')}</button>
          <button className="primary" disabled={!canApply} onClick={apply}>
            {applyLabel}
          </button>
        </>
      }
    >
      <div className="studio">
        <div className="studio-branches">
          <label className="field inline">
            <span>{t('studio.source')}</span>
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              {fromSelection && <option value={SELECTION}>{t('studio.selectedInHistory')}</option>}
              <optgroup label={t('studio.localBranches')}>
                {local.map((b) => (
                  <option key={b.fullRef} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t('studio.remoteBranches')}>
                {data.branches
                  .filter((b) => b.remote)
                  .map((b) => (
                    <option key={b.fullRef} value={b.name}>
                      {b.name}
                    </option>
                  ))}
              </optgroup>
            </select>
          </label>
          <button
            className="icon-button"
            title={t('studio.swap')}
            disabled={source === SELECTION || !local.some((b) => b.name === source)}
            onClick={() => {
              setSource(target)
              setTarget(source)
            }}
          >
            ⇄
          </button>
          <span className="arrow">→</span>
          <label className="field inline">
            <span>{t('studio.target')}</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {local.map((b) => (
                <option key={b.fullRef} value={b.name}>
                  {b.name}
                  {b.current ? ` ${t('studio.currentSuffix')}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        <Split id="studio" className="studio-body" initial={0.38} min={[220, 320]}>
          <div className="studio-commits">
            <div className="group-header">
              <strong>{t('studio.commitsOf', { source: sourceLabel })}</strong>
              {commits && <span className="count">{commits.length}</span>}
              <span className="toolbar-spacer" />
              {mode !== 'branch' && commits && commits.length > 0 && (
                <>
                  <button className="link" onClick={() => setChecked(new Set(pending.map((c) => c.sha)))}>
                    {t('common.all')}
                  </button>
                  <button className="link" onClick={() => setChecked(new Set())}>
                    {t('common.none')}
                  </button>
                </>
              )}
            </div>
            {commits === null ? (
              <p className="empty">
                <span className="spinner" /> {t('studio.comparing')}
              </p>
            ) : source === target ? (
              <p className="empty">{t('studio.sameBranch')}</p>
            ) : commits.length === 0 ? (
              <p className="empty">{t('studio.nothingToBring', { target, source: sourceLabel })}</p>
            ) : (
              <ul className="studio-commit-list">
                {commits.map((c) => (
                  <li key={c.sha} className={c.alreadyApplied ? 'applied' : ''} title={c.alreadyApplied ? t('studio.alreadyAppliedHelp') : c.subject}>
                    <label>
                      <input
                        type="checkbox"
                        disabled={mode === 'branch'}
                        checked={mode === 'branch' ? !c.alreadyApplied : checked.has(c.sha)}
                        onChange={(e) => toggle(c.sha, e.target.checked)}
                      />
                      <code>{shortSha(c.sha)}</code>
                      <span className="commit-subject">{c.subject}</span>
                      {c.alreadyApplied && <span className="tag">{t('studio.alreadyApplied')}</span>}
                      <small className="muted">{relativeDate(c.date)}</small>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="studio-main">
            <nav className="tabs">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  className={mode === m.id ? 'active' : ''}
                  disabled={m.id === 'branch' && source === SELECTION}
                  onClick={() => setMode(m.id)}
                >
                  {t(m.label)}
                </button>
              ))}
            </nav>
            <p className="muted">{t(MODES.find((m) => m.id === mode)!.help)}</p>

            {(mode === 'branch' || mode === 'commits') && (
              <div className="studio-options">
                <p>
                  {mode === 'branch'
                    ? t('studio.willApplyBranch', { count: pending.length, target })
                    : t('studio.willApplyChecked', { count: chosen.length, target })}
                  {(commits?.length ?? 0) > pending.length && ` ${t('studio.equivalentInTarget', { count: (commits?.length ?? 0) - pending.length })}`}
                </p>
                <label className="checkbox">
                  <input type="checkbox" checked={recordOrigin} onChange={(e) => setRecordOrigin(e.target.checked)} />
                  {t('studio.recordOrigin')}
                </label>
                {mode === 'commits' && (
                  <label className="checkbox">
                    <input type="checkbox" checked={noCommit} onChange={(e) => setNoCommit(e.target.checked)} />
                    {t('studio.noCommit')}
                  </label>
                )}
                <p className="muted small">{t('studio.conflictNote')}</p>
              </div>
            )}

            {mode === 'files' && (
              <div className="studio-options">
                {chosen.length === 0 ? (
                  <p className="empty">{t('studio.checkACommit')}</p>
                ) : (
                  <>
                    <div className="group-header">
                      <strong>{t('studio.changedFiles')}</strong> <span className="count">{files.length}</span>
                      <span className="toolbar-spacer" />
                      <button className="link" onClick={() => setCheckedFiles(new Set(files.map((f) => f.path)))}>
                        {t('common.all')}
                      </button>
                      <button className="link" onClick={() => setCheckedFiles(new Set())}>
                        {t('common.none')}
                      </button>
                    </div>
                    <ResizableBox id="studio-files" className="bordered-box">
                      <ul className="file-list">
                        {files.map((f) => (
                          <li key={f.path} className="file-item">
                            <label>
                              <input
                                type="checkbox"
                                checked={checkedFiles.has(f.path)}
                                onChange={(e) => {
                                  const next = new Set(checkedFiles)
                                  if (e.target.checked) next.add(f.path)
                                  else next.delete(f.path)
                                  setCheckedFiles(next)
                                }}
                              />
                              <span className={`status status-${f.status}`} title={statusLabel(f.status)}>
                                {f.status}
                              </span>
                              <span className="file-path">{f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </ResizableBox>
                    <div className="radio-row">
                      <label className="checkbox">
                        <input type="radio" checked={fileMode === 'changes'} onChange={() => setFileMode('changes')} />
                        <span>
                          <strong>{t('actions.files.changes')}</strong> — {t('studio.changesHelp')}
                        </span>
                      </label>
                      <label className="checkbox">
                        <input type="radio" checked={fileMode === 'version'} onChange={() => setFileMode('version')} />
                        <span>
                          <strong>{t('studio.version')}</strong> — {t('studio.versionHelp')}
                        </span>
                      </label>
                    </div>
                  </>
                )}
              </div>
            )}

            {mode === 'lines' && (
              <div className="studio-lines">
                {chosen.length === 0 ? (
                  <p className="empty">{t('studio.checkACommit')}</p>
                ) : !lineSource ? (
                  <p className="empty">{t('studio.rootRange')}</p>
                ) : (
                  <>
                    <label className="field inline">
                      <span>{t('common.file')}</span>
                      <select value={linePath ?? ''} onChange={(e) => setLinePath(e.target.value)}>
                        {files.map((f) => (
                          <option key={f.path} value={f.path}>
                            {f.path}
                          </option>
                        ))}
                      </select>
                    </label>
                    {chosen.length > 1 && (
                      <p className="muted small">
                        {t('studio.cumulative', { from: shortSha(chosen[chosen.length - 1].sha), to: shortSha(chosen[0].sha) })}
                        {chosen.length < (commits?.length ?? 0) ? ` ${t('studio.includesIntermediate')}` : ''}
                      </p>
                    )}
                    {lineDiff ? (
                      <DiffView file={lineDiff} selection={lineSelection} onSelectionChange={setLineSelection} />
                    ) : (
                      <p className="empty">
                        <span className="spinner" />
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {(mode === 'files' || mode === 'lines') && chosen.length > 0 && (
              <div className="commit-box compact">
                <label className="checkbox">
                  <input type="checkbox" checked={autoCommit} onChange={(e) => setAutoCommit(e.target.checked)} />
                  {t('actions.files.autoCommit')}
                </label>
                {autoCommit && (
                  <textarea
                    rows={3}
                    value={message}
                    onChange={(e) => {
                      setMessage(e.target.value)
                      setMessageTouched(true)
                    }}
                  />
                )}
              </div>
            )}
          </div>
        </Split>
      </div>
    </Modal>
  )
}
