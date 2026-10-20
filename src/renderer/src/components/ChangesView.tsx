import { useEffect, useState } from 'react'
import type { FileDiff, FileStatus, LineKey } from '../../../shared/types'
import { useApp } from '../context'
import { endDrag, startDrag } from '../dnd'
import { errorMessage, plural, statusLabel } from '../format'
import { git } from '../git'
import { useDrop } from '../useDrop'
import { DiffView } from './DiffView'

type Area = 'unstaged' | 'staged'

export function ChangesView() {
  const { data, run, confirm, toast } = useApp()
  const { status } = data
  const [active, setActive] = useState<{ area: Area; path: string } | null>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [selection, setSelection] = useState<Set<LineKey>>(new Set())

  // Se o arquivo ativo saiu da lista (ex.: foi todo para o stage), acompanha-o na outra lista.
  useEffect(() => {
    if (!active) return
    const inList = (area: Area) => status[area].some((f) => f.path === active.path)
    if (inList(active.area)) return
    const other: Area = active.area === 'unstaged' ? 'staged' : 'unstaged'
    setActive(inList(other) ? { area: other, path: active.path } : null)
  }, [status, active])

  useEffect(() => {
    if (!active) {
      setDiff(null)
      return
    }
    let cancelled = false
    git.diff({ kind: active.area, path: active.path }).then(
      (files) => {
        if (cancelled) return
        const next = files.find((f) => f.path === active.path || f.oldPath === active.path) ?? files[0] ?? null
        // Mantém a mesma referência (e a seleção) se nada mudou desde a última leitura.
        setDiff((prev) => (prev && next && JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
      },
      (e) => !cancelled && toast('error', errorMessage(e))
    )
    return () => {
      cancelled = true
    }
  }, [active, status, toast])

  useEffect(() => setSelection(new Set()), [diff])

  const discard = async (paths: string[]) => {
    const ok = await confirm({
      title: 'Descartar alterações',
      message: `As alterações locais de ${plural(paths.length, 'arquivo', 'arquivos')} serão perdidas:\n${paths.join('\n')}`,
      confirmLabel: 'Descartar',
      danger: true
    })
    if (ok) await run('Descartando', () => git.discardFiles(paths))
  }

  const lineAction = async (action: 'stage' | 'unstage' | 'discard') => {
    if (!active || !diff) return
    if (action === 'discard') {
      const ok = await confirm({
        title: 'Descartar linhas',
        message: `Descartar ${plural(selection.size, 'linha selecionada', 'linhas selecionadas')} de ${diff.path}?`,
        confirmLabel: 'Descartar',
        danger: true
      })
      if (!ok) return
    }
    await run('Aplicando seleção', () => git.applyLines({ kind: active.area }, active.path, [...selection], action))
  }

  return (
    <div className="split">
      <div className="changes">
        {status.conflicted.length > 0 && (
          <FileGroup
            title="Em conflito"
            area="unstaged"
            files={status.conflicted}
            active={active}
            onActivate={(f) => window.gittools.openFile(f.path)}
            hint="Resolva pelo painel no topo. Clique para abrir no editor."
          />
        )}
        <FileGroup
          title="Alterações (não staged)"
          area="unstaged"
          files={status.unstaged}
          active={active}
          onActivate={(f) => setActive({ area: 'unstaged', path: f.path })}
          onDropFiles={(paths) => run('Unstage', () => git.unstageFiles(paths))}
          actions={
            status.unstaged.length > 0 && (
              <>
                <button onClick={() => run('Stage', () => git.stageFiles(status.unstaged.map((f) => f.path)))}>Stage tudo ↓</button>
                <button className="danger subtle" onClick={() => discard(status.unstaged.map((f) => f.path))}>
                  Descartar tudo
                </button>
              </>
            )
          }
          fileActions={(f) => (
            <>
              <button title="Descartar" onClick={() => discard([f.path])}>
                ↺
              </button>
              <button title="Stage" onClick={() => run('Stage', () => git.stageFiles([f.path]))}>
                ＋
              </button>
            </>
          )}
        />
        <FileGroup
          title="Prontas para commit (staged)"
          area="staged"
          files={status.staged}
          active={active}
          onActivate={(f) => setActive({ area: 'staged', path: f.path })}
          onDropFiles={(paths) => run('Stage', () => git.stageFiles(paths))}
          actions={
            status.staged.length > 0 && (
              <button onClick={() => run('Unstage', () => git.unstageFiles(status.staged.map((f) => f.path)))}>Unstage tudo ↑</button>
            )
          }
          fileActions={(f) => (
            <button title="Unstage" onClick={() => run('Unstage', () => git.unstageFiles([f.path]))}>
              －
            </button>
          )}
        />
        <TrashZone onDropFiles={discard} />
        <CommitBox />
      </div>

      <section className="details">
        {!active || !diff ? (
          <p className="empty">Selecione um arquivo para ver as alterações e escolher linhas.</p>
        ) : (
          <div className="diff-panel">
            <div className="selection-bar">
              {active.area === 'unstaged' ? (
                <>
                  <button className="primary" disabled={!selection.size} onClick={() => lineAction('stage')}>
                    Stage {selection.size ? plural(selection.size, 'linha', 'linhas') : 'linhas'}
                  </button>
                  <button className="danger subtle" disabled={!selection.size} onClick={() => lineAction('discard')}>
                    Descartar linhas
                  </button>
                  <button onClick={() => run('Stage', () => git.stageFiles([active.path]))}>Stage arquivo</button>
                  <button onClick={() => window.gittools.openFile(active.path)}>Abrir</button>
                </>
              ) : (
                <>
                  <button className="primary" disabled={!selection.size} onClick={() => lineAction('unstage')}>
                    Unstage {selection.size ? plural(selection.size, 'linha', 'linhas') : 'linhas'}
                  </button>
                  <button onClick={() => run('Unstage', () => git.unstageFiles([active.path]))}>Unstage arquivo</button>
                </>
              )}
            </div>
            <DiffView file={diff} selection={selection} onSelectionChange={setSelection} />
          </div>
        )}
      </section>
    </div>
  )
}

interface GroupProps {
  title: string
  area: Area
  files: FileStatus[]
  active: { area: Area; path: string } | null
  onActivate(file: FileStatus): void
  onDropFiles?(paths: string[]): void
  actions?: React.ReactNode
  fileActions?(file: FileStatus): React.ReactNode
  hint?: string
}

function FileGroup({ title, area, files, active, onActivate, onDropFiles, actions, fileActions, hint }: GroupProps) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const drop = useDrop(
    (p) => !!onDropFiles && p.type === 'files' && p.area !== area,
    (p) => p.type === 'files' && onDropFiles?.(p.paths)
  )

  return (
    <div className={`file-group ${drop.over ? 'drop-over' : ''}`} {...drop.props}>
      <div className="group-header">
        <strong>{title}</strong> <span className="count">{files.length}</span>
        <span className="toolbar-spacer" />
        {actions}
      </div>
      {hint && <p className="muted small">{hint}</p>}
      {files.length === 0 ? (
        <p className="empty small">{onDropFiles ? 'Nada aqui. Arraste arquivos para cá.' : 'Nada aqui.'}</p>
      ) : (
        <ul className="file-list">
          {files.map((f) => {
            const code = area === 'staged' ? f.index : f.untracked ? '?' : f.conflicted ? 'U' : f.worktree
            return (
              <li
                key={f.path}
                className={`file-item ${active?.area === area && active.path === f.path ? 'active' : ''} ${picked.has(f.path) ? 'picked' : ''}`}
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey) {
                    const next = new Set(picked)
                    if (next.has(f.path)) next.delete(f.path)
                    else next.add(f.path)
                    setPicked(next)
                  } else {
                    setPicked(new Set())
                    onActivate(f)
                  }
                }}
                draggable={!f.conflicted}
                onDragStart={(e) => {
                  const paths = picked.has(f.path) ? [...picked] : [f.path]
                  startDrag(e, { type: 'files', area, paths }, paths.length > 1 ? `📄 ${paths.length} arquivos` : `📄 ${f.path}`)
                }}
                onDragEnd={endDrag}
              >
                <span className={`status status-${code}`} title={statusLabel(code)}>
                  {code === '?' ? 'N' : code}
                </span>
                <span className="file-path">{f.origPath ? `${f.origPath} → ${f.path}` : f.path}</span>
                <span className="file-actions" onClick={(e) => e.stopPropagation()}>
                  {fileActions?.(f)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function TrashZone({ onDropFiles }: { onDropFiles(paths: string[]): void }) {
  const drop = useDrop(
    (p) => p.type === 'files' && p.area === 'unstaged',
    (p) => p.type === 'files' && onDropFiles(p.paths)
  )
  return (
    <div className={`trash-zone ${drop.over ? 'drop-over' : ''}`} {...drop.props}>
      🗑 Arraste arquivos não staged aqui para descartar as alterações
    </div>
  )
}

function CommitBox() {
  const { data, run } = useApp()
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const canCommit = !!message.trim() && (data.status.staged.length > 0 || amend) && data.status.conflicted.length === 0

  const commit = async () => {
    if (!canCommit) return
    const result = await run(amend ? 'Corrigindo último commit' : 'Commit', async () => {
      await git.commit(message, amend)
      return true
    })
    if (result) {
      setMessage('')
      setAmend(false)
    }
  }

  return (
    <div className="commit-box">
      <textarea
        placeholder="Mensagem do commit (Ctrl+Enter para confirmar)"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && commit()}
        rows={3}
      />
      <div className="commit-actions">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={amend}
            onChange={async (e) => {
              setAmend(e.target.checked)
              if (e.target.checked && !message.trim() && data.status.headSha) {
                const head = await git.commitDetails('HEAD')
                setMessage(head.body ? `${head.subject}\n\n${head.body}` : head.subject)
              }
            }}
            disabled={!data.status.headSha}
          />
          Corrigir o último commit (amend)
        </label>
        <button className="primary" disabled={!canCommit} onClick={commit}>
          {amend ? 'Corrigir commit' : `Commit${data.status.branch ? ` em ${data.status.branch}` : ''}`}
        </button>
      </div>
    </div>
  )
}
