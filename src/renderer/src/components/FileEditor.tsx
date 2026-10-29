import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { BlameResult, FileContent } from '../../../shared/types'
import { useApp } from '../context'
import { getDraft, setDraft, useDraftsVersion } from '../editorDrafts'
import { fromFile, lineOrigins, toFile, type EditorText } from '../editorText'
import { errorMessage, fullDate, relativeDate, shortSha } from '../format'
import { git } from '../git'
import { t } from '../i18n'
import { CodeEditor } from './CodeEditor'
import { Loader, LoaderPane } from './Loader'

const UNCOMMITTED = /^0+$/

interface Disk {
  file: FileContent
  /** O texto como o editor o mostra; null quando o arquivo não pode ser editado aqui (binário ou grande demais). */
  text: EditorText | null
}

function toDisk(file: FileContent): Disk {
  return { file, text: file.content === null ? null : fromFile(file.content) }
}

/**
 * Edita um arquivo do projeto direto na janela. As alterações ficam guardadas (mesmo trocando de arquivo ou de
 * tela) até serem salvas com Ctrl+S ou descartadas. Com a assistência ligada nas configurações, o balão ao final da
 * linha do cursor diz quem a escreveu, quando e o que o commit fez.
 */
export function FileEditor({ path }: { path: string }) {
  const { repo, data, toast, confirm, refresh, openInEditor, selectCommit, settings } = useApp()
  const [disk, setDisk] = useState<Disk | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** O arquivo mudou no disco enquanto havia alterações não salvas aqui. */
  const [external, setExternal] = useState<Disk | null>(null)
  const [saving, setSaving] = useState(false)
  const [blame, setBlame] = useState<BlameResult | null>(null)
  const [version, setVersion] = useState(0)
  useDraftsVersion()

  const diskRef = useRef<Disk | null>(null)
  diskRef.current = disk
  const draft = getDraft(repo.root, path)
  const baseline = disk?.text?.text ?? null
  const buffer = draft ?? baseline ?? ''
  const dirty = draft !== undefined && baseline !== null && draft !== baseline

  // Abre o arquivo (e o relê quando o repositório muda), sem perder o que o usuário digitou.
  useEffect(() => {
    let cancelled = false
    git.readFile(path).then(
      (file) => {
        if (cancelled) return
        setError(null)
        const next = toDisk(file)
        const current = diskRef.current
        const currentDraft = getDraft(repo.root, path)
        if (!current || current.file.path !== path) {
          setDisk(next)
          setExternal(null)
          setVersion((v) => v + 1)
          // Um rascunho igual ao arquivo não é rascunho.
          if (currentDraft !== undefined && currentDraft === next.text?.text) setDraft(repo.root, path, undefined)
        } else if (next.text?.text !== current.text?.text) {
          if (currentDraft === undefined || currentDraft === current.text?.text) {
            setDraft(repo.root, path, undefined)
            setDisk(next)
            setExternal(null)
            setVersion((v) => v + 1)
          } else if (currentDraft === next.text?.text) {
            // O arquivo no disco ficou igual ao que o usuário digitou.
            setDraft(repo.root, path, undefined)
            setDisk(next)
            setExternal(null)
            setVersion((v) => v + 1)
          } else setExternal(next)
        } else setExternal(null)
      },
      (e) => !cancelled && setError(errorMessage(e))
    )
    return () => {
      cancelled = true
    }
  }, [path, repo.root, data.status])

  // Quem escreveu cada linha do arquivo salvo (só se a assistência está ligada).
  const assist = settings.inlineBlame !== false
  const headSha = data.status.headSha
  useEffect(() => {
    if (!assist || !disk?.text) {
      setBlame(null)
      return
    }
    let cancelled = false
    git.blame(path).then(
      (b) => !cancelled && setBlame(b),
      // Arquivo novo, ainda fora do git: não há de quem mostrar.
      () => !cancelled && setBlame(null)
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, assist, version, headSha])

  const deferred = useDeferredValue(buffer)
  const origins = useMemo(() => (assist && baseline !== null && blame ? lineOrigins(baseline, deferred) : null), [assist, baseline, deferred, blame])

  const lineEnd = useCallback(
    (line: number) => {
      if (!assist || !blame || !origins) return null
      const origin = deferred === buffer ? origins[line - 1] : null
      if (origin === null || origin === undefined) {
        return <BlameBubble tone="editing" author={t('editor.blame.you')} text={t('editor.blame.editing')} title={t('editor.blame.editingHelp')} />
      }
      const entry = blame.lines[origin - 1]
      if (!entry) return null
      if (UNCOMMITTED.test(entry.sha)) {
        return <BlameBubble tone="editing" author={t('editor.blame.you')} text={t('editor.blame.uncommitted')} title={t('editor.blame.uncommittedHelp')} />
      }
      const commit = blame.commits[entry.sha]
      if (!commit) return null
      return (
        <BlameBubble
          tone="commit"
          author={commit.author}
          when={relativeDate(commit.date)}
          text={commit.summary}
          title={`${commit.summary}\n\n${commit.author} <${commit.email}>\n${fullDate(commit.date)}\n${shortSha(commit.sha)}\n\n${t('editor.blame.open')}`}
          onClick={() => selectCommit(commit.sha)}
        />
      )
    },
    [assist, blame, origins, deferred, buffer, selectCommit]
  )

  const save = async () => {
    if (!disk?.text || !dirty || saving) return
    if (external) {
      const ok = await confirm({ title: t('editor.overwriteTitle'), message: t('editor.overwriteMessage', { path }), confirmLabel: t('editor.overwrite'), danger: true })
      if (!ok) return
    }
    setSaving(true)
    try {
      await git.writeFile(path, toFile(buffer, disk.text))
      setDisk({ file: disk.file, text: { ...disk.text, text: buffer } })
      setExternal(null)
      setVersion((v) => v + 1)
      setDraft(repo.root, path, undefined)
      toast('success', t('editor.saved', { path }))
      await refresh()
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const discard = async () => {
    const ok = await confirm({ title: t('editor.discardTitle'), message: t('editor.discardMessage', { path }), confirmLabel: t('editor.discard'), danger: true })
    if (ok) setDraft(repo.root, path, undefined)
  }

  const useDiskVersion = () => {
    if (!external) return
    setDraft(repo.root, path, undefined)
    setDisk(external)
    setExternal(null)
    setVersion((v) => v + 1)
  }

  return (
    <section className="details file-details file-editor">
      <div className="file-header">
        <strong>{t('files.editor')}</strong>
        <code className="diff-path">{path}</code>
        {dirty && (
          <span className="editor-dirty" title={t('editor.unsavedHelp')}>
            ● {t('editor.unsaved')}
          </span>
        )}
        <span className="toolbar-spacer" />
        {dirty && (
          <button onClick={discard} disabled={saving}>
            {t('editor.discard')}
          </button>
        )}
        <button className="primary" disabled={!dirty || saving} onClick={save} title={t('editor.saveHelp')}>
          {saving ? <Loader size="sm" /> : '💾'} {t('editor.save')}
        </button>
        <button onClick={() => openInEditor(path)}>{t('common.openInEditor')}</button>
      </div>
      {external && (
        <div className="editor-banner" role="alert">
          <span>{t('editor.changedOnDisk')}</span>
          <button onClick={useDiskVersion}>{t('editor.loadDisk')}</button>
        </div>
      )}
      {error ? (
        <p className="empty">{error}</p>
      ) : !disk ? (
        <LoaderPane label={t('loader.file')} />
      ) : !disk.text ? (
        <p className="empty">{disk.file.binary ? t('editor.binary') : t('editor.tooLarge', { size: formatSize(disk.file.size) })}</p>
      ) : (
        <CodeEditor key={path} value={buffer} onChange={(next) => setDraft(repo.root, path, next === baseline ? undefined : next)} onSave={() => void save()} lineEnd={lineEnd} label={path} />
      )}
    </section>
  )
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

interface BubbleProps {
  tone: 'commit' | 'editing'
  author: string
  when?: string
  text: string
  title: string
  onClick?(): void
}

/** Balão do fim da linha: quem, quando e o que fez. */
function BlameBubble({ tone, author, when, text, title, onClick }: BubbleProps) {
  const body = (
    <>
      <strong className="blame-bubble-author">{author}</strong>
      {when && <span className="blame-bubble-when"> · {when}</span>}
      <span className="blame-bubble-text"> · {text}</span>
    </>
  )
  // Clicar no balão não pode tirar o cursor do texto.
  return onClick ? (
    <button className={`blame-bubble ${tone}`} title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {body}
    </button>
  ) : (
    <span className={`blame-bubble ${tone}`} title={title}>
      {body}
    </span>
  )
}
