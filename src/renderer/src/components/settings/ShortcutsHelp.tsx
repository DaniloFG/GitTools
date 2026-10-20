import type { Settings } from '../../../../shared/settings'
import { t } from '../../i18n'
import { displayCombo, FIXED_SHORTCUTS, resolveBindings, SHORTCUT_ACTIONS, SHORTCUT_GROUP_LABELS, SHORTCUT_LABELS } from '../../shortcuts'
import { Modal } from '../Modal'

/** Lista de atalhos (F1). */
export function ShortcutsHelp({ settings, onClose }: { settings: Settings; onClose(): void }) {
  const bindings = resolveBindings(settings.shortcuts)
  const groups = [...new Set(SHORTCUT_ACTIONS.map((a) => a.group))]
  return (
    <Modal title={`⌨ ${t('shortcuts.helpTitle')}`} size="medium" onClose={onClose}>
      {groups.map((group) => (
        <section key={group}>
          <h3 className="settings-title">{t(SHORTCUT_GROUP_LABELS[group])}</h3>
          <table className="shortcut-table">
            <tbody>
              {SHORTCUT_ACTIONS.filter((a) => a.group === group).map((a) => (
                <tr key={a.id}>
                  <td>{t(SHORTCUT_LABELS[a.id])}</td>
                  <td>
                    <kbd dir="ltr">{displayCombo(bindings[a.id])}</kbd>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <h3 className="settings-title">{t('shortcuts.fixed.title')}</h3>
      <table className="shortcut-table">
        <tbody>
          {FIXED_SHORTCUTS.map(([keys, label]) => (
            <tr key={keys}>
              <td>{t(label)}</td>
              <td>
                <kbd dir="ltr">{keys}</kbd>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">{t('shortcuts.helpFooter')}</p>
    </Modal>
  )
}
