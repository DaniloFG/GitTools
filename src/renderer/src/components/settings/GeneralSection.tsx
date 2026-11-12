import { DEFAULT_SETTINGS } from '../../../../shared/settings'
import { insideVsCode } from '../../vscodeBridge'
import { LOCALES, matchLocale, t } from '../../i18n'
import { SettingCheckbox, SettingRow, SettingSelect } from './SettingRow'
import type { SettingsSectionProps } from './sections'
import { useAppInfo } from './useAppInfo'

/** Idioma da interface (e futuras opções gerais). */
export function GeneralSection({ draft, update }: SettingsSectionProps) {
  const info = useAppInfo()
  const detected = matchLocale(info?.systemLocales ?? navigator.languages)
  const detectedName = LOCALES.find((l) => l.id === detected)?.nativeName ?? detected
  const category = t('settings.general.title')

  return (
    <div className="settings-group">
      <SettingRow id="setting-language" category={category} title={t('settings.general.language')} description={t('settings.general.languageHelp')} modified={draft.language !== DEFAULT_SETTINGS.language}>
        <SettingSelect
          id="setting-language"
          value={draft.language}
          options={[
            { value: 'system', label: `${t('settings.general.systemLanguage')} (${t('settings.general.detected', { language: detectedName })})` },
            ...LOCALES.map((locale) => ({ value: locale.id, label: locale.nativeName }))
          ]}
          onChange={(language) => update({ language })}
        />
      </SettingRow>

      {insideVsCode() && (
        <SettingCheckbox
          id="setting-multi-repo"
          category={category}
          title={t('settings.general.multiRepo')}
          description={t('settings.general.multiRepoHelp')}
          checked={draft.multiRepoDetection}
          modified={draft.multiRepoDetection !== DEFAULT_SETTINGS.multiRepoDetection}
          onChange={(multiRepoDetection) => update({ multiRepoDetection })}
        />
      )}
    </div>
  )
}
