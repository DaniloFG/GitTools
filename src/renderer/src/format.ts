export const shortSha = (sha: string) => sha.slice(0, 7)

export function relativeDate(ms: number): string {
  const diff = (Date.now() - ms) / 1000
  if (diff < 60) return 'agora'
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`
  if (diff < 86400 * 30) return `há ${Math.floor(diff / 86400)} d`
  return new Date(ms).toLocaleDateString('pt-BR')
}

export const fullDate = (ms: number) => new Date(ms).toLocaleString('pt-BR')

/** Remove o prefixo que o Electron adiciona a erros vindos do processo principal. */
export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+': /, '').replace(/^\w*Error: /, '')
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const STATUS_LABEL: Record<string, string> = {
  M: 'modificado',
  A: 'adicionado',
  D: 'removido',
  R: 'renomeado',
  C: 'copiado',
  T: 'tipo alterado',
  U: 'em conflito',
  '?': 'novo'
}

export const statusLabel = (code: string) => STATUS_LABEL[code] ?? code
