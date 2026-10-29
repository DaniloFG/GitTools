import { useContext, useState } from 'react'
import type { PushForce, RepoInfo } from '../../../shared/types'
import { AppContext } from '../context'
import { t } from '../i18n'
import { Modal } from './Modal'
import { RepoChip } from './RepoChip'

/**
 * Repositório a que o diálogo se refere. Dentro de um repositório, vem do contexto; no nível do app
 * (fechar uma aba, aplicar commits em outra) quem abre o diálogo informa.
 */
export interface DialogScope {
  repo: RepoInfo
  /** Há mais de um repositório aberto: o nome aparece no título, para não confundir de qual é a ação. */
  several: boolean
}

export interface ConfirmRequest {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
}

export interface PromptRequest {
  title: string
  label: string
  initial?: string
  placeholder?: string
  confirmLabel?: string
  /** Segundo campo, opcional (ex.: mensagem da tag); o valor é entregue a `onDetail` ao confirmar. */
  detail?: { label: string; placeholder?: string; onDetail(value: string): void }
  /** Caixa de seleção opcional (ex.: "fazer checkout"); o valor final é entregue a `onCheck` ao confirmar. */
  check?: { label: string; checked: boolean; onCheck(value: boolean): void }
}

export interface ChoiceOption {
  id: string
  label: string
  description?: string
  danger?: boolean
}

export interface ChoiceCheck {
  id: string
  label: string
  checked?: boolean
}

export interface ChoiceRequest {
  title: string
  message?: string
  options: ChoiceOption[]
  checks?: ChoiceCheck[]
}

export interface ChoiceResult {
  id: string
  checks: Record<string, boolean>
}

export interface PushRequest {
  branch: string
  remotes: string[]
  /** Remote escolhido de início. */
  remote: string
  force?: PushForce
}

export interface PushResult {
  remote: string
  force?: PushForce
}

export type DialogState =
  | ({ kind: 'confirm'; resolve(v: boolean): void } & ConfirmRequest)
  | ({ kind: 'prompt'; resolve(v: string | null): void } & PromptRequest)
  | ({ kind: 'choice'; resolve(v: ChoiceResult | null): void } & ChoiceRequest)
  | ({ kind: 'push'; resolve(v: PushResult | null): void } & PushRequest)

/**
 * Diálogo de confirmação, pergunta ou escolha. Mostra o nome do repositório (chip colorido no título) quando há
 * mais de um aberto: é aqui, num ponto só, que todo diálogo recebe essa identificação.
 */
export function DialogHost({ dialog, onDone, scope }: { dialog: DialogState; onDone(): void; scope?: DialogScope | null }) {
  const app = useContext(AppContext)
  const resolved: DialogScope | null = scope !== undefined ? scope : app ? { repo: app.repo, several: app.workspace.repos.length > 1 } : null
  if (dialog.kind === 'confirm') return <ConfirmDialog dialog={dialog} onDone={onDone} scope={resolved} />
  if (dialog.kind === 'prompt') return <PromptDialog dialog={dialog} onDone={onDone} scope={resolved} />
  if (dialog.kind === 'push') return <PushDialog dialog={dialog} onDone={onDone} scope={resolved} />
  return <ChoiceDialog dialog={dialog} onDone={onDone} scope={resolved} />
}

/** Título do diálogo com o chip do repositório, quando ele é identificado (há mais de um aberto). */
function DialogTitle({ title, scope }: { title: string; scope: DialogScope | null }) {
  return (
    <>
      {title}
      {scope?.several && <RepoChip repo={scope.repo} className="dialog-repo" />}
    </>
  )
}

function ConfirmDialog({ dialog, onDone, scope }: { dialog: Extract<DialogState, { kind: 'confirm' }>; onDone(): void; scope: DialogScope | null }) {
  const close = (value: boolean) => {
    dialog.resolve(value)
    onDone()
  }
  return (
    <Modal
      title={<DialogTitle title={dialog.title} scope={scope} />}
      onClose={() => close(false)}
      footer={
        <>
          <button onClick={() => close(false)}>{t('common.cancel')}</button>
          <button className={dialog.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
            {dialog.confirmLabel ?? t('common.confirm')}
          </button>
        </>
      }
    >
      <p className="pre-line">{dialog.message}</p>
    </Modal>
  )
}

function PromptDialog({ dialog, onDone, scope }: { dialog: Extract<DialogState, { kind: 'prompt' }>; onDone(): void; scope: DialogScope | null }) {
  const [value, setValue] = useState(dialog.initial ?? '')
  const [detail, setDetail] = useState('')
  const [checked, setChecked] = useState(dialog.check?.checked ?? false)
  const close = (v: string | null) => {
    if (v !== null) {
      dialog.detail?.onDetail(detail)
      dialog.check?.onCheck(checked)
    }
    dialog.resolve(v)
    onDone()
  }
  return (
    <Modal
      title={<DialogTitle title={dialog.title} scope={scope} />}
      onClose={() => close(null)}
      footer={
        <>
          <button onClick={() => close(null)}>{t('common.cancel')}</button>
          <button className="primary" disabled={!value.trim()} onClick={() => close(value.trim())}>
            {dialog.confirmLabel ?? t('common.ok')}
          </button>
        </>
      }
    >
      <label className="field">
        <span>{dialog.label}</span>
        <input
          autoFocus
          value={value}
          placeholder={dialog.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && value.trim() && close(value.trim())}
        />
      </label>
      {dialog.detail && (
        <label className="field">
          <span>{dialog.detail.label}</span>
          <textarea rows={3} value={detail} placeholder={dialog.detail.placeholder} onChange={(e) => setDetail(e.target.value)} />
        </label>
      )}
      {dialog.check && (
        <label className="checkbox dialog-check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          {dialog.check.label}
        </label>
      )}
    </Modal>
  )
}

const PUSH_MODES: { id: PushForce | 'normal'; label: 'push.normal' | 'push.lease' | 'push.force'; help: 'push.normalHelp' | 'push.leaseHelp' | 'push.forceHelp' }[] = [
  { id: 'normal', label: 'push.normal', help: 'push.normalHelp' },
  { id: 'lease', label: 'push.lease', help: 'push.leaseHelp' },
  { id: 'force', label: 'push.force', help: 'push.forceHelp' }
]

/** Push com escolha do remote e do modo (normal, force com lease ou force). */
function PushDialog({ dialog, onDone, scope }: { dialog: Extract<DialogState, { kind: 'push' }>; onDone(): void; scope: DialogScope | null }) {
  const [remote, setRemote] = useState(dialog.remote)
  const [mode, setMode] = useState<PushForce | 'normal'>(dialog.force ?? 'normal')
  const close = (v: PushResult | null) => {
    dialog.resolve(v)
    onDone()
  }
  return (
    <Modal
      title={<DialogTitle title={t('push.title', { branch: dialog.branch })} scope={scope} />}
      onClose={() => close(null)}
      footer={
        <>
          <button onClick={() => close(null)}>{t('common.cancel')}</button>
          <button
            className={mode === 'force' ? 'danger' : 'primary'}
            disabled={!remote}
            onClick={() => close({ remote, force: mode === 'normal' ? undefined : mode })}
            autoFocus
          >
            {mode === 'normal' ? t('push.confirm') : t('push.forceConfirm')}
          </button>
        </>
      }
    >
      <label className="field">
        <span>{t('push.remote')}</span>
        <select value={remote} onChange={(e) => setRemote(e.target.value)}>
          {dialog.remotes.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        <span>{t('push.mode')}</span>
        <div className="radio-list" role="radiogroup">
          {PUSH_MODES.map((m) => (
            <label key={m.id} className={`radio-option ${mode === m.id ? 'selected' : ''} ${m.id === 'force' ? 'danger' : ''}`}>
              <input type="radio" name="push-mode" checked={mode === m.id} onChange={() => setMode(m.id)} />
              <span className="radio-text">
                <strong>{t(m.label)}</strong>
                <span>{t(m.help)}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </Modal>
  )
}

function ChoiceDialog({ dialog, onDone, scope }: { dialog: Extract<DialogState, { kind: 'choice' }>; onDone(): void; scope: DialogScope | null }) {
  const [checks, setChecks] = useState<Record<string, boolean>>(
    Object.fromEntries((dialog.checks ?? []).map((c) => [c.id, !!c.checked]))
  )
  const close = (v: ChoiceResult | null) => {
    dialog.resolve(v)
    onDone()
  }
  return (
    <Modal title={<DialogTitle title={dialog.title} scope={scope} />} onClose={() => close(null)} size="medium">
      {dialog.message && <p className="pre-line muted">{dialog.message}</p>}
      <div className="choice-list">
        {dialog.options.map((option, i) => (
          <button
            key={option.id}
            className={`choice ${option.danger ? 'danger' : ''}`}
            autoFocus={i === 0}
            onClick={() => close({ id: option.id, checks })}
          >
            <strong>{option.label}</strong>
            {option.description && <span>{option.description}</span>}
          </button>
        ))}
      </div>
      {dialog.checks && (
        <div className="choice-checks">
          {dialog.checks.map((c) => (
            <label key={c.id} className="checkbox">
              <input
                type="checkbox"
                checked={checks[c.id]}
                onChange={(e) => setChecks({ ...checks, [c.id]: e.target.checked })}
              />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </Modal>
  )
}
