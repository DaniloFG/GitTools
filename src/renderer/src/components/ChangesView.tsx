import { useEffect, useState } from 'react'
import type { FileDiff, FileStatus, LineKey } from '../../../shared/types'
import { useApp } from '../context'
import { endDrag, startDrag } from '../dnd'
import { errorMessage, statusLabel } from '../format'
import { git } from '../git'
import { useLayout } from '../layout'
import { useDrop } from '../useDrop'
import { t } from '../i18n'
import { DiffView, useFullFile } from './DiffView'
import { revealPane, Split } from './Split'
import { stepIndex } from '../diffNav'
import { FileEntries, FileViewToggle } from './FileList'
import { LineStats } from './LineStats'

type Area = 'unstaged' | 'staged'

export function ChangesView() {
  const { data, run, confirm, toast, openConflict, openFileView, openInEditor, openDiffWindow } = useApp()
  const { status } = data
  const [active, setActive] = useState<{ area: Area; path: string } | null>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [selection, setSelection] = useState<Set<LineKey>>(new Set())
  const [fullFile] = useFullFile()

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
    git.diff({ kind: active.area, path: active.path, fullFile }).then(
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
  }, [active, status, toast, fullFile])

  useEffect(() => setSelection(new Set()), [diff])

  const discard = async (paths: string[]) => {
    const ok = await confirm({
      title: t('changes.discardTitle'),
      message: `${t('changes.discardMessage', { count: paths.length })}\n${paths.join('\n')}`,
      confirmLabel: t('common.discard'),
      danger: true
    })
    if (ok) await run('Descartando', () => git.discardFiles(paths))
  }

  const lineAction = async (action: 'stage' | 'unstage' | 'discard') => {
    if (!active || !diff) return
    if (action === 'discard') {
      const ok = await confirm({
        title: t('changes.discardLinesTitle'),
        message: t('changes.discardLinesMessage', { count: selection.size, path: diff.path }),
        confirmLabel: t('common.discard'),
        danger: true
      })
      if (!ok) return
    }
    await run(t('busy.applyingSelection'), () => git.applyLines({ kind: active.area, fullFile }, active.path, [...selection], action))
  }

  /** Arquivos na ordem da tela (não staged, depois staged), para ir de um diff ao seguinte. */
  const ordered = [
    ...status.unstaged.map((f) => ({ area: 'unstaged' as Area, path: f.path })),
    ...status.staged.map((f) => ({ area: 'staged' as Area, path: f.path }))
  ]
  const position = active ? ordered.findIndex((f) => f.area === active.area && f.path === active.path) : -1
  const fileNav = {
    index: Math.max(0, position),
    count: ordered.length,
    go: (delta: 1 | -1) => {
      const next = ordered[stepIndex(position, delta, ordered.length)]
      if (next) setActive(next)
    }
  }

  return (
    <Split id="changes" initial={0.45} min={[240, 280]}>
      <div className="changes">
        {status.conflicted.length > 0 && (
          <FileGroup
            id="conflicted"
            title={t('changes.conflicted')}
            area="unstaged"
            files={status.conflicted}
            active={active}
            onActivate={(f) => openConflict(f.path)}
            hint={t('changes.conflictedHint')}
          />
        )}
        <FileGroup
          id="unstaged"
          toggle
          title={t('changes.unstaged')}
          area="unstaged"
          files={status.unstaged}
          active={active}
          onActivate={(f) => {
            setActive({ area: 'unstaged', path: f.path })
            revealPane('changes', 'second')
          }}
          onDropFiles={(paths) => run(t('busy.unstage'), () => git.unstageFiles(paths))}
          actions={
            status.unstaged.length > 0 && (
              <>
                <button onClick={() => run(t('busy.stage'), () => git.stageFiles(status.unstaged.map((f) => f.path)))}>{t('changes.stageAll')} ↓</button>
                <button className="danger subtle" onClick={() => discard(status.unstaged.map((f) => f.path))}>
                  {t('changes.discardAll')}
                </button>
              </>
            )
          }
          fileActions={(f) => (
            <>
              <button title={t('common.discard')} onClick={() => discard([f.path])}>
                ↺
              </button>
              <button title={t('changes.stage')} onClick={() => run(t('busy.stage'), () => git.stageFiles([f.path]))}>
                ＋
              </button>
            </>
          )}
        />
        <FileGroup
          id="staged"
          title={t('changes.staged')}
          area="staged"
          files={status.staged}
          active={active}
          onActivate={(f) => {
            setActive({ area: 'staged', path: f.path })
            revealPane('changes', 'second')
          }}
          onDropFiles={(paths) => run(t('busy.stage'), () => git.stageFiles(paths))}
          actions={
            status.staged.length > 0 && (
              <button onClick={() => run(t('busy.unstage'), () => git.unstageFiles(status.staged.map((f) => f.path)))}>{t('changes.unstageAll')} ↑</button>
            )
          }
          fileActions={(f) => (
            <button title={t('changes.unstage')} onClick={() => run(t('busy.unstage'), () => git.unstageFiles([f.path]))}>
              －
            </button>
          )}
        />
        <TrashZone onDropFiles={discard} />
        <CommitBox />
      </div>

      <section className="details">
        {!active || !diff ? (
          <p className="empty">{t('changes.selectFile')}</p>
        ) : (
          <div className="diff-panel">
            <div className="selection-bar">
              <button
                onClick={() => openDiffWindow({ source: { kind: active.area }, path: active.path, title: `${active.path} · ${t(active.area === 'staged' ? 'changes.staged' : 'changes.unstaged')}` })}
                title={t('diffExtra.openWindowHelp')}
              >
                ⧉
              </button>
              {active.area === 'unstaged' ? (
                <>
                  <button className="primary" disabled={!selection.size} onClick={() => lineAction('stage')}>
                    {t('changes.stageLines', { count: selection.size })}
                  </button>
                  <button className="danger subtle" disabled={!selection.size} onClick={() => lineAction('discard')}>
                    {t('changes.discardLines')}
                  </button>
                  <button onClick={() => run(t('busy.stage'), () => git.stageFiles([active.path]))}>{t('changes.stageFile')}</button>
                  <button onClick={() => openInEditor(active.path)}>{t('common.openInEditor')}</button>
                  <button onClick={() => openFileView(active.path)}>{t('common.blameHistory')}</button>
                </>
              ) : (
                <>
                  <button className="primary" disabled={!selection.size} onClick={() => lineAction('unstage')}>
                    {t('changes.unstageLines', { count: selection.size })}
                  </button>
                  <button onClick={() => run(t('busy.unstage'), () => git.unstageFiles([active.path]))}>{t('changes.unstageFile')}</button>
                </>
              )}
            </div>
            <DiffView file={diff} selection={selection} onSelectionChange={setSelection} fileNav={fileNav} />
          </div>
        )}
      </section>
    </Split>
  )
}

interface GroupProps {
  /** Nome sob o qual fica guardado se o grupo está recolhido. */
  id: string
  title: string
  area: Area
  files: FileStatus[]
  active: { area: Area; path: string } | null
  onActivate(file: FileStatus): void
  onDropFiles?(paths: string[]): void
  actions?: React.ReactNode
  fileActions?(file: FileStatus): React.ReactNode
  hint?: string
  /** Mostra o botão lista/árvore neste cabeçalho (vale para todos os grupos). */
  toggle?: boolean
}

const parseCollapsed = (value: unknown) => value === true

function FileGroup({ id, title, area, files, active, onActivate, onDropFiles, actions, fileActions, hint, toggle }: GroupProps) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useLayout(`changes.${id}.collapsed`, parseCollapsed)
  const drop = useDrop(
    (p) => !!onDropFiles && p.type === 'files' && p.area !== area,
    (p) => p.type === 'files' && onDropFiles?.(p.paths)
  )

  return (
    <div className={`file-group ${drop.over ? 'drop-over' : ''}`} {...drop.props}>
      <div className="group-header">
        <button
          className="group-toggle"
          onClick={() => setCollapsed(collapsed ? undefined : true)}
          title={collapsed ? t('layout.expand') : t('layout.collapse')}
          aria-expanded={!collapsed}
        >
          <span>{collapsed ? '▸' : '▾'}</span> <strong>{title}</strong> <span className="count">{files.length}</span>
        </button>
        <span className="toolbar-spacer" />
        {toggle && <FileViewToggle compact />}
        {actions}
      </div>
      {!collapsed && hint && <p className="muted small">{hint}</p>}
      {collapsed ? null : files.length === 0 ? (
        <p className="empty small">{onDropFiles ? t('changes.emptyDrop') : t('changes.empty')}</p>
      ) : (
        <ul className="file-list">
          <FileEntries
            items={files}
            pathOf={(f) => f.path}
            oldPathOf={(f) => f.origPath}
            render={(f, { label, style }) => {
            const code = area === 'staged' ? f.index : f.untracked ? '?' : f.conflicted ? 'U' : f.worktree
            return (
              <li
                key={f.path}
                style={style}
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
                  startDrag(e, { type: 'files', area, paths }, paths.length > 1 ? `📄 ${t('common.files', { count: paths.length })}` : `📄 ${f.path}`)
                }}
                onDragEnd={endDrag}
              >
                <span className={`status status-${code}`} title={statusLabel(code)}>
                  {code === '?' ? 'N' : code}
                </span>
                {label}
                <LineStats stats={f} />
                <span className="file-actions" onClick={(e) => e.stopPropagation()}>
                  {fileActions?.(f)}
                </span>
              </li>
            )
            }}
          />
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
      🗑 {t('changes.trash')}
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
    const result = await run(amend ? t('busy.amending') : t('busy.commit'), async () => {
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
        placeholder={t('changes.commitPlaceholder')}
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
          {t('changes.amend')}
        </label>
        <button className="primary" disabled={!canCommit} onClick={commit}>
          {amend ? t('changes.amendButton') : data.status.branch ? t('changes.commitInto', { branch: data.status.branch }) : t('changes.commit')}
        </button>
      </div>
    </div>
  )
}
