import { t } from '../../i18n'
import { SettingRow } from './SettingRow'

/**
 * Seção do Tour: só o botão que começa o passeio. As Configurações são o diálogo de quem chama, então o botão
 * avisa o App por um evento (o mesmo desenho de `gittools:toast`); o App fecha as Configurações e abre o Tour.
 */
export function TourSection() {
  return (
    <div className="settings-group">
      <SettingRow category={t('tour.settings.title')} title={t('tour.settings.start')} description={t('tour.settings.description')}>
        <button onClick={() => window.dispatchEvent(new CustomEvent('gittools:tour'))}>{t('tour.settings.start')}</button>
      </SettingRow>
    </div>
  )
}
