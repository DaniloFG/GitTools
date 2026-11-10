import { DEFAULT_SETTINGS, TOAST_HEIGHT, TOAST_SIZES, TOAST_WIDTH, type ToastHorizontal, type ToastVertical } from '../../../../shared/settings'
import { t, type MessageKey } from '../../i18n'
import { SettingRow, SettingSegmented } from './SettingRow'
import type { SettingsSectionProps } from './sections'

const HORIZONTAL: { id: ToastHorizontal; label: MessageKey }[] = [
  { id: 'left', label: 'settings.notifications.left' },
  { id: 'center', label: 'settings.notifications.center' },
  { id: 'right', label: 'settings.notifications.right' }
]
const VERTICAL: { id: ToastVertical; label: MessageKey }[] = [
  { id: 'top', label: 'settings.notifications.top' },
  { id: 'middle', label: 'feedback.toast.middle' },
  { id: 'bottom', label: 'settings.notifications.bottom' }
]
const SIZES: { id: keyof typeof TOAST_SIZES; label: MessageKey }[] = [
  { id: 'standard', label: 'feedback.toast.sizeStandard' },
  { id: 'large', label: 'feedback.toast.sizeLarge' },
  { id: 'extra', label: 'feedback.toast.sizeExtra' },
  { id: 'wide', label: 'feedback.toast.sizeWide' }
]

/** Tamanho de referência da janela na miniatura (a amostra é desenhada em 1/6 dele). */
const SCREEN = { width: 1200, height: 720 }
const SCALE = 1 / 6

/**
 * Onde e com que tamanho aparecem as notificações; a pré-visualização vale na hora.
 * Posição "centro" na horizontal + "no meio" na vertical deixa o aviso exatamente no centro do app.
 */
export function NotificationsSection({ draft, update }: SettingsSectionProps) {
  const toast = draft.toast
  const base = DEFAULT_SETTINGS.toast
  const category = t('settings.notifications.title')
  const set = (patch: Partial<typeof toast>) => update({ toast: { ...toast, ...patch } })
  const width = Math.min(toast.width, SCREEN.width - 32) * SCALE
  const height = Math.min(Math.max(toast.height * 0.5, 44), toast.height, SCREEN.height - 32) * SCALE
  const sample = () => window.dispatchEvent(new CustomEvent('gittools:toast', { detail: { kind: 'info', text: t('settings.notifications.sample') } }))
  const activeSize = SIZES.find((s) => TOAST_SIZES[s.id].width === toast.width && TOAST_SIZES[s.id].height === toast.height)?.id

  return (
    <div className="settings-group">
      <SettingRow category={category} title={t('settings.notifications.horizontal')} modified={toast.horizontal !== base.horizontal}>
        <SettingSegmented
          ariaLabel={t('settings.notifications.horizontal')}
          value={toast.horizontal}
          options={HORIZONTAL.map((o) => ({ value: o.id, label: t(o.label) }))}
          onChange={(horizontal) => set({ horizontal })}
        />
      </SettingRow>

      <SettingRow category={category} title={t('settings.notifications.vertical')} modified={toast.vertical !== base.vertical}>
        <SettingSegmented
          ariaLabel={t('settings.notifications.vertical')}
          value={toast.vertical}
          options={VERTICAL.map((o) => ({ value: o.id, label: t(o.label) }))}
          onChange={(vertical) => set({ vertical })}
        />
      </SettingRow>

      <SettingRow category={category} title={t('feedback.toast.sizeLabel')} modified={activeSize !== 'standard'}>
        <SettingSegmented
          ariaLabel={t('feedback.toast.sizeLabel')}
          value={activeSize ?? ''}
          options={SIZES.map((o) => ({ value: o.id, label: t(o.label) }))}
          onChange={(id) => set({ ...TOAST_SIZES[id as keyof typeof TOAST_SIZES] })}
        />
      </SettingRow>

      <SettingRow id="setting-toast-width" category={category} title={t('settings.notifications.width')} modified={toast.width !== base.width}>
        <div className="range-field">
          <input id="setting-toast-width" type="range" min={TOAST_WIDTH.min} max={TOAST_WIDTH.max} step={TOAST_WIDTH.step} value={toast.width} onChange={(e) => set({ width: Number(e.target.value) })} />
          <output dir="ltr">{toast.width}px</output>
        </div>
      </SettingRow>

      <SettingRow id="setting-toast-height" category={category} title={t('settings.notifications.height')} description={t('settings.notifications.heightHelp')} modified={toast.height !== base.height}>
        <div className="range-field">
          <input id="setting-toast-height" type="range" min={TOAST_HEIGHT.min} max={TOAST_HEIGHT.max} step={TOAST_HEIGHT.step} value={toast.height} onChange={(e) => set({ height: Number(e.target.value) })} />
          <output dir="ltr">{toast.height}px</output>
        </div>
      </SettingRow>

      {/* Miniatura da janela com a notificação no lugar escolhido. */}
      <div className="toast-preview" dir="ltr" style={{ width: SCREEN.width * SCALE, height: SCREEN.height * SCALE }} aria-hidden>
        <div
          className="toast-preview-toast"
          style={{
            width,
            height,
            ...(toast.vertical === 'middle' ? { top: `calc(50% - ${height / 2}px)` } : { [toast.vertical]: 16 * SCALE }),
            ...(toast.horizontal === 'center' ? { left: `calc(50% - ${width / 2}px)` } : { [toast.horizontal]: 16 * SCALE })
          }}
        />
      </div>

      <SettingRow category={category} title={t('settings.notifications.reset')} modified={false}>
        <button onClick={() => update({ toast: { ...DEFAULT_SETTINGS.toast } })}>{t('settings.notifications.reset')}</button>
      </SettingRow>
      <SettingRow category={category} title={t('settings.notifications.show')} description={t('settings.notifications.sample')}>
        <button className="primary" onClick={sample}>
          {t('settings.notifications.show')}
        </button>
      </SettingRow>
    </div>
  )
}
