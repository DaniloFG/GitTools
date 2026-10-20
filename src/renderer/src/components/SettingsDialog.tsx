import { useEffect, useState } from 'react'
import type { Settings, ThemeSetting } from '../../../shared/api'
import { comboFromEvent, displayCombo, FIXED_SHORTCUTS, resolveBindings, SHORTCUT_ACTIONS } from '../shortcuts'
import { Modal } from './Modal'

const THEMES: { id: ThemeSetting; label: string }[] = [
  { id: 'system', label: 'Igual ao sistema' },
  { id: 'dark', label: 'Escuro' },
  { id: 'light', label: 'Claro' }
]

export function SettingsDialog({ settings, onSave, onClose }: { settings: Settings; onSave(s: Settings): Promise<void>; onClose(): void }) {
  const [draft, setDraft] = useState<Settings>(settings)
  const [recording, setRecording] = useState<string | null>(null)
  const bindings = resolveBindings(draft.shortcuts)

  // Grava a próxima combinação de teclas para a ação escolhida.
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(null)
        return
      }
      const combo = comboFromEvent(e)
      if (!combo) return
      setDraft((d) => ({ ...d, shortcuts: { ...d.shortcuts, [recording]: combo } }))
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording])

  const duplicates = new Set(
    Object.values(bindings).filter((combo, i, all) => combo && all.indexOf(combo) !== i)
  )

  const preview = (next: Settings) => {
    setDraft(next)
    document.documentElement.dataset.theme = next.theme
    window.gittools.setZoom(next.zoom)
  }

  const cancel = () => {
    preview(settings)
    onClose()
  }

  return (
    <Modal
      title="⚙ Configurações"
      size="medium"
      onClose={recording ? () => setRecording(null) : cancel}
      footer={
        <>
          {duplicates.size > 0 && <span className="footer-summary warning-text">Há atalhos repetidos.</span>}
          <button onClick={cancel}>Cancelar</button>
          <button
            className="primary"
            disabled={duplicates.size > 0}
            onClick={async () => {
              await onSave(draft)
              onClose()
            }}
          >
            Salvar
          </button>
        </>
      }
    >
      <h3 className="settings-title">Aparência</h3>
      <div className="settings-row">
        <span>Tema</span>
        <div className="segmented">
          {THEMES.map((t) => (
            <button key={t.id} className={draft.theme === t.id ? 'active' : ''} onClick={() => preview({ ...draft, theme: t.id })}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-row">
        <span>Tamanho da interface</span>
        <select value={draft.zoom} onChange={(e) => preview({ ...draft, zoom: Number(e.target.value) })}>
          {[0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6].map((n) => (
            <option key={n} value={n}>
              {Math.round(n * 100)}%{n === 1 ? ' (padrão)' : ''}
            </option>
          ))}
        </select>
      </div>

      <h3 className="settings-title">
        Atalhos de teclado
        <button className="link" onClick={() => setDraft({ ...draft, shortcuts: {} })}>
          restaurar todos
        </button>
      </h3>
      <table className="shortcut-table">
        <tbody>
          {SHORTCUT_ACTIONS.map((a) => (
            <tr key={a.id}>
              <td>{a.label}</td>
              <td>
                {recording === a.id ? (
                  <kbd className="recording">pressione as teclas… (Esc cancela)</kbd>
                ) : (
                  <kbd className={duplicates.has(bindings[a.id]) ? 'duplicate' : ''}>{displayCombo(bindings[a.id])}</kbd>
                )}
              </td>
              <td className="shortcut-actions">
                <button onClick={() => setRecording(a.id)}>Alterar</button>
                {draft.shortcuts[a.id] && (
                  <button
                    className="link"
                    onClick={() => {
                      const rest = { ...draft.shortcuts }
                      delete rest[a.id]
                      setDraft({ ...draft, shortcuts: rest })
                    }}
                  >
                    padrão
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}

export function ShortcutsHelp({ settings, onClose }: { settings: Settings; onClose(): void }) {
  const bindings = resolveBindings(settings.shortcuts)
  const groups = [...new Set(SHORTCUT_ACTIONS.map((a) => a.group))]
  return (
    <Modal title="⌨ Atalhos de teclado" size="medium" onClose={onClose}>
      {groups.map((group) => (
        <section key={group}>
          <h3 className="settings-title">{group}</h3>
          <table className="shortcut-table">
            <tbody>
              {SHORTCUT_ACTIONS.filter((a) => a.group === group).map((a) => (
                <tr key={a.id}>
                  <td>{a.label}</td>
                  <td>
                    <kbd>{displayCombo(bindings[a.id])}</kbd>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <h3 className="settings-title">Nas listas e diálogos</h3>
      <table className="shortcut-table">
        <tbody>
          {FIXED_SHORTCUTS.map(([keys, label]) => (
            <tr key={keys}>
              <td>{label}</td>
              <td>
                <kbd>{keys}</kbd>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Os atalhos podem ser alterados em ⚙ Configurações.</p>
    </Modal>
  )
}
