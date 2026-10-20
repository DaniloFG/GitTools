import { useEffect, useMemo, useState } from 'react'
import type { BlameResult, FileDiff, FileHistoryEntry, LineKey } from '../../../shared/types'
import { currentBranch, useApp } from '../context'
import { errorMessage, fullDate, plural, relativeDate, shortSha } from '../format'
import { git } from '../git'
import { DiffView } from './DiffView'

const MAX_LISTED = 500
const UNCOMMITTED = /^0+$/

/** Explorador de arquivos com blame por linha e histórico de cada arquivo. */
export function FilesView({ path, onPath }: { path: string | null; onPath(path: string): void }) {
  const { data, toast } = useApp()
  const [files, setFiles] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const [tab, setTab] = useState<'blame' | 'history'>('blame')
  const [blameRev, setBlameRev] = useState<string | undefined>(undefined)

  useEffect(() => {
    git.listFiles().then(setFiles, (e) => toast('error', errorMessage(e)))
  }, [data.status.headSha, toast])

  useEffect(() => setBlameRev(undefined), [path])

  const filtered = useMemo(() => {
    const terms = filter.toLowerCase().split(/\s+/).filter(Boolean)
    return files.filter((f) => terms.every((t) => f.toLowerCase().includes(t)))
  }, [files, filter])

  return (
    <div className="split">
      <div className="files-list">
        <input className="files-filter" placeholder={`Filtrar ${files.length} arquivos…`} value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
        <ul className="file-list">
          {filtered.slice(0, MAX_LISTED).map((f) => (
            <li key={f} className={`file-item ${f === path ? 'active' : ''}`} onClick={() => onPath(f)} title={f}>
              <span className="file-path">{f}</span>
            </li>
          ))}
        </ul>
        {filtered.length > MAX_LISTED && <p className="muted small">Mostrando {MAX_LISTED} de {filtered.length}. Refine o filtro.</p>}
      </div>
      <section className="details file-details">
        {!path ? (
          <p className="empty">Escolha um arquivo para ver quem alterou cada linha (blame) e o histórico dele.</p>
        ) : (
          <>
            <div className="file-header">
              <code className="diff-path">{path}</code>
              <span className="toolbar-spacer" />
              <button onClick={() => window.gittools.openFile(path)}>Abrir no editor</button>
            </div>
            <nav className="tabs">
              <button className={tab === 'blame' ? 'active' : ''} onClick={() => setTab('blame')}>
                Blame{blameRev ? ` em ${shortSha(blameRev)}` : ''}
              </button>
              <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
                Histórico do arquivo
              </button>
            </nav>
            {tab === 'blame' ? (
              <BlameView path={path} rev={blameRev} onClearRev={() => setBlameRev(undefined)} />
            ) : (
              <FileHistory
                path={path}
                onBlameAt={(sha) => {
                  setBlameRev(sha)
                  setTab('blame')
                }}
              />
            )}
          </>
        )}
      </section>
    </div>
  )
}

function BlameView({ path, rev, onClearRev }: { path: string; rev?: string; onClearRev(): void }) {
  const { selectCommit, data } = useApp()
  const [blame, setBlame] = useState<BlameResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setBlame(null)
    setError(null)
  }, [path, rev])

  // Recarrega também quando o repositório muda (sem apagar a tela enquanto carrega).
  useEffect(() => {
    let cancelled = false
    git.blame(path, rev).then(
      (b) => !cancelled && setBlame(b),
      (e) => !cancelled && setError(errorMessage(e))
    )
    return () => {
      cancelled = true
    }
  }, [path, rev, data.status])

  const range = useMemo(() => {
    const dates = Object.values(blame?.commits ?? {})
      .filter((c) => !UNCOMMITTED.test(c.sha))
      .map((c) => c.date)
    return { min: Math.min(...dates), max: Math.max(...dates) }
  }, [blame])

  if (error) return <p className="empty">{error}</p>
  if (!blame) return <p className="empty"><span className="spinner" /></p>

  const heat = (date: number) => (range.max > range.min ? (date - range.min) / (range.max - range.min) : 1)

  return (
    <>
      {rev && (
        <p className="muted small">
          Mostrando o arquivo como estava em {shortSha(rev)}.{' '}
          <button className="link" onClick={onClearRev}>
            ver versão atual
          </button>
        </p>
      )}
      <table className="blame-table">
        <tbody>
          {blame.lines.map((line, i) => {
            const commit = blame.commits[line.sha]
            const first = i === 0 || blame.lines[i - 1].sha !== line.sha
            // A segunda linha de cada bloco mostra o resumo do commit.
            const second = !first && (i === 1 || blame.lines[i - 2].sha !== line.sha)
            const uncommitted = UNCOMMITTED.test(line.sha)
            const h = uncommitted ? 1 : heat(commit.date)
            return (
              <tr key={line.line} className={first ? 'blame-first' : ''}>
                <td
                  className="blame-gutter"
                  style={{ borderLeftColor: `color-mix(in srgb, var(--accent) ${Math.round(15 + h * 85)}%, transparent)` }}
                  title={uncommitted ? 'Alteração ainda não commitada' : `${commit.summary}\n${commit.author} · ${fullDate(commit.date)}\n${commit.sha}\n\nClique para abrir o commit`}
                  onClick={() => !uncommitted && selectCommit(line.sha)}
                >
                  {first &&
                    (uncommitted ? (
                      <span className="muted">não commitado</span>
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
          })}
        </tbody>
      </table>
    </>
  )
}

function FileHistory({ path, onBlameAt }: { path: string; onBlameAt(sha: string): void }) {
  const { data, run, confirm, choose, toast, selectCommit } = useApp()
  const head = currentBranch(data)
  const [entries, setEntries] = useState<FileHistoryEntry[] | null>(null)
  const [active, setActive] = useState<FileHistoryEntry | null>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [selection, setSelection] = useState<Set<LineKey>>(new Set())

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
    git.diff({ kind: 'commit', sha: active.sha, path: active.path }).then(
      (files) => setDiff(files.find((f) => f.path === active.path || f.oldPath === active.path) ?? files[0] ?? null),
      (e) => toast('error', errorMessage(e))
    )
  }, [active, toast])

  if (!entries) return <p className="empty"><span className="spinner" /></p>
  if (entries.length === 0) return <p className="empty">Este arquivo ainda não tem commits.</p>

  const restore = async (entry: FileHistoryEntry) => {
    const ok = await confirm({
      title: 'Restaurar versão',
      message: `O arquivo ${entry.path} voltará a ficar como no commit ${shortSha(entry.sha)} ("${entry.subject}").\nA alteração fica no stage para você revisar e fazer commit.`,
      confirmLabel: 'Restaurar'
    })
    if (ok) await run('Restaurando', () => git.restoreFile(entry.sha, entry.path))
  }

  const applyLines = async () => {
    if (!head || !active || !diff) return
    const choice = await choose({
      title: `Aplicar ${plural(selection.size, 'linha', 'linhas')} em ${head}`,
      message: `De ${diff.path} no commit ${shortSha(active.sha)}`,
      options: [
        { id: 'stage', label: 'Aplicar e deixar no stage' },
        { id: 'commit', label: 'Aplicar e criar commit' }
      ]
    })
    if (!choice) return
    const message = choice.id === 'commit' ? `${active.subject}\n\n(linhas de ${diff.path} trazidas do commit ${active.sha})` : undefined
    await run('Aplicando linhas', () => git.cherryPickLines(head, { kind: 'commit', sha: active.sha }, diff.path, [...selection], { commitMessage: message }))
  }

  return (
    <div className="file-history">
      <ul className="compare-commits history-list">
        {entries.map((e) => (
          <li key={e.sha} className={active?.sha === e.sha ? 'active' : ''} onClick={() => setActive(e)}>
            <code>{shortSha(e.sha)}</code>
            <span className="commit-subject">{e.subject}</span>
            {e.path !== path && <span className="tag" title="Nome do arquivo neste commit">{e.path}</span>}
            <small className="muted">
              {e.author} · {relativeDate(e.date)}
            </small>
          </li>
        ))}
      </ul>
      {active && (
        <div className="diff-panel">
          <div className="selection-bar">
            <button onClick={() => selectCommit(active.sha)}>Ver commit</button>
            <button onClick={() => onBlameAt(active.sha)}>Blame nesta versão</button>
            <button onClick={() => restore(active)}>Restaurar esta versão</button>
            {head && (
              <button className="primary" disabled={!selection.size} onClick={applyLines}>
                Aplicar {selection.size ? plural(selection.size, 'linha', 'linhas') : 'linhas'} em {head}
              </button>
            )}
          </div>
          {diff ? <DiffView file={diff} selection={head ? selection : undefined} onSelectionChange={setSelection} /> : <p className="empty"><span className="spinner" /></p>}
        </div>
      )}
    </div>
  )
}
