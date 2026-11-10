import { useEffect, useState } from 'react'
import type { GitConfigScope, GitIdentities, GitIdentity } from '../../../../shared/types'
import { t } from '../../i18n'
import { getActiveRoot } from '../../git'
import { RemotesSection } from './RemotesSection'
import { SettingRow, SettingSegmented } from './SettingRow'
import { Loader } from '../Loader'

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
    // A identidade é a do repositório da aba visível (as Configurações bloqueiam a troca de aba enquanto estão abertas).
    window.gittools.gitIdentity(getActiveRoot() ?? undefined).then(
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
      await window.gittools.setGitIdentity(scope, form, getActiveRoot() ?? undefined)
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
        <Loader size="sm" label={t('identity.loading')} />
      </p>
    )
  }

  const hasRepo = identities.local !== null
  const saved = scope === 'local' && identities.local ? identities.local : identities.global
  const changed = form.name.trim() !== saved.name || form.email.trim() !== saved.email
  const show = (v: string) => v || t('identity.notSet')

  return (
    <>
    <div className="settings-group identity">
      <SettingRow
        title={t('identity.scope')}
        description={hasRepo ? t('identity.localHelp') : t('identity.noRepo')}
        modified={scope !== 'global'}
      >
        <SettingSegmented
          ariaLabel={t('identity.scope')}
          value={scope}
          options={[
            { value: 'global', label: t('identity.global'), title: t('identity.globalHelp') },
            { value: 'local', label: t('identity.local'), title: hasRepo ? t('identity.localHelp') : t('identity.noRepo'), disabled: !hasRepo }
          ]}
          onChange={(v) => setScope(v as GitConfigScope)}
        />
      </SettingRow>

      <SettingRow id="identity-name" title={t('identity.name')}>
        <input
          id="identity-name"
          className="setting-input"
          value={form.name}
          placeholder={t('identity.namePlaceholder')}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </SettingRow>
      <SettingRow id="identity-email" title={t('identity.email')} description={t('identity.clearHelp')}>
        <input
          id="identity-email"
          className="setting-input"
          type="text"
          inputMode="email"
          dir="ltr"
          value={form.email}
          placeholder={t('identity.emailPlaceholder')}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && changed && !saving && save()}
        />
      </SettingRow>
      <SettingRow title={t('identity.save')}>
        <div className="setting-inline">
          <button className="primary" disabled={!changed || saving} onClick={save}>
            {saving ? <Loader size="sm" /> : t('identity.save')}
          </button>
          {message && <span className={message.ok ? 'success-text' : 'warning-text'}>{message.text}</span>}
        </div>
      </SettingRow>
      {identities.effective && (
        <p className="muted small identity-effective">
          {t('identity.effective', { name: show(identities.effective.name), email: show(identities.effective.email) })}
        </p>
      )}
    </div>
    <RemotesSection />
    </>
  )
}
