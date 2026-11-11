// Pesquisa da Central de Configurações: lógica pura, sem React, para ser testada direto.

/** Os textos de uma linha de configuração que a pesquisa olha. */
export interface SearchableSetting {
  /** Assunto mostrado antes do título, ex.: "Aparência". */
  category?: string
  title: string
  description?: string
}

/**
 * A linha casa com o texto digitado? Sem texto (vazio ou só espaços), tudo casa. A comparação ignora maiúsculas
 * e junta categoria, título e descrição num texto só, assim "aparência" também acha as linhas da seção Aparência.
 */
export function matchesSetting(query: string, setting: SearchableSetting): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return `${setting.category ?? ''} ${setting.title} ${setting.description ?? ''}`.toLowerCase().includes(needle)
}
