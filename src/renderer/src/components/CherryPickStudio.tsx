import { useEffect, useMemo, useState } from 'react'
import type { BranchCommit, ChangedFile, DiffSource, FileApplyMode, FileDiff, LineKey, OperationResult } from '../../../shared/types'
import { currentBranch, useApp, type StudioRequest } from '../context'
import { errorMessage, plural, relativeDate, shortSha, statusLabel } from '../format'
import { git } from '../git'
import { DiffView } from './DiffView'
import { Modal } from './Modal'

type Mode = 'branch' | 'commits' | 'files' | 'lines'

const MODES: { id: Mode; label: string; help: string }[] = [
  { id: 'branch', label: 'Branch inteira', help: 'Copia todos os commits da origem que ainda não estão no destino, na ordem certa.' },
  { id: 'commits', label: 'Commits', help: 'Copia só os commits marcados na lista ao lado.' },
  { id: 'files', label: 'Arquivos', help: 'Traz apenas alguns arquivos dos commits marcados.' },
  { id: 'lines', label: 'Linhas', help: 'Escolhe exatamente quais linhas trazer de um arquivo.' }
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
    const origin = source === SELECTION ? 'commits selecionados' : source
    const what = mode === 'lines' ? `linhas de ${linePath ?? ''}` : 'arquivos'
    if (chosen.length === 1) {
      setMessage(`${chosen[0].subject}\n\n(${what} trazidos de ${shortSha(chosen[0].sha)} via cherry-pick parcial)`)
    } else if (chosen.length > 1) {
      setMessage(
        `Cherry-pick parcial de ${origin}\n\nCommits de origem:\n${chosen.map((c) => `- ${shortSha(c.sha)} ${c.subject}`).join('\n')}`
      )
    }
  }, [chosen, mode, linePath, source, messageTouched])

  const targetIsHead = target === head
  const sourceLabel = source === SELECTION ? 'commits selecionados' : source

  const finish = (result: OperationResult | undefined) => {
    if (result) onClose()
  }

  const apply = async () => {
    const commitMessage = autoCommit && message.trim() ? message : undefined
    if (mode === 'branch') {
      finish(await run(`Cherry-pick de ${source}`, () => git.cherryPickBranch(source, target, { recordOrigin })))
    } else if (mode === 'commits') {
      finish(await run('Cherry-pick', () => git.cherryPickCommits(target, chosen.map((c) => c.sha), { recordOrigin, noCommit })))
    } else if (mode === 'files') {
      const paths = files.filter((f) => checkedFiles.has(f.path)).flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path]))
      finish(
        await run('Aplicando arquivos', () =>
          git.cherryPickFiles(target, chosen.map((c) => c.sha), paths, fileMode, { commitMessage })
        )
      )
    } else if (lineSource && lineDiff) {
      finish(
        await run('Aplicando linhas', () =>
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

  const applyLabel =
    mode === 'branch'
      ? `Aplicar ${plural(pending.length, 'commit', 'commits')}`
      : mode === 'commits'
        ? `Aplicar ${plural(chosen.length, 'commit', 'commits')}`
        : mode === 'files'
          ? `Aplicar ${plural(checkedFiles.size, 'arquivo', 'arquivos')}`
          : `Aplicar ${plural(lineSelection.size, 'linha', 'linhas')}`

  const toggle = (sha: string, on: boolean) => {
    const next = new Set(checked)
    if (on) next.add(sha)
    else next.delete(sha)
    setChecked(next)
  }

  return (
    <Modal
      title="🍒 Cherry-pick Studio"
      onClose={onClose}
      size="large"
      footer={
        <>
          <span className="muted footer-summary">
            {target && !targetIsHead && `Será feito checkout de "${target}" antes de aplicar. `}
            {mode !== 'branch' && mode !== 'commits' && !autoCommit && 'As alterações ficarão no stage para revisão.'}
          </span>
          <button onClick={onClose}>Cancelar</button>
          <button className="primary" disabled={!canApply} onClick={apply}>
            {applyLabel} em {target || '…'}
          </button>
        </>
      }
    >
      <div className="studio">
        <div className="studio-branches">
          <label className="field inline">
            <span>Origem</span>
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              {fromSelection && <option value={SELECTION}>Commits selecionados no histórico</option>}
              <optgroup label="Locais">
                {local.map((b) => (
                  <option key={b.fullRef} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Remotas">
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
            title="Inverter origem e destino"
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
            <span>Destino</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {local.map((b) => (
                <option key={b.fullRef} value={b.name}>
                  {b.name}
                  {b.current ? ' (atual)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="studio-body">
          <div className="studio-commits">
            <div className="group-header">
              <strong>Commits de {sourceLabel}</strong>
              {commits && <span className="count">{commits.length}</span>}
              <span className="toolbar-spacer" />
              {mode !== 'branch' && commits && commits.length > 0 && (
                <>
                  <button className="link" onClick={() => setChecked(new Set(pending.map((c) => c.sha)))}>
                    todos
                  </button>
                  <button className="link" onClick={() => setChecked(new Set())}>
                    nenhum
                  </button>
                </>
              )}
            </div>
            {commits === null ? (
              <p className="empty">
                <span className="spinner" /> Comparando branches…
              </p>
            ) : source === target ? (
              <p className="empty">Origem e destino são a mesma branch.</p>
            ) : commits.length === 0 ? (
              <p className="empty">Nada a trazer: {target} já tem tudo de {sourceLabel}.</p>
            ) : (
              <ul className="studio-commit-list">
                {commits.map((c) => (
                  <li key={c.sha} className={c.alreadyApplied ? 'applied' : ''} title={c.alreadyApplied ? 'Já existe um commit equivalente no destino' : c.subject}>
                    <label>
                      <input
                        type="checkbox"
                        disabled={mode === 'branch'}
                        checked={mode === 'branch' ? !c.alreadyApplied : checked.has(c.sha)}
                        onChange={(e) => toggle(c.sha, e.target.checked)}
                      />
                      <code>{shortSha(c.sha)}</code>
                      <span className="commit-subject">{c.subject}</span>
                      {c.alreadyApplied && <span className="tag">já aplicado</span>}
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
                  {m.label}
                </button>
              ))}
            </nav>
            <p className="muted">{MODES.find((m) => m.id === mode)!.help}</p>

            {(mode === 'branch' || mode === 'commits') && (
              <div className="studio-options">
                <p>
                  {mode === 'branch'
                    ? `${plural(pending.length, 'commit será aplicado', 'commits serão aplicados')} em ${target}, do mais antigo para o mais novo.`
                    : `${plural(chosen.length, 'commit marcado será aplicado', 'commits marcados serão aplicados')} em ${target}, do mais antigo para o mais novo.`}
                  {(commits?.length ?? 0) > pending.length && ` ${plural((commits?.length ?? 0) - pending.length, 'commit equivalente já está', 'commits equivalentes já estão')} no destino.`}
                </p>
                <label className="checkbox">
                  <input type="checkbox" checked={recordOrigin} onChange={(e) => setRecordOrigin(e.target.checked)} />
                  Registrar o commit de origem na mensagem (-x)
                </label>
                {mode === 'commits' && (
                  <label className="checkbox">
                    <input type="checkbox" checked={noCommit} onChange={(e) => setNoCommit(e.target.checked)} />
                    Não criar commits — só aplicar as alterações no stage (para juntar tudo num commit só)
                  </label>
                )}
                <p className="muted small">Se houver conflito, o GitTools para e mostra os arquivos para você escolher a versão, continuar, pular ou abortar.</p>
              </div>
            )}

            {mode === 'files' && (
              <div className="studio-options">
                {chosen.length === 0 ? (
                  <p className="empty">Marque ao menos um commit.</p>
                ) : (
                  <>
                    <div className="group-header">
                      <strong>Arquivos alterados</strong> <span className="count">{files.length}</span>
                      <span className="toolbar-spacer" />
                      <button className="link" onClick={() => setCheckedFiles(new Set(files.map((f) => f.path)))}>
                        todos
                      </button>
                      <button className="link" onClick={() => setCheckedFiles(new Set())}>
                        nenhum
                      </button>
                    </div>
                    <ul className="file-list bordered">
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
                    <div className="radio-row">
                      <label className="checkbox">
                        <input type="radio" checked={fileMode === 'changes'} onChange={() => setFileMode('changes')} />
                        <span>
                          <strong>Aplicar as alterações</strong> — traz só o que os commits mudaram nesses arquivos
                        </span>
                      </label>
                      <label className="checkbox">
                        <input type="radio" checked={fileMode === 'version'} onChange={() => setFileMode('version')} />
                        <span>
                          <strong>Copiar a versão</strong> — o arquivo fica igual ao do commit mais novo marcado
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
                  <p className="empty">Marque ao menos um commit.</p>
                ) : !lineSource ? (
                  <p className="empty">Não é possível montar a diferença a partir do primeiro commit do repositório; marque só ele ou outros commits.</p>
                ) : (
                  <>
                    <label className="field inline">
                      <span>Arquivo</span>
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
                        Mostrando a diferença acumulada de {shortSha(chosen[chosen.length - 1].sha)} até {shortSha(chosen[0].sha)}
                        {chosen.length < (commits?.length ?? 0) ? ' (inclui os commits intermediários)' : ''}.
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
                  Criar commit automaticamente
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
        </div>
      </div>
    </Modal>
  )
}
