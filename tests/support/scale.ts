/**
 * Escala dos testes pesados (muitos arquivos, commits e conflitos).
 *
 * No Windows cada processo do git e cada arquivo custam bem mais que no Linux/macOS, então os testes
 * usam tamanhos menores nessa plataforma. Os tamanhos continuam acima dos limiares que a lógica testa
 * (lotes de ARG_BUDGET e CONFLICT_BATCH, o limite de 2 MB da saída do terminal), então a cobertura é a mesma.
 *
 * Para exercitar a escala do Windows em outra plataforma: `GITTOOLS_TEST_SCALE=win npx vitest run`.
 * Use `GITTOOLS_TEST_SCALE=full` para forçar a escala completa no Windows.
 */
const forced = process.env.GITTOOLS_TEST_SCALE

export const WIN = forced ? forced === 'win' : process.platform === 'win32'

/** `full` na escala completa; `win` no Windows (ou com GITTOOLS_TEST_SCALE=win). */
export const scale = (full: number, win: number): number => (WIN ? win : full)
