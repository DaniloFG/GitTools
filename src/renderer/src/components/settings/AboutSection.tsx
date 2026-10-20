import { DEFAULT_SETTINGS } from '../../../../shared/settings'
import { t } from '../../i18n'
import type { SettingsSectionProps } from './sections'
import { useAppInfo } from './useAppInfo'

export function AboutSection({ replace }: SettingsSectionProps) {
  const info = useAppInfo()
  const rows: [string, string][] = info
    ? [
        [t('settings.about.version'), info.version],
        [t('settings.about.git'), info.git ?? t('settings.about.gitMissing')],
        ['Electron', info.electron],
        ['Chromium', info.chrome],
        ['Node.js', info.node],
        [t('settings.about.platform'), info.platform],
        [t('settings.about.settingsFile'), info.settingsFile]
      ]
    : []
  return (
    <div className="settings-group">
      <p className="logo">
        <span className="logo-mark">⑂</span> GitTools
      </p>
      <p className="muted">{t('welcome.tagline')}</p>
      <table className="shortcut-table about-table">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <td>{label}</td>
              <td>
                <code dir="ltr">{value}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="settings-row">
        <span className="muted small">{t('settings.about.resetHelp')}</span>
        <button onClick={() => replace({ ...DEFAULT_SETTINGS })}>{t('settings.about.reset')}</button>
      </div>
    </div>
  )
}
