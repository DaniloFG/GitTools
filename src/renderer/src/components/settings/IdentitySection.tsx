import { useEffect, useState } from 'react'
import type { GitConfigScope, GitIdentities, GitIdentity } from '../../../../shared/types'
import { t } from '../../i18n'

const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')

/**
 * Nome e e-mail usados nos commits (user.name / user.email), para todos os repositórios ou só para o
 * aberto. Fica no git, não nas configurações do GitTools: por isso tem o próprio botão de salvar.
 */
export function IdentitySection() {
  const [identities, setIdentities] = useState<GitIdentities | null>(null)
  const [scope, setScope] = useState<GitConfigScope>('global')
  const [form, setForm] = useState<GitIdentity>({ name: '', email: '' })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const load = () =>
    window.gittools.gitIdentity().then(
      (ids) => setIdentities(ids),
      (e) => setMessage({ ok: false, text: errorText(e) })
    )

  useEffect(() => {
    void load()
  }, [])

  // Ao trocar de escopo (ou depois de ler), o formulário mostra o que está gravado naquele escopo.
  useEffect(() => {
    if (!identities) return
    setForm(scope === 'local' && identities.local ? identities.local : identities.global)
  }, [identities, scope])

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      await window.gittools.setGitIdentity(scope, form)
      await load()
      setMessage({ ok: true, text: t('identity.saved') })
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) })
    } finally {
      setSaving(false)
    }
  }

  if (!identities) {
    return (
      <p className="muted">
        <span className="spinner" /> {t('identity.loading')}
      </p>
    )
  }

  const hasRepo = identities.local !== null
  const saved = scope === 'local' && identities.local ? identities.local : identities.global
  const changed = form.name.trim() !== saved.name || form.email.trim() !== saved.email
  const show = (v: string) => v || t('identity.notSet')

  return (
    <div className="settings-group identity">
      <h4>{t('identity.scope')}</h4>
      <div className="language-list" role="radiogroup" aria-label={t('identity.scope')}>
        <label className={`language-option ${scope === 'global' ? 'selected' : ''}`}>
          <input type="radio" name="identity-scope" checked={scope === 'global'} onChange={() => setScope('global')} />
          <span className="language-native">{t('identity.global')}</span>
          <span className="muted small">{t('identity.globalHelp')}</span>
        </label>
        <label className={`language-option ${scope === 'local' ? 'selected' : ''} ${hasRepo ? '' : 'disabled'}`} title={hasRepo ? '' : t('identity.noRepo')}>
          <input type="radio" name="identity-scope" disabled={!hasRepo} checked={scope === 'local'} onChange={() => setScope('local')} />
          <span className="language-native">{t('identity.local')}</span>
          <span className="muted small">{hasRepo ? t('identity.localHelp') : t('identity.noRepo')}</span>
        </label>
      </div>

      <div className="identity-fields">
        <label className="field">
          <span>{t('identity.name')}</span>
          <input value={form.name} placeholder={t('identity.namePlaceholder')} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="field">
          <span>{t('identity.email')}</span>
          <input
            type="text"
            inputMode="email"
            dir="ltr"
            value={form.email}
            placeholder={t('identity.emailPlaceholder')}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && changed && !saving && save()}
          />
        </label>
      </div>
      <p className="muted small">{t('identity.clearHelp')}</p>
      <div className="button-row">
        <button className="primary" disabled={!changed || saving} onClick={save}>
          {saving ? <span className="spinner" /> : t('identity.save')}
        </button>
      </div>
      {message && <p className={message.ok ? 'success-text' : 'warning-text'}>{message.text}</p>}
      {identities.effective && (
        <p className="muted small identity-effective">
          {t('identity.effective', { name: show(identities.effective.name), email: show(identities.effective.email) })}
        </p>
      )}
    </div>
  )
}
