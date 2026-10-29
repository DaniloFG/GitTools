import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { GitCommandEntry } from '../../../shared/types'
import { useApp } from '../context'
import { getCurrentLocale, t } from '../i18n'
import { useLayout } from '../layout'
import { Loader } from './Loader'

const LIMIT = 500

/** Comandos que só leem o repositório (a interface os executa o tempo todo para se atualizar). */
const READ_ONLY = new Set([
  'status',
  'log',
  'show',
  'diff',
  'for-each-ref',
  'rev-parse',
  'rev-list',
  'ls-files',
  'blame',
  'merge-base',
  'cat-file',
  'hash-object',
  'show-ref',
  'remote',
  '--version'
])

export function isReadOnly(entry: Pick<GitCommandEntry, 'args'>): boolean {
  const [command, sub] = entry.args
  if (command === 'stash') return sub === 'list'
  if (command === 'config') return entry.args.includes('--get')
  return READ_ONLY.has(command)
}

/** Monta a linha de comando para exibir/copiar (argumentos com espaço entre aspas). */
export function commandLine(args: string[]): string {
  return ['git', ...args.map((a) => (/[\s"'$`\\]/.test(a) || a === '' ? `"${a.replace(/(["\\$`])/g, '\\$1')}"` : a))].join(' ')
}

/** Log em tempo real dos comandos git executados pelo GitTools. */
export function GitLogView() {
  const { showMenu, toast } = useApp()
  const [entries, setEntries] = useState<GitCommandEntry[]>([])
  const [onlyChanges, setOnlyChanges] = useLayout<boolean>('gitlog.onlyChanges', (v) => v === true)
  const [query, setQuery] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)
  /** Continua rolando para o fim enquanto o usuário não subir a lista. */
  const stick = useRef(true)

  useEffect(() => {
    let cancelled = false
    const pending: GitCommandEntry[] = []
    let frame = 0
    // Junta os avisos que chegam no mesmo quadro (uma atualização dispara vários comandos).
    const flush = () => {
      frame = 0
      const batch = pending.splice(0)
      setEntries((prev) => {
        const next = [...prev]
        for (const entry of batch) {
          const i = next.findIndex((e) => e.id === entry.id)
          if (i >= 0) next[i] = entry
          else next.push(entry)
        }
        return next.length > LIMIT ? next.slice(next.length - LIMIT) : next
      })
    }
    const stop = window.gittools.onGitCommand((entry) => {
      pending.push(entry)
      if (!frame) frame = requestAnimationFrame(flush)
    })
    window.gittools.gitLog().then((initial) => !cancelled && setEntries((prev) => (prev.length ? prev : initial.slice(-LIMIT))), () => undefined)
    return () => {
      cancelled = true
      stop()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => (!onlyChanges || !isReadOnly(e)) && (!q || commandLine(e.args).toLowerCase().includes(q)))
  }, [entries, onlyChanges, query])

  useLayoutEffect(() => {
    const el = bodyRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [visible])

  const running = entries.filter((e) => e.exitCode === undefined).length
  const failed = entries.filter((e) => e.failed).length
  const locale = getCurrentLocale()
  const time = (ms: number) =>
    new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) +
    `.${String(ms % 1000).padStart(3, '0')}`

  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast('info', t('gitlog.copied')))

  return (
    <div className="gitlog">
      <div className="gitlog-toolbar">
        <strong>{t('gitlog.title')}</strong>
        <span className="muted small">
          {t('gitlog.summary', { count: visible.length })}
          {running > 0 && ` · ${t('gitlog.running', { count: running })}`}
          {failed > 0 && <span className="warning-text"> · {t('gitlog.failed', { count: failed })}</span>}
        </span>
        <span className="toolbar-spacer" />
        <label className="checkbox small" title={t('gitlog.onlyChangesHelp')}>
          <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked || undefined)} />
          {t('gitlog.onlyChanges')}
        </label>
        <input className="gitlog-filter" type="search" value={query} placeholder={t('gitlog.filter')} onChange={(e) => setQuery(e.target.value)} />
        <button onClick={() => setEntries([])} title={t('gitlog.clearHelp')}>
          {t('gitlog.clear')}
        </button>
      </div>
      <div
        ref={bodyRef}
        className="gitlog-body"
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
      >
        {visible.length === 0 ? (
          <p className="empty small">{t('gitlog.empty')}</p>
        ) : (
          visible.map((entry) => {
            const line = commandLine(entry.args)
            const state = entry.exitCode === undefined ? 'running' : entry.failed ? 'error' : 'ok'
            return (
              <div
                key={entry.id}
                className={`gitlog-row gitlog-${state} ${isReadOnly(entry) ? 'read' : 'write'}`}
                title={`${line}\n${entry.cwd}`}
                onDoubleClick={() => copy(line)}
                onContextMenu={(e) =>
                  showMenu(e, [
                    { label: t('gitlog.copy'), onClick: () => copy(line) },
                    ...(entry.error ? [{ label: t('gitlog.copyError'), onClick: () => copy(entry.error!) }] : [])
                  ])
                }
              >
                <span className="gitlog-time">{time(entry.startedAt)}</span>
                <span className="gitlog-state">
                  {state === 'running' ? <Loader size="sm" /> : state === 'ok' ? (entry.exitCode ? `✓ ${entry.exitCode}` : '✓') : `✕ ${entry.exitCode}`}
                </span>
                <code className="gitlog-command" dir="ltr">
                  {line}
                </code>
                <span className="gitlog-duration" dir="ltr">{entry.durationMs !== undefined ? `${entry.durationMs} ms` : ''}</span>
                {entry.error && (
                  <span className="gitlog-error" dir="ltr">
                    {entry.error}
                  </span>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
