// Escolhe a versão da extensão do VS Code que o workflow publica.
//
// O Marketplace recusa uma versão que já existe. Para não depender de alguém lembrar de subir o número a cada
// merge, o CI calcula a versão a partir das tags v<versão> do repositório (cada publicação cria a sua tag ao
// anexar o release). Uma minor ou major continua sendo subida à mão em extension/package.json.
//
// Regra:
//  - sem tag válida, ou se o arquivo tem versão maior que a última tag: vale a do arquivo;
//  - senão (igual ou menor): a última tag com o último número + 1 (0.12.0 vira 0.12.1).

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const TAG = /^v\d+\.\d+\.\d+$/
const VERSION = /^\d+\.\d+\.\d+$/

/** "0.10.0" ou "v0.10.0" viram [0, 10, 0]: a comparação é número por número, não texto. */
function parts(version) {
  return version.replace(/^v/, '').split('.').map(Number)
}

/** Negativo, zero ou positivo, como um comparador de `sort`. */
function compare(a, b) {
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

/**
 * Versão a publicar, dada a de extension/package.json e os nomes das tags do repositório.
 * Tags que não são `v<x>.<y>.<z>` são ignoradas.
 */
export function nextExtensionVersion(fileVersion, tags = []) {
  if (typeof fileVersion !== 'string' || !VERSION.test(fileVersion)) {
    throw new Error(`Versão de extension/package.json inválida: "${fileVersion}" (esperado x.y.z, ex.: 0.13.0).`)
  }

  const validTags = tags.filter((tag) => typeof tag === 'string' && TAG.test(tag))
  if (validTags.length === 0) return fileVersion

  // A maior tag válida, comparada por número.
  const last = validTags.reduce((max, tag) => (compare(tag, max) > 0 ? tag : max)).replace(/^v/, '')

  // Versão do arquivo acima da última tag: o desenvolvedor subiu à mão (minor ou major).
  if (compare(fileVersion, last) > 0) return fileVersion

  // Igual ou menor: publica o próximo patch da última tag.
  const [major, minor, patch] = parts(last)
  return `${major}.${minor}.${patch + 1}`
}

/** Roteiro de CI: lê a versão do arquivo e as tags, e imprime só a versão escolhida. */
function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const pkg = JSON.parse(readFileSync(join(root, 'extension', 'package.json'), 'utf8'))
  // Exige o checkout com fetch-depth: 0; sem ele as tags não vêm e a versão automática fica errada.
  const output = execFileSync('git', ['tag', '-l', 'v*'], { cwd: root, encoding: 'utf8' })
  const tags = output.split('\n').map((line) => line.trim()).filter(Boolean)
  process.stdout.write(`${nextExtensionVersion(pkg.version, tags)}\n`)
}

// Só roda o roteiro quando o arquivo é executado direto (node scripts/extension-version.mjs), não ao ser importado.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
