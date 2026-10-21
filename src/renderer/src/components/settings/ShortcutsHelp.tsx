import { useState } from 'react'
import type { Settings } from '../../../../shared/settings'
import { t } from '../../i18n'
import {
  displayCombo,
  FIXED_SHORTCUTS,
  matchesShortcut,
  resolveBindings,
  SHORTCUT_ACTIONS,
  SHORTCUT_GROUP_LABELS,
  SHORTCUT_LABELS,
  type ShortcutQuery
} from '../../shortcuts'
import { Modal } from '../Modal'
import { ShortcutSearch } from './ShortcutSearch'

/** Lista de atalhos (F1). */
export function ShortcutsHelp({ settings, onClose }: { settings: Settings; onClose(): void }) {
  const [query, setQuery] = useState<ShortcutQuery>({ text: '' })
  const bindings = resolveBindings(settings.shortcuts)
  const shown = SHORTCUT_ACTIONS.filter((a) => matchesShortcut(t(SHORTCUT_LABELS[a.id]), bindings[a.id], query))
  const fixed = FIXED_SHORTCUTS.filter(([keys, label]) => matchesShortcut(t(label), keys, query))
  const groups = [...new Set(shown.map((a) => a.group))]
  return (
    <Modal title={`⌨ ${t('shortcuts.helpTitle')}`} size="medium" id="shortcuts" onClose={onClose}>
      <ShortcutSearch query={query} onChange={setQuery} autoFocus />
      {shown.length === 0 && fixed.length === 0 && <p className="empty">{t('shortcuts.search.none')}</p>}
      {groups.map((group) => (
        <section key={group}>
          <h3 className="settings-title">{t(SHORTCUT_GROUP_LABELS[group])}</h3>
          <table className="shortcut-table">
            <tbody>
              {shown.filter((a) => a.group === group).map((a) => (
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
      {fixed.length > 0 && <h3 className="settings-title">{t('shortcuts.fixed.title')}</h3>}
      <table className="shortcut-table">
        <tbody>
          {fixed.map(([keys, label]) => (
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
