import { useEffect, useState } from 'react'
import type { ChangedFile, CommitDetails, FileDiff, LineKey } from '../../../shared/types'
import { useActions } from '../actions'
import { useApp } from '../context'
import { endDrag, startDrag } from '../dnd'
import { errorMessage, fullDate, plural, shortSha, statusLabel } from '../format'
import { git } from '../git'
import { DiffView } from './DiffView'

export function CommitDetailsPanel({ selected }: { selected: string[] }) {
  if (selected.length === 0) {
    return (
      <section className="details empty-details">
        <h3>Dicas rápidas</h3>
        <ul className="tips">
          <li>
            <strong>Arraste um commit</strong> (ou vários, com Ctrl/Shift) para uma branch na barra lateral para fazer cherry-pick.
          </li>
          <li>
            <strong>Arraste uma branch</strong> sobre outra para merge, rebase ou cherry-pick da branch inteira.
          </li>
          <li>
            <strong>Clique num commit</strong> para ver os arquivos; arraste um arquivo para uma branch ou selecione linhas do diff e aplique só elas.
          </li>
          <li>
            Use o <strong>🍒 Cherry-pick Studio</strong> para escolher commits, arquivos ou linhas entre duas branches.
          </li>
        </ul>
      </section>
    )
  }
  if (selected.length > 1) return <MultiSelection shas={selected} />
  return <SingleCommit key={selected[0]} sha={selected[0]} />
}

function MultiSelection({ shas }: { shas: string[] }) {
  const { openStudio } = useApp()
  const actions = useActions()
  return (
    <section className="details">
      <h3>{plural(shas.length, 'commit selecionado', 'commits selecionados')}</h3>
      <p className="muted">Arraste a seleção para uma branch, ou:</p>
      <div className="button-column">
        {actions.head && (
          <button className="primary" onClick={() => actions.cherryPickCommits(actions.head!, shas)}>
            🍒 Cherry-pick em {actions.head}
          </button>
        )}
        <button onClick={() => openStudio({ target: actions.head ?? undefined, commits: shas, mode: 'files' })}>
          Escolher arquivos ou linhas destes commits…
        </button>
      </div>
    </section>
  )
}

function SingleCommit({ sha }: { sha: string }) {
  const { run, choose, toast, openFileView } = useApp()
  const actions = useActions()
  const head = actions.head
  const [details, setDetails] = useState<CommitDetails | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [active, setActive] = useState<ChangedFile | null>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [selection, setSelection] = useState<Set<LineKey>>(new Set())

  useEffect(() => {
    git.commitDetails(sha).then(
      (d) => {
        setDetails(d)
        setActive(d.files[0] ?? null)
      },
      (e) => toast('error', errorMessage(e))
    )
  }, [sha, toast])

  useEffect(() => {
    setSelection(new Set())
    setDiff(null)
    if (!active) return
    git.diff({ kind: 'commit', sha, path: active.path }).then(
      (files) => setDiff(files.find((f) => f.path === active.path) ?? files[0] ?? null),
      (e) => toast('error', errorMessage(e))
    )
  }, [sha, active, toast])

  if (!details) return <section className="details"><span className="spinner" /></section>

  const pathsOf = (files: ChangedFile[]) => files.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path]))
  const dragFiles = (file: ChangedFile) =>
    checked.has(file.path) ? details.files.filter((f) => checked.has(f.path)) : [file]

  const applyLines = async () => {
    if (!head || !diff) return
    const choice = await choose({
      title: `Aplicar ${plural(selection.size, 'linha', 'linhas')} em ${head}`,
      message: `De ${diff.path} no commit ${shortSha(sha)} — "${details.subject}"`,
      options: [
        { id: 'stage', label: 'Aplicar e deixar no stage', description: 'Você revisa e faz o commit quando quiser (aba Alterações).' },
        { id: 'commit', label: 'Aplicar e criar commit', description: 'Cria um commit com a mensagem do original e a referência de origem.' }
      ]
    })
    if (!choice) return
    const message = choice.id === 'commit' ? `${details.subject}\n\n(linhas de ${diff.path} trazidas do commit ${details.sha})` : undefined
    await run('Aplicando linhas', () => git.cherryPickLines(head, { kind: 'commit', sha }, diff.path, [...selection], { commitMessage: message }))
    setSelection(new Set())
  }

  return (
    <section className="details">
      <div className="commit-header">
        <h3>{details.subject}</h3>
        {details.body && <p className="commit-body pre-line">{details.body}</p>}
        <div className="commit-meta">
          <span>
            {details.author} &lt;{details.email}&gt;
          </span>
          <span>{fullDate(details.date)}</span>
          <code title="Clique para copiar" onClick={() => navigator.clipboard.writeText(details.sha)}>
            {shortSha(details.sha)}
          </code>
          {details.parents.length > 1 && <span className="tag">merge</span>}
        </div>
        {head && (
          <div className="button-row">
            <button className="primary" onClick={() => actions.cherryPickCommits(head, [sha], `o commit "${details.subject}"`)}>
              🍒 Cherry-pick em {head}
            </button>
            {checked.size > 0 && (
              <button onClick={() => actions.filesOntoBranch(sha, pathsOf(details.files.filter((f) => checked.has(f.path))), head)}>
                Levar {plural(checked.size, 'arquivo marcado', 'arquivos marcados')} para {head}…
              </button>
            )}
          </div>
        )}
      </div>

      <ul className="file-list">
        {details.files.map((file) => (
          <li
            key={file.path}
            className={`file-item ${active?.path === file.path ? 'active' : ''}`}
            onClick={() => setActive(file)}
            draggable
            onDragStart={(e) => {
              const files = dragFiles(file)
              startDrag(e, { type: 'commit-files', sha, paths: pathsOf(files) }, files.length > 1 ? `📄 ${files.length} arquivos` : `📄 ${file.path}`)
            }}
            onDragEnd={endDrag}
            title="Arraste para uma branch para levar este arquivo"
          >
            <input
              type="checkbox"
              checked={checked.has(file.path)}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const next = new Set(checked)
                if (e.target.checked) next.add(file.path)
                else next.delete(file.path)
                setChecked(next)
              }}
            />
            <span className={`status status-${file.status}`} title={statusLabel(file.status)}>
              {file.status}
            </span>
            <span className="file-path">{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</span>
          </li>
        ))}
      </ul>

      {diff && (
        <div className="diff-panel">
          {head && (
            <div className="selection-bar">
              <span className="muted">Selecione linhas e aplique só elas em outra branch.</span>
              <button className="primary" disabled={!selection.size} onClick={applyLines}>
                Aplicar {selection.size ? plural(selection.size, 'linha', 'linhas') : 'linhas'} em {head}
              </button>
              <button onClick={() => actions.filesOntoBranch(sha, pathsOf([active!]), head)}>Levar arquivo inteiro…</button>
              <button onClick={() => openFileView(diff.path)}>Blame / histórico</button>
            </div>
          )}
          <DiffView file={diff} selection={head ? selection : undefined} onSelectionChange={setSelection} />
        </div>
      )}
    </section>
  )
}
