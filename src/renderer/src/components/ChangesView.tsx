import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { FileDiff, FileStatus, LineKey } from '../../../shared/types'
import { buildEntries, sumStats, type ChangeEntry } from '../changeEntries'
import { parseChangesMode, type ChangesMode, type SectionId } from '../changesMode'
import { useApp } from '../context'
import { currentDrag, endDrag, startDrag } from '../dnd'
import { stepIndex } from '../diffNav'
import { errorMessage, statusLabel } from '../format'
import { git } from '../git'
import { t } from '../i18n'
import { useLayout } from '../layout'
import { useDrop } from '../useDrop'
import { revealScreen, revealView } from '../dockStore'
import { viewAvailable, type ViewId } from '../dock'
import { PaneSlot } from '../slots'
import { CommitBox } from './CommitBox'
import { DiffView, useFullFile } from './DiffView'
import { FileEntries, FileViewToggle } from './FileList'
import { LineStats } from './LineStats'

type Area = 'unstaged' | 'staged'
type Active = { area: Area; path: string }

/** Um painel da tela Alterações: cabeçalho (título, número e botões) e conteúdo. */
interface SectionDef {
  title: ReactNode
  badge?: number
  /** Botões do cabeçalho (ex.: "Stage tudo"). */
  actions?: ReactNode
  body: ReactNode
}

/** Cada painel de Alterações é uma tela independente na janela. */
const VIEW_OF: Record<SectionId, ViewId> = {
  conflicts: 'changes.conflicts',
  unstaged: 'changes.unstaged',
  staged: 'changes.staged',
  files: 'changes.files',
  commit: 'changes.commit',
  diff: 'changes.diff'
}

function SectionPanel({ id, def }: { id: SectionId; def: SectionDef }) {
  return (
    <section className={`csection csection-${id}`}>
      <header className="csection-header">
        <span className="csection-toggle">
          <span className="csection-title">{def.title}</span>
          {def.badge !== undefined && <span className="csection-count">{def.badge}</span>}
        </span>
        <span className="csection-actions">{def.actions}</span>
      </header>
      <div className="csection-body">{def.body}</div>
    </section>
  )
}

type Entry = ChangeEntry

/** Letra de status de um arquivo na visão de caixas: a da parte fora do stage, ou a do stage. */
const entryCode = (e: Entry) => (e.unstaged ? (e.unstaged.untracked ? '?' : e.unstaged.worktree) : e.staged!.index)

export function ChangesView() {
  const { data, run, refresh, confirm, toast, openConflict, openFileView, openInEditor, openDiffWindow } = useApp()
  const { status } = data
  const [mode, setMode] = useLayout<ChangesMode>('pref.changesMode', parseChangesMode)
  const [active, setActive] = useState<Active | null>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [selection, setSelection] = useState<Set<LineKey>>(new Set())
  const [fullFile] = useFullFile()
  /** Caixas marcadas agora e ainda não confirmadas pelo git (a tela responde na hora). */
  const [pending, setPending] = useState<Record<string, boolean>>({})

  const entries = buildEntries(status)

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

  /** Marca (stage) ou desmarca (unstage) arquivos na visão de caixas, sem a tela de "ocupado" a cada clique. */
  const include = async (list: Entry[], value: boolean) => {
    const paths = list.map((e) => e.path)
    setPending((prev) => ({ ...prev, ...Object.fromEntries(paths.map((p) => [p, value])) }))
    try {
      await (value ? git.stageFiles(paths) : git.unstageFiles(paths))
    } catch (error) {
      toast('error', errorMessage(error))
    }
    await refresh()
    setPending((prev) => {
      const next = { ...prev }
      for (const p of paths) delete next[p]
      return next
    })
  }

  /** Arquivos na ordem da tela, para ir de um diff ao seguinte. */
  const ordered: Active[] =
    mode === 'check'
      ? entries.map((e) => ({ area: e.unstaged ? 'unstaged' : 'staged', path: e.path }))
      : [...status.unstaged.map((f) => ({ area: 'unstaged' as Area, path: f.path })), ...status.staged.map((f) => ({ area: 'staged' as Area, path: f.path }))]
  const position = active ? ordered.findIndex((f) => f.area === active.area && f.path === active.path) : -1
  const fileNav = {
    index: Math.max(0, position),
    count: ordered.length,
    go: (delta: 1 | -1) => {
      const next = ordered[stepIndex(position, delta, ordered.length)]
      if (next) setActive(next)
    }
  }

  /** Abre o diff do arquivo e traz o painel do diff à frente se ele estava escondido. */
  const activate = (next: Active) => {
    setActive(next)
    revealView('changes.diff')
  }

  /** Troca entre as duas visões; os painéis da nova visão aparecem no lugar dos da anterior. */
  const chooseMode = (next: ChangesMode) => {
    setMode(next === 'stage' ? undefined : next)
    revealScreen('changes', (view) => viewAvailable(view, { changesMode: next, conflicts: status.conflicted.length }))
  }
  const modes: { id: ChangesMode; label: string; help: string }[] = [
    { id: 'stage', label: t('changes.mode.stage'), help: t('changes.mode.stageHelp') },
    { id: 'check', label: t('changes.mode.check'), help: t('changes.mode.checkHelp') }
  ]
  /** Escolha da visão e da forma de listar os arquivos, no cabeçalho das listas. */
  const listTools = (
    <>
      <div className="segmented changes-mode" role="group" aria-label={t('changes.mode.label')} dir="ltr">
        {modes.map((m) => (
          <button key={m.id} className={mode === m.id ? 'active' : ''} aria-pressed={mode === m.id} title={m.help} onClick={() => chooseMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <FileViewToggle compact />
    </>
  )

  const stageList = (area: Area): SectionDef => {
    const files = status[area]
    const staged = area === 'staged'
    return {
      title: t(staged ? 'changes.sections.staged' : 'changes.sections.unstaged'),
      badge: files.length,
      actions: staged ? (
        <>
          {files.length > 0 && (
            <button className="ghost" onClick={() => run(t('busy.unstage'), () => git.unstageFiles(files.map((f) => f.path)))}>
              {t('changes.unstageAll')} ↑
            </button>
          )}
          <FileViewToggle compact />
        </>
      ) : (
        <>
          {files.length > 0 && (
            <>
              <button className="ghost" onClick={() => run(t('busy.stage'), () => git.stageFiles(files.map((f) => f.path)))}>
                {t('changes.stageAll')} ↓
              </button>
              <button className="ghost danger-text" onClick={() => discard(files.map((f) => f.path))}>
                {t('changes.discardAll')}
              </button>
            </>
          )}
          {listTools}
        </>
      ),
      body: (
        <DropBody
          area={area}
          onDropFiles={(paths) => (staged ? run(t('busy.stage'), () => git.stageFiles(paths)) : run(t('busy.unstage'), () => git.unstageFiles(paths)))}
          trash={!staged ? discard : undefined}
        >
          <FileRows
            area={area}
            files={files}
            active={active}
            onActivate={(f) => activate({ area, path: f.path })}
            fileActions={(f) =>
              staged ? (
                <button title={t('changes.unstage')} onClick={() => run(t('busy.unstage'), () => git.unstageFiles([f.path]))}>
                  －
                </button>
              ) : (
                <>
                  <button title={t('common.discard')} onClick={() => discard([f.path])}>
                    ↺
                  </button>
                  <button title={t('changes.stage')} onClick={() => run(t('busy.stage'), () => git.stageFiles([f.path]))}>
                    ＋
                  </button>
                </>
              )
            }
          />
        </DropBody>
      )
    }
  }

  const isIncluded = (e: Entry) => pending[e.path] ?? (!!e.staged && !e.unstaged)
  const isPartial = (e: Entry) => pending[e.path] === undefined && !!e.staged && !!e.unstaged
  const includedCount = entries.filter(isIncluded).length
  const allIncluded = entries.length > 0 && includedCount === entries.length

  const sections: Partial<Record<SectionId, SectionDef>> = {}
  if (status.conflicted.length > 0) {
    sections.conflicts = {
      title: t('changes.sections.conflicts'),
      badge: status.conflicted.length,
      body: (
        <>
          <p className="section-hint">{t('changes.conflictedHint')}</p>
          <FileRows area="unstaged" files={status.conflicted} active={active} onActivate={(f) => openConflict(f.path)} />
        </>
      )
    }
  }
  if (mode === 'stage') {
    sections.unstaged = stageList('unstaged')
    sections.staged = stageList('staged')
  } else {
    sections.files = {
      title: t('changes.sections.files'),
      badge: entries.length,
      actions: (
        <>
          {entries.length > 0 && (
            <>
              <span className="section-note">{t('changes.check.marked', { marked: includedCount, total: entries.length })}</span>
              <label className="check-all" title={t('changes.check.all')}>
                <TriCheckbox checked={allIncluded} indeterminate={!allIncluded && (includedCount > 0 || entries.some(isPartial))} onChange={(value) => void include(entries.filter((e) => isIncluded(e) !== value || isPartial(e)), value)} label={t('changes.check.all')} />
              </label>
            </>
          )}
          {listTools}
        </>
      ),
      body:
        entries.length === 0 ? (
          <p className="section-empty">{t('changes.empty')}</p>
        ) : (
          <ul className="file-list">
            <FileEntries
              items={entries}
              pathOf={(e) => e.path}
              oldPathOf={(e) => e.origPath}
              statusOf={entryCode}
              render={(e, { label, style }) => {
                const first = e.unstaged ?? e.staged!
                const code = entryCode(e)
                const isActive = active?.path === e.path
                return (
                  <li
                    key={e.path}
                    style={style}
                    className={`file-item ${isActive ? 'active' : ''}`}
                    onClick={() => activate({ area: e.unstaged ? 'unstaged' : 'staged', path: e.path })}
                    title={first.path}
                  >
                    <span className="file-check" onClick={(ev) => ev.stopPropagation()}>
                      <TriCheckbox checked={isIncluded(e)} indeterminate={isPartial(e)} onChange={(value) => void include([e], value)} label={t('changes.check.include')} />
                    </span>
                    <span className={`status status-${code}`} title={statusLabel(code)}>
                      {code === '?' ? 'N' : code}
                    </span>
                    {label}
                    <LineStats stats={sumStats(e.staged, e.unstaged)} />
                    <span className="file-actions" onClick={(ev) => ev.stopPropagation()}>
                      {e.unstaged && (
                        <button title={t('common.discard')} onClick={() => discard([e.path])}>
                          ↺
                        </button>
                      )}
                    </span>
                  </li>
                )
              }}
            />
          </ul>
        )
    }
  }
  sections.commit = { title: t('changes.sections.commit'), body: <CommitBox /> }
  const bothSides = !!active && status.unstaged.some((f) => f.path === active.path) && status.staged.some((f) => f.path === active.path)
  sections.diff = {
    title: active ? <code className="diff-title">{active.path}</code> : t('changes.sections.diff'),
    body:
      !active || !diff ? (
        <p className="section-empty">{t('changes.selectFile')}</p>
      ) : (
        <div className="diff-panel">
          <div className="selection-bar">
            <button
              onClick={() => openDiffWindow({ source: { kind: active.area }, path: active.path, title: `${active.path} · ${t(active.area === 'staged' ? 'changes.staged' : 'changes.unstaged')}` })}
              title={t('diffExtra.openWindowHelp')}
            >
              ⧉
            </button>
            {bothSides && (
              <div className="segmented" role="group" dir="ltr">
                {(['unstaged', 'staged'] as const).map((area) => (
                  <button key={area} className={active.area === area ? 'active' : ''} aria-pressed={active.area === area} onClick={() => setActive({ area, path: active.path })}>
                    {t(area === 'staged' ? 'changes.sections.staged' : 'changes.sections.unstaged')}
                  </button>
                ))}
              </div>
            )}
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
      )
  }

  return (
    <>
      {(Object.keys(sections) as SectionId[]).map((id) => (
        <PaneSlot key={id} id={VIEW_OF[id]}>
          <SectionPanel id={id} def={sections[id]!} />
        </PaneSlot>
      ))}
    </>
  )
}

/** Caixa de seleção que também mostra o estado "parcial" (parte das alterações do arquivo já está no commit). */
function TriCheckbox({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate: boolean; onChange(value: boolean): void; label: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate, checked])
  return <input ref={ref} type="checkbox" checked={checked} aria-label={label} title={label} onChange={(e) => onChange(e.target.checked)} />
}

/** Alguém está arrastando arquivos desta lista? (Para mostrar a lixeira só enquanto ela serve.) */
function useFileDragging(area: Area) {
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    const start = () => {
      const drag = currentDrag()
      setDragging(drag?.type === 'files' && drag.area === area)
    }
    const end = () => setDragging(false)
    document.addEventListener('dragstart', start)
    document.addEventListener('dragend', end)
    document.addEventListener('drop', end)
    return () => {
      document.removeEventListener('dragstart', start)
      document.removeEventListener('dragend', end)
      document.removeEventListener('drop', end)
    }
  }, [area])
  return dragging
}

/** Corpo de uma lista: aceita arquivos vindos da outra lista; a lixeira aparece só durante o arrasto. */
function DropBody({ area, onDropFiles, trash, children }: { area: Area; onDropFiles(paths: string[]): void; trash?(paths: string[]): void; children: React.ReactNode }) {
  const drop = useDrop(
    (p) => p.type === 'files' && p.area !== area,
    (p) => p.type === 'files' && onDropFiles(p.paths)
  )
  const dragging = useFileDragging(area)
  return (
    <div className={`drop-body ${drop.over ? 'drop-over' : ''}`} {...drop.props}>
      {children}
      {trash && dragging && <TrashZone onDropFiles={trash} />}
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

interface RowsProps {
  area: Area
  files: FileStatus[]
  active: Active | null
  onActivate(file: FileStatus): void
  fileActions?(file: FileStatus): React.ReactNode
}

/** Linhas de arquivos de uma lista (Ctrl+clique escolhe vários para arrastar juntos). */
function FileRows({ area, files, active, onActivate, fileActions }: RowsProps) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const codeOf = (f: FileStatus) => (area === 'staged' ? f.index : f.untracked ? '?' : f.conflicted ? 'U' : f.worktree)
  if (files.length === 0) return <p className="section-empty">{t('changes.empty')}</p>
  return (
    <ul className="file-list">
      <FileEntries
        items={files}
        pathOf={(f) => f.path}
        oldPathOf={(f) => f.origPath}
        statusOf={codeOf}
        render={(f, { label, style }) => {
          const code = codeOf(f)
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
  )
}
