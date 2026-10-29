import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { WIN } from './tests/support/scale'

// No Windows o git e o sistema de arquivos são bem mais lentos: os testes têm mais tempo.
const timeout = WIN ? 180_000 : 120_000

export default defineConfig({
  // A extensão do VS Code é testada com uma versão mínima da API do VS Code.
  resolve: { alias: { vscode: fileURLToPath(new URL('./tests/support/vscode.ts', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: timeout,
    hookTimeout: timeout
  }
})
