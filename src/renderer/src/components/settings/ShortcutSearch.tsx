import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { comboFromEvent, displayCombo, type ShortcutQuery } from '../../shortcuts'

/**
 * Campo de pesquisa de atalhos: digite o nome da ação (ou as teclas, ex.: "ctrl+b"), ou clique em ⌨
 * e pressione a combinação para achar a ação que a usa.
 */
export function ShortcutSearch({ query, onChange, autoFocus = false }: { query: ShortcutQuery; onChange(query: ShortcutQuery): void; autoFocus?: boolean }) {
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    if (!recording) return
    // Na fase de captura, antes dos atalhos globais e do Esc dos diálogos.
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(false)
        return
      }
      const combo = comboFromEvent(e)
      if (!combo) return
      onChange({ ...query, combo })
      setRecording(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, query, onChange])

  return (
    <div className="shortcut-search">
      <div className="search-box">
        <span className="search-icon">⌕</span>
        <input
          type="search"
          value={query.text}
          placeholder={t('shortcuts.search.placeholder')}
          autoFocus={autoFocus}
          onChange={(e) => onChange({ ...query, text: e.target.value })}
        />
      </div>
      <button
        className={recording ? 'active recording-button' : ''}
        title={t('shortcuts.search.recordHelp')}
        aria-pressed={recording}
        onClick={() => setRecording(!recording)}
      >
        ⌨ {recording ? t('shortcuts.search.recording') : t('shortcuts.search.record')}
      </button>
      {query.combo && (
        <span className="combo-chip">
          <kbd dir="ltr">{displayCombo(query.combo)}</kbd>
          <button className="link" title={t('shortcuts.search.clearKeys')} onClick={() => onChange({ ...query, combo: null })}>
            ✕
          </button>
        </span>
      )}
    </div>
  )
}
