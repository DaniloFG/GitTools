import { createContext, useContext, type ReactNode } from 'react'
import { matchesSetting } from './settingsSearch'

/**
 * Texto da pesquisa da Central (vazio = mostra tudo). Cada linha se esconde quando o título,
 * a categoria ou a descrição não contêm o texto digitado.
 */
export const SettingsSearchContext = createContext('')

/** Uma opção da linha: ela só mostra o título, a descrição e o controle (sem cartões nem grupos). */
interface SettingRowProps {
  /** Nome da opção, em negrito. */
  title: string
  /** Texto menor, em cinza, abaixo do título. */
  description?: string
  /** Assunto mostrado em cinza antes do título, ex.: "Aparência: Tema". */
  category?: string
  /** Valor diferente do padrão: marca a linha com a barra azul à esquerda. */
  modified?: boolean
  /** Id do controle: o título vira o rótulo dele. */
  id?: string
  /** Quando verdadeiro, a descrição fica ao lado do checkbox (ver SettingCheckbox). */
  descriptionInline?: boolean
  children?: ReactNode
}

/** Linha de configuração: título e descrição em cima, controle alinhado à esquerda logo abaixo. */
export function SettingRow({ title, description, category, modified, id, descriptionInline, children }: SettingRowProps) {
  const hidden = !matchesSetting(useContext(SettingsSearchContext), { category, title, description })
  const label = (
    <>
      {category && <span className="setting-category">{category}: </span>}
      {title}
    </>
  )

  return (
    <div className={`setting-row${modified ? ' is-modified' : ''}`} hidden={hidden}>
      {id ? (
        <label className="setting-title" htmlFor={id}>
          {label}
        </label>
      ) : (
        <div className="setting-title">{label}</div>
      )}
      {description && !descriptionInline && <p className="setting-description">{description}</p>}
      {children && <div className="setting-control">{children}</div>}
    </div>
  )
}

interface SettingCheckboxProps extends Omit<SettingRowProps, 'children' | 'descriptionInline'> {
  checked: boolean
  onChange(checked: boolean): void
}

/** Liga/desliga: o checkbox e a descrição (clicável) ficam lado a lado, como no VS Code. */
export function SettingCheckbox({ checked, onChange, description, id, ...row }: SettingCheckboxProps) {
  return (
    <SettingRow {...row} id={id} description={description} descriptionInline>
      <label className="setting-check">
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {description && <span>{description}</span>}
      </label>
    </SettingRow>
  )
}

export interface SettingOption<T extends string | number> {
  value: T
  label: string
  disabled?: boolean
}

interface SettingSelectProps<T extends string | number> {
  id?: string
  /** Nome acessível do controle quando a linha não tem id. */
  ariaLabel?: string
  value: T
  options: SettingOption<T>[]
  disabled?: boolean
  onChange(value: T): void
}

/**
 * Lista suspensa nativa. Usa a posição da opção (e não o texto do valor), então vale para números e textos.
 */
export function SettingSelect<T extends string | number>({ id, ariaLabel, value, options, disabled, onChange }: SettingSelectProps<T>) {
  const index = options.findIndex((o) => o.value === value)
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      className="setting-select"
      disabled={disabled}
      value={String(index)}
      onChange={(e) => onChange(options[Number(e.target.value)].value)}
    >
      {index < 0 && <option value="-1" disabled>{String(value) || '—'}</option>}
      {options.map((o, i) => (
        <option key={`${o.value}`} value={String(i)} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

interface SettingSegmentedProps<T extends string | number> {
  ariaLabel: string
  value: T
  options: { value: T; label: string; title?: string; disabled?: boolean }[]
  onChange(value: T): void
}

/** Botões de escolha única lado a lado (ex.: tema, posição das notificações). */
export function SettingSegmented<T extends string | number>({ ariaLabel, value, options, onChange }: SettingSegmentedProps<T>) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={`${o.value}`}
          className={o.value === value ? 'active' : ''}
          aria-pressed={o.value === value}
          title={o.title}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
