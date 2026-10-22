import { useState } from 'react'
import type { PushForce } from '../../../shared/types'
import { t } from '../i18n'
import { Modal } from './Modal'

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

export function DialogHost({ dialog, onDone }: { dialog: DialogState; onDone(): void }) {
  if (dialog.kind === 'confirm') return <ConfirmDialog dialog={dialog} onDone={onDone} />
  if (dialog.kind === 'prompt') return <PromptDialog dialog={dialog} onDone={onDone} />
  if (dialog.kind === 'push') return <PushDialog dialog={dialog} onDone={onDone} />
  return <ChoiceDialog dialog={dialog} onDone={onDone} />
}

function ConfirmDialog({ dialog, onDone }: { dialog: Extract<DialogState, { kind: 'confirm' }>; onDone(): void }) {
  const close = (value: boolean) => {
    dialog.resolve(value)
    onDone()
  }
  return (
    <Modal
      title={dialog.title}
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

function PromptDialog({ dialog, onDone }: { dialog: Extract<DialogState, { kind: 'prompt' }>; onDone(): void }) {
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
      title={dialog.title}
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
function PushDialog({ dialog, onDone }: { dialog: Extract<DialogState, { kind: 'push' }>; onDone(): void }) {
  const [remote, setRemote] = useState(dialog.remote)
  const [mode, setMode] = useState<PushForce | 'normal'>(dialog.force ?? 'normal')
  const close = (v: PushResult | null) => {
    dialog.resolve(v)
    onDone()
  }
  return (
    <Modal
      title={t('push.title', { branch: dialog.branch })}
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

function ChoiceDialog({ dialog, onDone }: { dialog: Extract<DialogState, { kind: 'choice' }>; onDone(): void }) {
  const [checks, setChecks] = useState<Record<string, boolean>>(
    Object.fromEntries((dialog.checks ?? []).map((c) => [c.id, !!c.checked]))
  )
  const close = (v: ChoiceResult | null) => {
    dialog.resolve(v)
    onDone()
  }
  return (
    <Modal title={dialog.title} onClose={() => close(null)} size="medium">
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
