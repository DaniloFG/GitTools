import { useEffect, useState } from 'react'
import type { Settings } from '../../../../shared/settings'
import { t } from '../../i18n'
import { comboFromEvent, displayCombo, resolveBindings, SHORTCUT_ACTIONS, SHORTCUT_GROUP_LABELS, SHORTCUT_LABELS } from '../../shortcuts'
import type { SettingsSectionProps } from './sections'

/** Combinações usadas por mais de uma ação. */
export function duplicateShortcuts(settings: Settings): Set<string> {
  const combos = Object.values(resolveBindings(settings.shortcuts))
  return new Set(combos.filter((combo, i) => combo && combos.indexOf(combo) !== i))
}

export function ShortcutsSection({ draft, update }: SettingsSectionProps) {
  const [recording, setRecording] = useState<string | null>(null)
  const bindings = resolveBindings(draft.shortcuts)
  const duplicates = duplicateShortcuts(draft)
  const groups = [...new Set(SHORTCUT_ACTIONS.map((a) => a.group))]

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
      update({ shortcuts: { ...draft.shortcuts, [recording]: combo } })
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, draft.shortcuts, update])

  const reset = (id: string) => {
    const rest = { ...draft.shortcuts }
    delete rest[id]
    update({ shortcuts: rest })
  }

  return (
    <div className="settings-group">
      <div className="settings-row">
        <span className="muted small">{t('settings.shortcuts.help')}</span>
        <button className="link" disabled={Object.keys(draft.shortcuts).length === 0} onClick={() => update({ shortcuts: {} })}>
          {t('settings.shortcuts.resetAll')}
        </button>
      </div>
      {groups.map((group) => (
        <div key={group}>
          <h4>{t(SHORTCUT_GROUP_LABELS[group])}</h4>
          <table className="shortcut-table">
            <tbody>
              {SHORTCUT_ACTIONS.filter((a) => a.group === group).map((a) => (
                <tr key={a.id}>
                  <td>{t(SHORTCUT_LABELS[a.id])}</td>
                  <td>
                    {recording === a.id ? (
                      <kbd className="recording">{t('settings.shortcuts.recording')}</kbd>
                    ) : (
                      <kbd className={duplicates.has(bindings[a.id]) ? 'duplicate' : ''} dir="ltr">
                        {displayCombo(bindings[a.id])}
                      </kbd>
                    )}
                  </td>
                  <td className="shortcut-actions">
                    <button onClick={() => setRecording(a.id)}>{t('settings.shortcuts.change')}</button>
                    {draft.shortcuts[a.id] && (
                      <button className="link" onClick={() => reset(a.id)}>
                        {t('settings.shortcuts.default')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
