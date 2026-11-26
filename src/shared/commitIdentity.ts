/**
 * Autor e data do autor que o amend pode trocar. Vive em `shared` porque a interface (que bloqueia o botão) e o núcleo
 * (que recusa antes de chamar o git) precisam da mesma regra.
 */
export interface CommitIdentity {
  /** `Nome <email>`, o formato de `git commit --author`. */
  author?: string
  /** `YYYY-MM-DDTHH:mm` ou `YYYY-MM-DDTHH:mm:ss`, a saída do `<input type="datetime-local">`, em hora local. */
  date?: string
}

/** Nome sem `<`, `>` nem quebra de linha, um espaço, e o e-mail entre `<` e `>` com uma arroba e sem espaços. */
const AUTHOR = /^([^<>\n\r]+) <[^<>\s@]+@[^<>\s]+>$/
const DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

export function isValidAuthor(author: string): boolean {
  const match = AUTHOR.exec(author)
  return match !== null && match[1].trim() !== ''
}

/**
 * Data que o git entende e que existe no calendário. O `Date.parse` sozinho aceita 30 de fevereiro (vira 2 de março),
 * por isso a data é reconstruída e comparada campo a campo. Antes de 1970 o git não representa a data.
 */
export function isValidDate(date: string): boolean {
  const match = DATE.exec(date)
  if (!match) return false
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => (part === undefined ? 0 : Number(part)))
  if (year < 1970) return false
  // UTC na reconstrução: o fuso local tem horas que não existem (mudança de horário) e não pode reprovar a data.
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (Number.isNaN(Date.parse(date))) return false
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day &&
    parsed.getUTCHours() === hour &&
    parsed.getUTCMinutes() === minute &&
    parsed.getUTCSeconds() === second
  )
}

/** Qual opção está inválida (`null` se nenhuma). Opção ausente (`undefined`) não é validada; vazia é inválida. */
export function invalidIdentityField(options: CommitIdentity): 'author' | 'date' | null {
  if (options.author !== undefined && !isValidAuthor(options.author)) return 'author'
  if (options.date !== undefined && !isValidDate(options.date)) return 'date'
  return null
}

/** `Nome <email>` a partir dos campos do commit. */
export function formatAuthor(name: string, email: string): string {
  return `${name} <${email}>`
}

/** Segundos Unix no formato do `datetime-local` (hora local, sem fuso). */
export function toDateInput(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
