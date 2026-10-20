// Registro das seções da Central de Configurações.
// Para uma nova seção: crie o componente (recebe SettingsSectionProps) e acrescente uma entrada
// em SETTINGS_SECTIONS. A central cuida de navegação, pré-visualização, validação e salvamento.

import type { ComponentType } from 'react'
import type { Settings } from '../../../../shared/settings'
import type { MessageKey } from '../../i18n'
import { AboutSection } from './AboutSection'
import { AppearanceSection } from './AppearanceSection'
import { GeneralSection } from './GeneralSection'
import { ShortcutsSection, duplicateShortcuts } from './ShortcutsSection'

export interface SettingsSectionProps {
  draft: Settings
  update(patch: Partial<Settings>): void
  /** Substitui todas as configurações (ex.: restaurar padrões). */
  replace(settings: Settings): void
}

export interface SettingsSectionDef {
  id: string
  icon: string
  title: MessageKey
  description: MessageKey
  component: ComponentType<SettingsSectionProps>
  /** Retorna uma mensagem de erro quando o rascunho não pode ser salvo. */
  validate?(draft: Settings): MessageKey | null
}

export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    id: 'general',
    icon: '🌐',
    title: 'settings.general.title',
    description: 'settings.general.description',
    component: GeneralSection
  },
  {
    id: 'appearance',
    icon: '🎨',
    title: 'settings.appearance.title',
    description: 'settings.appearance.description',
    component: AppearanceSection
  },
  {
    id: 'shortcuts',
    icon: '⌨',
    title: 'settings.shortcuts.title',
    description: 'settings.shortcuts.description',
    component: ShortcutsSection,
    validate: (draft) => (duplicateShortcuts(draft).size > 0 ? 'settings.shortcuts.duplicates' : null)
  },
  {
    id: 'about',
    icon: 'ℹ',
    title: 'settings.about.title',
    description: 'settings.about.description',
    component: AboutSection
  }
]
