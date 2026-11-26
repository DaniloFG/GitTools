import { useRef, useState } from 'react'
import { useActions } from '../actions'
import { useAppActions, useBusy, useRepoData } from '../context'
import { errorMessage } from '../format'
import { git } from '../git'
import { commitBlock, effectivePushMode, parsePushMode, type CommitBlock, type PushMode } from '../feedback'
import { useLayout } from '../layout'
import { t, type MessageKey } from '../i18n'
import { formatAuthor, invalidIdentityField, toDateInput, type CommitIdentity } from '../../../shared/commitIdentity'

/** Explicação de cada motivo que impede o commit. */
const BLOCK_TEXT: Record<CommitBlock, MessageKey> = {
  conflicts: 'feedback.blocked.conflicts',
  message: 'feedback.blocked.commitMessage',
  nothing: 'feedback.blocked.commitNothing'
}

/** Explicação de cada opção de autor do amend que está marcada mas vazia ou inválida. */
const IDENTITY_TEXT = { author: 'changes.authorInvalid', date: 'changes.authorDateInvalid' } as const satisfies Record<'author' | 'date', MessageKey>

interface Draft {
  message: string
  amend: boolean
  /** "Definir data do autor" marcada e o valor do `datetime-local`. */
  dateOn: boolean
  date: string
  /** "Definir autor" marcada e o texto `Nome <email>`. */
  authorOn: boolean
  author: string
}

/**
 * Mensagem, "corrigir o último commit" e as opções de autor do amend digitados, por repositório. A caixa sai da tela
 * quando o usuário troca de menu; guardar aqui (e não só no componente) faz o texto continuar lá quando ele voltar.
 */
const drafts = new Map<string, Draft>()
const draftOf = (root: string): Draft => drafts.get(root) ?? { message: '', amend: false, dateOn: false, date: '', authorOn: false, author: '' }

/**
 * Caixa de commit: as opções se combinam livremente — corrigir o último commit (amend) e enviar em seguida
 * (normal, force com lease ou force). O botão diz o que vai acontecer.
 */
export function CommitBox({ picked = [], onCommitted }: { picked?: string[]; onCommitted?(): void }) {
  const { data, repo } = useRepoData()
  const { run, toast } = useAppActions()
  // Operação em andamento: Commit e Ctrl+Enter não disparam outro commit enquanto a primeira não termina.
  const { busy } = useBusy()
  // Pergunta de force push aberta: `busy` ainda é null nela, então este guarda é o que impede uma segunda pergunta.
  const confirming = useRef(false)
  const { confirmForce } = useActions()
  const [message, setMessageState] = useState(() => draftOf(repo.root).message)
  const [amend, setAmendState] = useState(() => draftOf(repo.root).amend)
  const [dateOn, setDateOnState] = useState(() => draftOf(repo.root).dateOn)
  const [date, setDateState] = useState(() => draftOf(repo.root).date)
  const [authorOn, setAuthorOnState] = useState(() => draftOf(repo.root).authorOn)
  const [author, setAuthorState] = useState(() => draftOf(repo.root).author)
  const keep = (patch: Partial<Draft>) => drafts.set(repo.root, { ...draftOf(repo.root), ...patch })
  const setMessage = (text: string) => {
    setMessageState(text)
    keep({ message: text })
  }
  const setAmend = (on: boolean) => {
    setAmendState(on)
    keep({ amend: on })
  }
  const setDateOn = (on: boolean) => {
    setDateOnState(on)
    keep({ dateOn: on })
  }
  const setDate = (text: string) => {
    setDateState(text)
    keep({ date: text })
  }
  const setAuthorOn = (on: boolean) => {
    setAuthorOnState(on)
    keep({ authorOn: on })
  }
  const setAuthor = (text: string) => {
    setAuthorState(text)
    keep({ author: text })
  }
  /** Marcar a opção pré-preenche com o autor e a data do HEAD (se o campo está vazio); o usuário edita a partir daí. */
  const prefill = async (field: 'date' | 'author') => {
    if (!status.headSha || draftOf(repo.root)[field]) return
    const head = await git.commitDetails('HEAD')
    // O usuário pode ter digitado enquanto a leitura voltava: o que ele escreveu vence.
    if (draftOf(repo.root)[field]) return
    if (field === 'date') setDate(toDateInput(head.date))
    else setAuthor(formatAuthor(head.author, head.email))
  }
  const [push, setPush] = useLayout<boolean>('pref.commitPush', (v) => v === true)
  const [chosenMode, setMode] = useLayout<PushMode>('pref.commitPushMode', parsePushMode)
  const { status } = data
  const block = commitBlock({ message, staged: status.staged.length, picked: picked.length, amend, conflicted: status.conflicted.length })
  // As opções de autor só existem com o amend ligado; desmarcado, somem e nada delas é enviado.
  const identity: CommitIdentity | undefined =
    amend && (dateOn || authorOn) ? { ...(dateOn ? { date } : {}), ...(authorOn ? { author: author.trim() } : {}) } : undefined
  const invalidField = identity ? invalidIdentityField(identity) : null
  const blockText = block ? t(BLOCK_TEXT[block]) : invalidField ? t(IDENTITY_TEXT[invalidField]) : undefined
  const canCommit = blockText === undefined
  const { needsForce, mode } = effectivePushMode({ push, amend, hasUpstream: !!status.upstream, ahead: status.ahead, chosen: chosenMode })
  const forced = push && mode !== 'normal'

  const commit = async () => {
    // Com operação em andamento, ou com a pergunta de force push já aberta, a chamada extra (Ctrl+Enter repetido) não faz nada.
    if (busy !== null || confirming.current) return
    if (blockText) return toast('warning', blockText)
    if (push && mode === 'force') {
      confirming.current = true
      let confirmed: boolean
      try {
        confirmed = await confirmForce('force', status.branch)
      } finally {
        confirming.current = false
      }
      if (!confirmed) return
    }
    let committed = false
    const result = await run(push ? t('busy.commitPush') : amend ? t('busy.amending') : t('busy.commit'), async () => {
      // Os arquivos marcados na lista de não staged entram no commit: são staged antes dele.
      if (picked.length > 0) await git.stageFiles(picked)
      // Sem opções, a chamada é a de sempre (dois argumentos): um `undefined` no fim viraria `null` no canal da extensão.
      if (identity) await git.commit(message, amend, identity)
      else await git.commit(message, amend)
      committed = true
      if (!push) return true
      try {
        return await git.push(undefined, { force: mode === 'normal' ? undefined : mode })
      } catch (error) {
        throw new Error(t('changes.pushFailedAfterCommit', { error: errorMessage(error) }))
      }
    })
    // O modo de envio é de uma vez só: depois de uma tentativa de push (mesmo que tenha falhado), volta a normal.
    // Sem isso, um force escolhido para um commit passava a valer para o próximo commit+push sem aviso (#57).
    if (push && committed) setMode(undefined)
    // O commit já foi feito mesmo que o push tenha falhado: limpar a caixa evita repeti-lo.
    if (result || committed) {
      setMessage('')
      setAmend(false)
      setDateOn(false)
      setDate('')
      setAuthorOn(false)
      setAuthor('')
      onCommitted?.()
    }
  }

  const label = push
    ? amend
      ? forced
        ? t('changes.amendForcePush')
        : t('changes.amendPush')
      : forced
        ? t('changes.commitForcePush')
        : t('changes.commitPush', { branch: status.branch ?? 'HEAD' })
    : amend
      ? t('changes.amendButton')
      : picked.length > 0
        ? t('changes.commitPicked', { count: picked.length })
        : status.branch
          ? t('changes.commitInto', { branch: status.branch })
          : t('changes.commit')

  return (
    <div className="commit-box">
      <textarea
        aria-label={t('changes.commitPlaceholder')}
        placeholder={t('changes.commitPlaceholder')}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && busy === null && commit()}
        rows={3}
      />
      <div className="commit-options">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={amend}
            onChange={async (e) => {
              setAmend(e.target.checked)
              if (e.target.checked && !message.trim() && status.headSha) {
                const head = await git.commitDetails('HEAD')
                setMessage(head.body ? `${head.subject}\n\n${head.body}` : head.subject)
              }
            }}
            disabled={!status.headSha}
            title={status.headSha ? undefined : t('feedback.blocked.noCommits')}
          />
          {t('changes.amend')}
        </label>
        {amend && (
          <>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={dateOn}
                onChange={(e) => {
                  setDateOn(e.target.checked)
                  if (e.target.checked) void prefill('date')
                }}
              />
              {t('changes.setAuthorDate')}
            </label>
            {dateOn && (
              <input
                type="datetime-local"
                step={1}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-label={t('changes.setAuthorDate')}
                aria-invalid={invalidField === 'date'}
              />
            )}
            <label className="checkbox">
              <input
                type="checkbox"
                checked={authorOn}
                onChange={(e) => {
                  setAuthorOn(e.target.checked)
                  if (e.target.checked) void prefill('author')
                }}
              />
              {t('changes.setAuthor')}
            </label>
            {authorOn && (
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder={t('changes.authorPlaceholder')}
                aria-label={t('changes.setAuthor')}
                aria-invalid={invalidField === 'author'}
              />
            )}
          </>
        )}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={push}
            onChange={(e) => setPush(e.target.checked)}
            disabled={!status.branch}
            title={status.branch ? undefined : t('feedback.blocked.noBranch')}
          />
          {t('changes.pushAfter')}
        </label>
        {push && (
          <select value={mode} onChange={(e) => setMode(parsePushMode(e.target.value))} title={t('push.mode')} aria-label={t('push.mode')}>
            <option value="normal" disabled={needsForce}>
              {t('push.normal')}
            </option>
            <option value="lease">{t('push.lease')}</option>
            <option value="force">{t('push.force')}</option>
          </select>
        )}
      </div>
      {picked.length > 0 && <p className="muted commit-hint">{t('changes.commitPickedHint')}</p>}
      {needsForce && <p className="muted commit-hint">{t('changes.amendNeedsForce')}</p>}
      <div className="commit-actions">
        <button
          className={mode === 'force' && push ? 'danger' : 'primary'}
          disabled={!canCommit || busy !== null}
          title={blockText}
          onClick={commit}
        >
          {label}
        </button>
      </div>
    </div>
  )
}
