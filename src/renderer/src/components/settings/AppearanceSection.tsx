import { ZOOM_LEVELS, type ThemeSetting } from '../../../../shared/settings'
import { t, type MessageKey } from '../../i18n'
import type { SettingsSectionProps } from './sections'

const THEMES: { id: ThemeSetting; label: MessageKey }[] = [
  { id: 'system', label: 'settings.appearance.themeSystem' },
  { id: 'dark', label: 'settings.appearance.themeDark' },
  { id: 'light', label: 'settings.appearance.themeLight' }
]

export function AppearanceSection({ draft, update }: SettingsSectionProps) {
  return (
    <div className="settings-group">
      <div className="settings-row">
        <span>{t('settings.appearance.theme')}</span>
        <div className="segmented">
          {THEMES.map((theme) => (
            <button key={theme.id} className={draft.theme === theme.id ? 'active' : ''} onClick={() => update({ theme: theme.id })}>
              {t(theme.label)}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-row">
        <span>{t('settings.appearance.zoom')}</span>
        <select value={draft.zoom} onChange={(e) => update({ zoom: Number(e.target.value) })}>
          {ZOOM_LEVELS.map((n) => (
            <option key={n} value={n}>
              {Math.round(n * 100)}%{n === 1 ? ` ${t('settings.appearance.default')}` : ''}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
