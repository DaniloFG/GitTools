import { useState } from 'react'
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

export type DialogState =
  | ({ kind: 'confirm'; resolve(v: boolean): void } & ConfirmRequest)
  | ({ kind: 'prompt'; resolve(v: string | null): void } & PromptRequest)
  | ({ kind: 'choice'; resolve(v: ChoiceResult | null): void } & ChoiceRequest)

export function DialogHost({ dialog, onDone }: { dialog: DialogState; onDone(): void }) {
  if (dialog.kind === 'confirm') return <ConfirmDialog dialog={dialog} onDone={onDone} />
  if (dialog.kind === 'prompt') return <PromptDialog dialog={dialog} onDone={onDone} />
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
          <button onClick={() => close(false)}>Cancelar</button>
          <button className={dialog.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
            {dialog.confirmLabel ?? 'Confirmar'}
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
  const close = (v: string | null) => {
    dialog.resolve(v)
    onDone()
  }
  return (
    <Modal
      title={dialog.title}
      onClose={() => close(null)}
      footer={
        <>
          <button onClick={() => close(null)}>Cancelar</button>
          <button className="primary" disabled={!value.trim()} onClick={() => close(value.trim())}>
            {dialog.confirmLabel ?? 'OK'}
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
