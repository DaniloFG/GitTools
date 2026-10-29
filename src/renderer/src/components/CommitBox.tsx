import { useState } from 'react'
import type { PushForce } from '../../../shared/types'
import { useActions } from '../actions'
import { useApp } from '../context'
import { errorMessage } from '../format'
import { git } from '../git'
import { useLayout } from '../layout'
import { t } from '../i18n'

type PushMode = 'normal' | PushForce
const parsePushMode = (v: unknown): PushMode => (v === 'lease' || v === 'force' ? v : 'normal')

/**
 * Mensagem e "corrigir o último commit" digitados, por repositório. A caixa sai da tela quando o usuário troca de
 * menu; guardar aqui (e não só no componente) faz o texto continuar lá quando ele voltar.
 */
const drafts = new Map<string, { message: string; amend: boolean }>()
const draftOf = (root: string) => drafts.get(root) ?? { message: '', amend: false }

/**
 * Caixa de commit: as opções se combinam livremente — corrigir o último commit (amend), incluir tudo,
 * e enviar em seguida (normal, force com lease ou force). O botão diz o que vai acontecer.
 */
export function CommitBox() {
  const { data, run, repo } = useApp()
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
  const [stageAll, setStageAll] = useLayout<boolean>('pref.commitStageAll', (v) => v === true)
  const [push, setPush] = useLayout<boolean>('pref.commitPush', (v) => v === true)
  const [chosenMode, setMode] = useLayout<PushMode>('pref.commitPushMode', parsePushMode)
  const { status } = data
  const pending = status.unstaged.length
  const useStageAll = stageAll && pending > 0
  const canCommit = !!message.trim() && (status.staged.length > 0 || amend || useStageAll) && status.conflicted.length === 0
  // Corrigir um commit que já está no remoto reescreve o histórico dele: o push comum seria recusado.
  const needsForce = push && amend && !!status.upstream && status.ahead === 0
  const mode: PushMode = needsForce && chosenMode === 'normal' ? 'lease' : chosenMode
  const forced = push && mode !== 'normal'

  const commit = async () => {
    if (!canCommit) return
    if (push && mode === 'force' && !(await confirmForce('force', status.branch))) return
    let committed = false
    const result = await run(push ? t('busy.commitPush') : amend ? t('busy.amending') : t('busy.commit'), async () => {
      if (useStageAll) await git.stageFiles(status.unstaged.map((f) => f.path))
      await git.commit(message, amend)
      committed = true
      if (!push) return true
      try {
        return await git.push(undefined, { force: mode === 'normal' ? undefined : mode })
      } catch (error) {
        throw new Error(t('changes.pushFailedAfterCommit', { error: errorMessage(error) }))
      }
    })
    // O commit já foi feito mesmo que o push tenha falhado: limpar a caixa evita repeti-lo.
    if (result || committed) {
      setMessage('')
      setAmend(false)
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
      : status.branch
        ? t('changes.commitInto', { branch: status.branch })
        : t('changes.commit')

  return (
    <div className="commit-box">
      <textarea
        placeholder={t('changes.commitPlaceholder')}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && commit()}
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
          />
          {t('changes.amend')}
        </label>
        {pending > 0 && (
          <label className="checkbox" title={t('changes.commitStageAllHelp')}>
            <input type="checkbox" checked={stageAll} onChange={(e) => setStageAll(e.target.checked)} />
            {t('changes.commitStageAll')}
          </label>
        )}
        <label className="checkbox">
          <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} disabled={!status.branch} />
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
      {needsForce && <p className="muted commit-hint">{t('changes.amendNeedsForce')}</p>}
      <div className="commit-actions">
        <button className={mode === 'force' && push ? 'danger' : 'primary'} disabled={!canCommit} onClick={commit}>
          {label}
        </button>
      </div>
    </div>
  )
}
