import { useEffect, useState } from 'react'
import type { ChangedFile, CommitInfo, Comparison, DiffSource, FileDiff, LineKey } from '../../../shared/types'
import { useActions } from '../actions'
import { currentBranch, useApp, type CompareRequest } from '../context'
import { errorMessage, plural, relativeDate, shortSha, statusLabel } from '../format'
import { git } from '../git'
import { DiffView } from './DiffView'

interface Props {
  request: CompareRequest
  onRequest(request: CompareRequest): void
}

/** Compara duas branches, tags ou commits quaisquer. */
export function CompareView({ request, onRequest }: Props) {
  const { data, run, choose, toast, selectCommit, openFileView } = useApp()
  const actions = useActions()
  const head = currentBranch(data)
  const defaultTo = data.branches.find((b) => !b.remote && b.name !== head)?.name ?? ''
  const [from, setFrom] = useState(request.from ?? head ?? 'HEAD')
  const [to, setTo] = useState(request.to ?? defaultTo)
  const [sinceBase, setSinceBase] = useState(true)
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState<ChangedFile | null>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [selection, setSelection] = useState<Set<LineKey>>(new Set())

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
  const source: DiffSource | null = comparison && base ? { kind: 'range', from: base, to: comparison.to } : null

  useEffect(() => {
    setDiff(null)
    setSelection(new Set())
    if (!source || !active) return
    let cancelled = false
    git.diff({ ...source, path: active.path }).then(
      (files) => !cancelled && setDiff(files.find((f) => f.path === active.path) ?? files[0] ?? null),
      (e) => !cancelled && toast('error', errorMessage(e))
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, comparison])

  const swap = () => {
    setFrom(to)
    setTo(from)
    onRequest({ from: to, to: from })
  }

  const applyLines = async () => {
    if (!head || !diff || !source || !comparison) return
    const choice = await choose({
      title: `Aplicar ${plural(selection.size, 'linha', 'linhas')} em ${head}`,
      message: `De ${diff.path} (${comparison.from} → ${comparison.to})`,
      options: [
        { id: 'stage', label: 'Aplicar e deixar no stage' },
        { id: 'commit', label: 'Aplicar e criar commit' }
      ]
    })
    if (!choice) return
    const message = choice.id === 'commit' ? `Traz linhas de ${diff.path} de ${comparison.to}` : undefined
    await run('Aplicando linhas', () => git.cherryPickLines(head, source, diff.path, [...selection], { commitMessage: message }))
    setSelection(new Set())
  }

  const copyVersion = async (file: ChangedFile) => {
    if (!head || !comparison) return
    await run('Copiando versão', () =>
      git.cherryPickFiles(head, [comparison.to], file.oldPath ? [file.path, file.oldPath] : [file.path], 'version')
    )
  }

  return (
    <div className="compare">
      <div className="compare-bar">
        <datalist id="compare-refs">
          {refs.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        <label className="field inline">
          <span>De</span>
          <input list="compare-refs" value={from} onChange={(e) => setFrom(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doCompare()} placeholder="branch, tag ou commit" />
        </label>
        <button className="icon-button" onClick={swap} title="Inverter">
          ⇄
        </button>
        <label className="field inline">
          <span>Para</span>
          <input list="compare-refs" value={to} onChange={(e) => setTo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doCompare()} placeholder="branch, tag ou commit" />
        </label>
        <label className="checkbox" title="Mostra só o que mudou em “Para” desde que as duas linhas de histórico se separaram (git diff A...B)">
          <input type="checkbox" checked={sinceBase} onChange={(e) => setSinceBase(e.target.checked)} />
          Só o que mudou em “Para” desde o ancestral comum
        </label>
        <button className="primary" onClick={() => onRequest({ from, to })} disabled={loading}>
          {loading ? <span className="spinner" /> : 'Comparar'}
        </button>
      </div>

      {!comparison ? (
        <p className="empty">Escolha duas branches, tags ou commits e clique em Comparar.</p>
      ) : (
        <div className="split">
          <div className="compare-side">
            <CommitGroup
              title={`Só em ${comparison.to}`}
              commits={comparison.onlyTo}
              onOpen={selectCommit}
              action={
                head && comparison.onlyTo.length > 0 && head !== comparison.to
                  ? { label: `🍒 Levar para ${head}`, run: () => actions.cherryPickCommits(head, [...comparison.onlyTo].reverse().map((c) => c.sha)) }
                  : undefined
              }
            />
            <CommitGroup title={`Só em ${comparison.from}`} commits={comparison.onlyFrom} onOpen={selectCommit} />
            <div className="group-header">
              <strong>Arquivos diferentes</strong> <span className="count">{comparison.files.length}</span>
            </div>
            {comparison.files.length === 0 ? (
              <p className="empty small">O conteúdo é idêntico.</p>
            ) : (
              <ul className="file-list">
                {comparison.files.map((f) => (
                  <li key={f.path} className={`file-item ${active?.path === f.path ? 'active' : ''}`} onClick={() => setActive(f)}>
                    <span className={`status status-${f.status}`} title={statusLabel(f.status)}>
                      {f.status}
                    </span>
                    <span className="file-path">{f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <section className="details">
            {!active ? (
              <p className="empty">Selecione um arquivo.</p>
            ) : !diff ? (
              <p className="empty">
                <span className="spinner" />
              </p>
            ) : (
              <div className="diff-panel">
                <div className="selection-bar">
                  <span className="muted">
                    {shortSha(base!)} → {comparison.to}
                  </span>
                  {head && (
                    <>
                      <button className="primary" disabled={!selection.size} onClick={applyLines}>
                        Aplicar {selection.size ? plural(selection.size, 'linha', 'linhas') : 'linhas'} em {head}
                      </button>
                      <button onClick={() => copyVersion(active)} title={`O arquivo em ${head} fica igual ao de ${comparison.to}`}>
                        Copiar versão de {comparison.to}
                      </button>
                    </>
                  )}
                  <button onClick={() => openFileView(active.path)}>Blame / histórico</button>
                </div>
                <DiffView file={diff} selection={head ? selection : undefined} onSelectionChange={setSelection} />
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function CommitGroup({
  title,
  commits,
  onOpen,
  action
}: {
  title: string
  commits: CommitInfo[]
  onOpen(sha: string): void
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
          <p className="empty small">Nenhum commit.</p>
        ) : (
          <ul className="compare-commits">
            {commits.map((c) => (
              <li key={c.sha} onClick={() => onOpen(c.sha)} title="Abrir no histórico">
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
