import { useRef, useState } from 'react'
import { useActions } from '../actions'
import { useAppActions, useBusy, useRepoData } from '../context'
import { errorMessage } from '../format'
import { git } from '../git'
import { commitBlock, effectivePushMode, parsePushMode, type CommitBlock, type PushMode } from '../feedback'
import { useLayout } from '../layout'
import { t, type MessageKey } from '../i18n'

/** Explicação de cada motivo que impede o commit. */
const BLOCK_TEXT: Record<CommitBlock, MessageKey> = {
  conflicts: 'feedback.blocked.conflicts',
  message: 'feedback.blocked.commitMessage',
  nothing: 'feedback.blocked.commitNothing'
}

/**
 * Mensagem e "corrigir o último commit" digitados, por repositório. A caixa sai da tela quando o usuário troca de
 * menu; guardar aqui (e não só no componente) faz o texto continuar lá quando ele voltar.
 */
const drafts = new Map<string, { message: string; amend: boolean }>()
const draftOf = (root: string) => drafts.get(root) ?? { message: '', amend: false }

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
  const keep = (patch: Partial<{ message: string; amend: boolean }>) => drafts.set(repo.root, { ...draftOf(repo.root), ...patch })
  const setMessage = (text: string) => {
    setMessageState(text)
    keep({ message: text })
  }
  const setAmend = (on: boolean) => {
    setAmendState(on)
    keep({ amend: on })
  }
  const [push, setPush] = useLayout<boolean>('pref.commitPush', (v) => v === true)
  const [chosenMode, setMode] = useLayout<PushMode>('pref.commitPushMode', parsePushMode)
  const { status } = data
  const block = commitBlock({ message, staged: status.staged.length, picked: picked.length, amend, conflicted: status.conflicted.length })
  const canCommit = block === null
  const { needsForce, mode } = effectivePushMode({ push, amend, hasUpstream: !!status.upstream, ahead: status.ahead, chosen: chosenMode })
  const forced = push && mode !== 'normal'

  const commit = async () => {
    // Com operação em andamento, ou com a pergunta de force push já aberta, a chamada extra (Ctrl+Enter repetido) não faz nada.
    if (busy !== null || confirming.current) return
    if (block) return toast('warning', t(BLOCK_TEXT[block]))
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
      await git.commit(message, amend)
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
          title={block ? t(BLOCK_TEXT[block]) : undefined}
          onClick={commit}
        >
          {label}
        </button>
      </div>
    </div>
  )
}
