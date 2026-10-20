import { LOCALES, matchLocale, t } from '../../i18n'
import type { SettingsSectionProps } from './sections'
import { useAppInfo } from './useAppInfo'

/** Idioma da interface (e futuras opções gerais). */
export function GeneralSection({ draft, update }: SettingsSectionProps) {
  const info = useAppInfo()
  const detected = matchLocale(info?.systemLocales ?? navigator.languages)
  const detectedName = LOCALES.find((l) => l.id === detected)?.nativeName ?? detected

  return (
    <div className="settings-group">
      <h4>{t('settings.general.language')}</h4>
      <p className="muted small">{t('settings.general.languageHelp')}</p>
      <div className="language-list" role="radiogroup" aria-label={t('settings.general.language')}>
        <label className={`language-option ${draft.language === 'system' ? 'selected' : ''}`}>
          <input type="radio" name="language" checked={draft.language === 'system'} onChange={() => update({ language: 'system' })} />
          <span className="language-native">{t('settings.general.systemLanguage')}</span>
          <span className="muted small">{t('settings.general.detected', { language: detectedName })}</span>
        </label>
        {LOCALES.map((locale) => (
          <label key={locale.id} className={`language-option ${draft.language === locale.id ? 'selected' : ''}`} lang={locale.id} dir={locale.dir}>
            <input type="radio" name="language" checked={draft.language === locale.id} onChange={() => update({ language: locale.id })} />
            <span className="language-native">{locale.nativeName}</span>
            <span className="muted small" dir="ltr">
              {locale.englishName}
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}
