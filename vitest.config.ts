import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { WIN } from './tests/support/scale'

// No Windows o git e o sistema de arquivos são bem mais lentos: os testes têm mais tempo.
const timeout = WIN ? 180_000 : 120_000

// No Windows cada teste pesado cria processos (git, bash) e o vitest tem 3 workers em 4 vCPUs (padrão: núcleos - 1).
// O processo principal e os filhos ficam sem CPU e a resposta do RPC `onTaskUpdate` passa de 60 s: o vitest sai com
// código 1 mesmo com todos os testes verdes (job 130950712384: 372 s de relógio para 1022 s somados de testes, contra
// ~307 s da develop). Metade dos núcleos deixa folga para o principal e para os filhos; não afeta Linux nem macOS.
const maxWorkers = WIN ? Math.max(1, Math.floor(availableParallelism() / 2)) : undefined

export default defineConfig({
  // A extensão do VS Code é testada com uma versão mínima da API do VS Code.
  resolve: { alias: { vscode: fileURLToPath(new URL('./tests/support/vscode.ts', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts'],
    // Catálogos de idioma em memória (os aplicativos os carregam sob demanda; ver tests/support/catalogs.ts).
    setupFiles: ['tests/support/catalogs.ts'],
    maxWorkers,
    testTimeout: timeout,
    hookTimeout: timeout
  }
})
