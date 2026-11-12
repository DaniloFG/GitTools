import { DEFAULT_SETTINGS } from '../../../../shared/settings'
import { t } from '../../i18n'
import { SettingCheckbox, SettingRow, SettingSelect } from './SettingRow'
import type { SettingsSectionProps } from './sections'

/**
 * Tela Conflitos: o que ela faz ao terminar a operação e ao abrir o app com conflito pendente. O "continuar sozinho"
 * também mora aqui (era da seção Geral); a chave i18n continua em `settings.general.autoContinue*`.
 */
export function ConflictsSection({ draft, update }: SettingsSectionProps) {
  const category = t('settings.conflicts.title')

  return (
    <div className="settings-group">
      <SettingRow
        id="setting-conflict-summary"
        category={category}
        title={t('settings.conflicts.summary')}
        description={t('settings.conflicts.summaryHelp')}
        modified={draft.conflictSummary !== DEFAULT_SETTINGS.conflictSummary}
      >
        <SettingSelect
          id="setting-conflict-summary"
          value={draft.conflictSummary}
          options={[
            { value: 'keep', label: t('settings.conflicts.summaryKeep') },
            { value: 'close', label: t('settings.conflicts.summaryClose') }
          ]}
          onChange={(conflictSummary) => update({ conflictSummary })}
        />
      </SettingRow>

      <SettingRow
        id="setting-conflict-startup"
        category={category}
        title={t('settings.conflicts.startup')}
        description={t('settings.conflicts.startupHelp')}
        modified={draft.conflictStartup !== DEFAULT_SETTINGS.conflictStartup}
      >
        <SettingSelect
          id="setting-conflict-startup"
          value={draft.conflictStartup}
          options={[
            { value: 'open', label: t('settings.conflicts.startupOpen') },
            { value: 'bannerOnly', label: t('settings.conflicts.startupBanner') }
          ]}
          onChange={(conflictStartup) => update({ conflictStartup })}
        />
      </SettingRow>

      <SettingCheckbox
        id="setting-auto-continue-conflicts"
        category={category}
        title={t('settings.general.autoContinue')}
        description={t('settings.general.autoContinueHelp')}
        checked={draft.autoContinueConflicts}
        modified={draft.autoContinueConflicts !== DEFAULT_SETTINGS.autoContinueConflicts}
        onChange={(autoContinueConflicts) => update({ autoContinueConflicts })}
      />
    </div>
  )
}
