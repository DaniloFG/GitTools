import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // A extensão do VS Code é testada com uma versão mínima da API do VS Code.
  resolve: { alias: { vscode: fileURLToPath(new URL('./tests/support/vscode.ts', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000
  }
})
