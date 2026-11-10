import { DEFAULT_SETTINGS } from '../../../../shared/settings'
import { t } from '../../i18n'
import { SponsorNote } from '../Sponsor'
import { SettingRow } from './SettingRow'
import type { SettingsSectionProps } from './sections'
import { useAppInfo } from './useAppInfo'

/** Quem desenvolve o GitTools (nome e login no GitHub). */
const DEVELOPERS = [
  { name: 'Danilo Gama', login: 'DaniloFG' },
  { name: 'Anderson Jardim', login: 'AndersonJardim' }
]

export function AboutSection({ replace }: SettingsSectionProps) {
  const info = useAppInfo()
  const rows: [string, string][] = info
    ? [
        [t('settings.about.version'), info.version],
        [t('settings.about.git'), info.git ?? t('settings.about.gitMissing')],
        ...(info.vscode ? ([['VS Code', info.vscode]] as [string, string][]) : []),
        ...(info.electron ? ([['Electron', info.electron]] as [string, string][]) : []),
        ...(info.chrome ? ([['Chromium', info.chrome]] as [string, string][]) : []),
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
      <SponsorNote />
      <div className="about-developers">
        <h4>{t('settings.about.developers')}</h4>
        <ul>
          {DEVELOPERS.map((dev) => (
            <li key={dev.login}>
              <a href={`https://github.com/${dev.login}`} target="_blank" rel="noreferrer">
                {dev.name}
              </a>{' '}
              <span className="muted small" dir="ltr">
                github.com/{dev.login}
              </span>
            </li>
          ))}
        </ul>
      </div>
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
      <SettingRow title={t('settings.about.reset')} description={t('settings.about.resetHelp')}>
        <button onClick={() => replace({ ...DEFAULT_SETTINGS })}>{t('settings.about.reset')}</button>
      </SettingRow>
    </div>
  )
}
