import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Troca CRLF por LF. No Windows o checkout pode trazer CRLF; as regexes dos testes comparam com "\n". */
export const normalizarFimDeLinha = (texto: string): string => texto.replace(/\r\n/g, '\n')

/** Lê um arquivo do repositório (caminho relativo à raiz) como texto com LF, qualquer que seja o checkout. */
export const lerTextoLF = (caminho: string): string =>
  normalizarFimDeLinha(readFileSync(fileURLToPath(new URL(`../../${caminho}`, import.meta.url)), 'utf8'))
