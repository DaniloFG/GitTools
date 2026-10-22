// Gera src/renderer/src/fileIcons.generated.ts: um subconjunto dos ícones de arquivo do Material Icon
// Theme (licença MIT, ver THIRD_PARTY_NOTICES.md) — só os tipos de arquivo mais comuns, para não
// embutir os ~1250 ícones do pacote. Rode com `npm run build:icons` ao mudar as listas abaixo.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const pkg = 'node_modules/material-icon-theme'
const manifest = JSON.parse(readFileSync(join(pkg, 'dist/material-icons.json'), 'utf8'))

/** Extensões (e sufixos compostos, como "test.ts") que ganham um ícone próprio. */
const EXTENSIONS = `js mjs cjs jsx ts tsx mts cts d.ts test.ts spec.ts test.tsx spec.tsx test.js spec.js test.jsx spec.jsx stories.tsx stories.ts
json jsonc json5 md mdx markdown css scss sass less styl html htm xhtml vue svelte astro py pyc pyi ipynb java class jar kt kts go rs c h cpp cc cxx hpp cs csx fs php rb erb swift dart lua r sql prisma
sh bash zsh fish ps1 psm1 bat cmd yml yaml toml ini cfg conf env xml xsl svg png jpg jpeg gif webp ico bmp avif tiff pdf doc docx xls xlsx csv ppt pptx
zip tar gz tgz bz2 7z rar log txt lock exe dll so dylib msi apk dmg iso mp3 wav flac ogg mp4 mkv mov avi webm ttf otf woff woff2 eot
tf tfvars proto graphql gql gradle groovy scala clj ex exs erl hs ml zig nim sol wasm jsx coffee elm jl pl tex bib
dockerfile dockerignore gitignore gitattributes gitmodules editorconfig npmrc nvmrc prettierrc eslintrc babelrc browserslistrc
config.js config.ts config.mjs config.cjs min.js min.css map snap patch diff`.split(/\s+/).filter(Boolean)

/** Nomes de arquivo (minúsculos) com ícone próprio. */
const FILENAMES = `package.json package-lock.json tsconfig.json jsconfig.json readme.md readme license license.md license.txt changelog.md contributing.md
dockerfile docker-compose.yml docker-compose.yaml .dockerignore .gitignore .gitattributes .gitmodules .editorconfig .npmrc .nvmrc .env .env.example
.eslintrc .eslintrc.js .eslintrc.json .eslintrc.cjs eslint.config.js eslint.config.mjs eslint.config.ts .prettierrc .prettierrc.json prettier.config.js
vite.config.ts vite.config.js vitest.config.ts vitest.config.js webpack.config.js rollup.config.js jest.config.js jest.config.ts tailwind.config.js tailwind.config.ts postcss.config.js babel.config.js .babelrc
makefile cmakelists.txt yarn.lock pnpm-lock.yaml pnpm-workspace.yaml bun.lockb requirements.txt pipfile pyproject.toml setup.py cargo.toml cargo.lock go.mod go.sum
pom.xml build.gradle settings.gradle gemfile gemfile.lock composer.json composer.lock .gitlab-ci.yml .travis.yml jenkinsfile vercel.json netlify.toml
electron-builder.yml electron.vite.config.ts .vscodeignore .npmignore robots.txt manifest.json`.split(/\s+/).filter(Boolean)

const used = new Set([manifest.file, manifest.folder, manifest.folderExpanded])
const byExt = {}
const byName = {}
const lightExt = {}
const lightName = {}
for (const ext of EXTENSIONS) {
  const icon = manifest.fileExtensions[ext]
  if (icon) {
    byExt[ext] = icon
    used.add(icon)
  }
  const light = manifest.light?.fileExtensions?.[ext]
  if (light) {
    lightExt[ext] = light
    used.add(light)
  }
}
for (const name of FILENAMES) {
  const icon = manifest.fileNames[name]
  if (icon) {
    byName[name] = icon
    used.add(icon)
  }
  const light = manifest.light?.fileNames?.[name]
  if (light) {
    lightName[name] = light
    used.add(light)
  }
}

/** Remove o que não é preciso do SVG (declaração e espaços); o resto é do pacote, sem alterações. */
const clean = (svg) => svg.replace(/<\?xml[^>]*\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').trim()
const svgs = {}
for (const name of [...used].sort()) {
  const def = manifest.iconDefinitions[name]
  if (!def) continue
  svgs[name] = clean(readFileSync(join(pkg, 'dist', def.iconPath), 'utf8'))
}

const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))
const out = `// ARQUIVO GERADO por scripts/build-file-icons.mjs — não edite à mão.
// Ícones do Material Icon Theme (MIT, © Philipp Kief): ver THIRD_PARTY_NOTICES.md.

export const FILE_ICON_SVGS: Record<string, string> = ${JSON.stringify(sorted(svgs), null, 1)}

export const FILE_ICON_DEFAULT = ${JSON.stringify(manifest.file)}
export const FOLDER_ICON = ${JSON.stringify(manifest.folder)}
export const FOLDER_ICON_OPEN = ${JSON.stringify(manifest.folderExpanded)}

export const ICON_BY_EXTENSION: Record<string, string> = ${JSON.stringify(sorted(byExt), null, 1)}
export const ICON_BY_FILENAME: Record<string, string> = ${JSON.stringify(sorted(byName), null, 1)}

/** Variantes para temas claros (só os tipos que têm uma). */
export const LIGHT_ICON_BY_EXTENSION: Record<string, string> = ${JSON.stringify(sorted(lightExt), null, 1)}
export const LIGHT_ICON_BY_FILENAME: Record<string, string> = ${JSON.stringify(sorted(lightName), null, 1)}
`
writeFileSync('src/renderer/src/fileIcons.generated.ts', out)
console.log(`${Object.keys(svgs).length} ícones, ${Object.keys(byExt).length} extensões, ${Object.keys(byName).length} nomes (${(out.length / 1024).toFixed(0)} KB)`)
