import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { MessageKey } from '../../../shared/i18n'
import type { TerminalCommandResult } from '../../../shared/terminal'
import { parseCommandLine } from '../../../shared/terminal'
import { useApp } from '../context'
import { getCurrentLocale, t } from '../i18n'
import { GIT_COMMANDS, LOCAL_COMMANDS, findCommand, pickText, type GitCommandSpec } from '../terminal/gitCommands'
import { applySuggestion, suggest, type RepoContext, type Suggestion, type SuggestionKind } from '../terminal/suggest'
import { Loader } from './Loader'

const HISTORY_LIMIT = 200
const OUTPUT_LIMIT = 300

const KIND_LABEL: Record<SuggestionKind, MessageKey> = {
  command: 'gitTerminal.kind.command',
  local: 'gitTerminal.kind.local',
  flag: 'gitTerminal.kind.flag',
  op: 'gitTerminal.kind.op',
  branch: 'gitTerminal.kind.branch',
  tag: 'gitTerminal.kind.tag',
  remote: 'gitTerminal.kind.remote',
  path: 'gitTerminal.kind.path'
}

/** Uma linha do terminal: o comando digitado e o que ele mostrou (resultado, ajuda ou erro). */
interface Entry {
  id: number
  prompt: string
  command: string
  running?: boolean
  result?: TerminalCommandResult
  help?: { spec: GitCommandSpec } | { list: true } | { unknown: string }
}

/** Histórico por repositório, guardado no navegador (vale para as próximas sessões). */
function historyKey(root: string): string {
  return `gittools.terminal.history:${root}`
}

function loadHistory(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(-HISTORY_LIMIT) : []
  } catch {
    return []
  }
}

function saveHistory(key: string, list: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list.slice(-HISTORY_LIMIT)))
  } catch {
    // Sem armazenamento (janela privada, dados bloqueados): o histórico vale só enquanto a janela estiver aberta.
  }
}

/** Ajuda de um subcomando: sintaxe, exemplos e opções. */
function HelpBlock({ spec, locale }: { spec: GitCommandSpec; locale: string }) {
  return (
    <div className="gt-help">
      <div className="gt-help-title">
        <code dir="ltr">git {spec.name}</code> — {pickText(spec.text, locale)}
      </div>
      <div>
        <span className="muted">{t('gitTerminal.syntax')}: </span>
        <code dir="ltr">{spec.syntax}</code>
      </div>
      <div className="muted">{t('gitTerminal.examples')}</div>
      <ul className="gt-examples">
        {spec.examples.map((example) => (
          <li key={example}>
            <code dir="ltr">{example}</code>
          </li>
        ))}
      </ul>
      {spec.flags.length > 0 && (
        <>
          <div className="muted">{t('gitTerminal.options')}</div>
          <dl className="gt-flags">
            {spec.flags.map((flag) => (
              <div key={flag.name}>
                <dt>
                  <code dir="ltr">{flag.name}</code>
                </dt>
                <dd>{pickText(flag.text, locale)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  )
}

/** Terminal integrado ao log: roda comandos git no repositório aberto, com sugestões e histórico. */
export function GitTerminal() {
  const { repo, data, refresh } = useApp()
  const locale = getCurrentLocale()
  const key = historyKey(repo.root)
  const [entries, setEntries] = useState<Entry[]>([])
  const [line, setLine] = useState('')
  const [caret, setCaret] = useState(0)
  const [history, setHistory] = useState<string[]>(() => loadHistory(key))
  const [histPos, setHistPos] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [sel, setSel] = useState(0)
  /** O usuário escolheu uma sugestão com ↑↓: Enter aceita em vez de executar. */
  const [picked, setPicked] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [running, setRunning] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [remotes, setRemotes] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const pendingCaret = useRef<number | null>(null)
  const nextId = useRef(1)
  /** Continua rolando para o fim enquanto o usuário não subir a saída. */
  const stick = useRef(true)

  // Remotes do repositório, para completar os argumentos de fetch, push, pull e remote.
  useEffect(() => {
    let cancelled = false
    window.gittools.invoke('remotes').then(
      (list) => !cancelled && setRemotes(list.map((r) => r.name)),
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [repo.root, data])

  // Outro repositório: o histórico é o dele.
  useEffect(() => {
    setHistory(loadHistory(key))
    setHistPos(null)
  }, [key])

  const context: RepoContext = useMemo(
    () => ({
      branches: data.branches.map((b) => b.name),
      tags: data.tags.map((tag) => tag.name),
      remotes,
      paths: [...new Set([...data.status.staged, ...data.status.unstaged, ...data.status.conflicted].map((f) => f.path))],
      locale
    }),
    [data, remotes, locale]
  )

  const suggestions = useMemo(() => suggest(line, caret, context), [line, caret, context])
  const items = suggestions.items
  const current = Math.min(sel, Math.max(0, items.length - 1))
  const open = !dismissed && line.trim() !== '' && items.length > 0
  const highlighted: Suggestion | undefined = open ? items[current] : undefined
  /** Ajuda: a do comando destacado na lista, ou a do subcomando já digitado. */
  const helpSpec: GitCommandSpec | undefined =
    highlighted?.kind === 'command' ? findCommand(highlighted.label) : (suggestions.command ?? undefined)

  const branch = data.status.detached ? t('gitTerminal.detached') : (data.status.branch ?? '—')
  const prompt = `${repo.name} (${branch}) $`

  // Mantém a rolagem no fim da saída, enquanto o usuário não subir.
  useLayoutEffect(() => {
    const el = outputRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [entries])

  // Depois de aplicar uma sugestão, o cursor vai para o fim do trecho inserido.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (el && pendingCaret.current !== null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current)
      pendingCaret.current = null
    }
  })

  // A sugestão destacada fica à vista na lista.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [current, open])

  function setText(text: string) {
    setLine(text)
    setCaret(text.length)
    pendingCaret.current = text.length
  }

  function accept(item: Suggestion) {
    const next = applySuggestion(line, caret, suggestions, item)
    setLine(next.line)
    setCaret(next.cursor)
    pendingCaret.current = next.cursor
    setSel(0)
    setPicked(false)
  }

  function browse(direction: -1 | 1) {
    if (history.length === 0) return
    if (direction === -1) {
      if (histPos === null) {
        setDraft(line)
        setHistPos(history.length - 1)
        setText(history[history.length - 1])
      } else if (histPos > 0) {
        setHistPos(histPos - 1)
        setText(history[histPos - 1])
      }
    } else if (histPos !== null) {
      if (histPos < history.length - 1) {
        setHistPos(histPos + 1)
        setText(history[histPos + 1])
      } else {
        setHistPos(null)
        setText(draft)
      }
    }
    setDismissed(true)
  }

  function addEntry(entry: Omit<Entry, 'id' | 'prompt'>): number {
    const id = nextId.current++
    setEntries((prev) => [...prev, { ...entry, id, prompt }].slice(-OUTPUT_LIMIT))
    return id
  }

  async function submit(raw: string) {
    const text = raw.trim()
    if (!text || running) return
    const next = history[history.length - 1] === text ? history : [...history, text].slice(-HISTORY_LIMIT)
    setHistory(next)
    saveHistory(key, next)
    setHistPos(null)
    setLine('')
    setCaret(0)
    setDismissed(false)
    setSel(0)
    setPicked(false)
    stick.current = true

    // Comandos locais: clear e help (também aceitos como "git help").
    const parsed = parseCommandLine(text)
    if (parsed.ok) {
      const words = parsed.tokens[0] === 'git' ? parsed.tokens.slice(1) : parsed.tokens
      if (words.length === 1 && words[0] === 'clear') {
        setEntries([])
        return
      }
      if (words[0] === 'help') {
        const topic = words[1]
        if (!topic) addEntry({ command: text, help: { list: true } })
        else {
          const spec = findCommand(topic)
          addEntry({ command: text, help: spec ? { spec } : { unknown: topic } })
        }
        return
      }
    }

    const id = addEntry({ command: text, running: true })
    setRunning(true)
    let result: TerminalCommandResult
    try {
      result = await window.gittools.runGitCommand(text)
    } catch (error) {
      result = { ok: false, exitCode: -1, stdout: '', stderr: error instanceof Error ? error.message : String(error), args: [], durationMs: 0 }
    }
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, running: false, result } : e)))
    setRunning(false)
    // Comandos que mudam o repositório: a interface se atualiza (as leituras não precisam).
    if (result.args.length > 0 && !findCommand(result.args[0])?.readOnly) void refresh()
  }

  function insertCommand(name: string) {
    setText(`git ${name} `)
    setDismissed(false)
    setListOpen(false)
    inputRef.current?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.ctrlKey && event.key.toLowerCase() === 'l') {
      event.preventDefault()
      setEntries([])
      return
    }
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        setDismissed(true)
      }
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      if (highlighted) accept(highlighted)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (open) {
        const step = event.key === 'ArrowDown' ? 1 : -1
        setSel((current + step + items.length) % items.length)
        setPicked(true)
      } else browse(event.key === 'ArrowUp' ? -1 : 1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (open && picked && highlighted) accept(highlighted)
      else void submit(line)
    }
  }

  const kindLabel = (kind: SuggestionKind) => t(KIND_LABEL[kind])

  return (
    <div className="gt">
      <div className="gt-toolbar">
        <strong>{t('gitTerminal.title')}</strong>
        <span className="toolbar-spacer" />
        <button className={listOpen ? 'active' : ''} aria-pressed={listOpen} title={t('gitTerminal.commandsHelp')} onClick={() => setListOpen((v) => !v)}>
          ? {t('gitTerminal.commands')}
        </button>
        <button onClick={() => setEntries([])} title={t('gitTerminal.clearHelp')}>
          {t('gitTerminal.clear')}
        </button>
      </div>

      {listOpen && (
        <div className="gt-list">
          {GIT_COMMANDS.map((c) => (
            <button key={c.name} className="gt-list-item" title={pickText(c.text, locale)} onClick={() => insertCommand(c.name)}>
              <code dir="ltr">git {c.name}</code>
              <span className="muted">{pickText(c.text, locale)}</span>
            </button>
          ))}
          <div className="gt-list-local muted">
            {LOCAL_COMMANDS.map((c) => (
              <span key={c.name}>
                <code dir="ltr">{c.name}</code> — {pickText(c.text, locale)}
              </span>
            ))}
          </div>
        </div>
      )}

      <div ref={outputRef} className="gt-output" onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
      }}>
        {entries.length === 0 && <p className="gt-welcome">{t('gitTerminal.welcome')}</p>}
        {entries.map((entry) => (
          <div key={entry.id} className="gt-entry">
            <div className="gt-command">
              <span className="gt-prompt" dir="ltr">
                {entry.prompt}
              </span>{' '}
              <code dir="ltr">{entry.command}</code>
            </div>
            {entry.running && (
              <div className="gt-status muted">
                <Loader size="sm" /> {t('gitTerminal.running')}
              </div>
            )}
            {entry.result && (
              <>
                {entry.result.stdout && <pre className="gt-stdout" dir="ltr">{entry.result.stdout}</pre>}
                {entry.result.stderr && <pre className={entry.result.ok ? 'gt-stderr-info' : 'gt-stderr'} dir="ltr">{entry.result.stderr}</pre>}
                {!entry.result.stdout && !entry.result.stderr && <div className="gt-status muted">{t('gitTerminal.noOutput')}</div>}
                <div className={`gt-exit ${entry.result.ok ? 'ok' : 'error'}`}>{t('gitTerminal.exitCode', { code: entry.result.exitCode })}</div>
              </>
            )}
            {entry.help && 'spec' in entry.help && <HelpBlock spec={entry.help.spec} locale={locale} />}
            {entry.help && 'list' in entry.help && (
              <div className="gt-status">
                <div className="muted">{t('gitTerminal.listTitle')}</div>
                <div className="gt-names">
                  {GIT_COMMANDS.map((c) => (
                    <code key={c.name} dir="ltr">
                      {c.name}
                    </code>
                  ))}
                </div>
              </div>
            )}
            {entry.help && 'unknown' in entry.help && <div className="gt-status muted">{t('gitTerminal.unknownHelp', { command: entry.help.unknown })}</div>}
          </div>
        ))}
      </div>

      <div className="gt-input-area">
        {open && (
          <div className="gt-suggest-wrap">
            <ul ref={listRef} className="gt-suggest" role="listbox" aria-label={t('gitTerminal.suggestions')}>
              {items.map((item, i) => (
                <li
                  key={`${item.kind}-${item.label}`}
                  role="option"
                  aria-selected={i === current}
                  className={i === current ? 'active' : ''}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    accept(item)
                  }}
                  onMouseEnter={() => setSel(i)}
                >
                  <code dir="ltr">{item.label}</code>
                  <span className="gt-kind">{kindLabel(item.kind)}</span>
                  {item.detail && <span className="gt-detail">{item.detail}</span>}
                </li>
              ))}
            </ul>
            {helpSpec && <HelpBlock spec={helpSpec} locale={locale} />}
            <div className="gt-hint muted">{t('gitTerminal.keys')}</div>
          </div>
        )}
        <div className="gt-input-row">
          <span className="gt-prompt" dir="ltr">
            {prompt}
          </span>
          <input
            ref={inputRef}
            className="gt-input"
            dir="ltr"
            type="text"
            value={line}
            placeholder={t('gitTerminal.placeholder')}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            autoFocus
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            onChange={(e) => {
              setLine(e.target.value)
              setCaret(e.target.selectionStart ?? e.target.value.length)
              setDismissed(false)
              setSel(0)
              setPicked(false)
              setHistPos(null)
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
            onKeyDown={onKeyDown}
          />
          <button className="gt-run" disabled={running || line.trim() === ''} onClick={() => void submit(line)}>
            {running && <Loader size="sm" />} {t('gitTerminal.run')}
          </button>
        </div>
      </div>
    </div>
  )
}
