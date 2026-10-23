// Cria os repositórios de exemplo usados nos prints dos READMEs (sem depender de nada da máquina de quem roda).
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const PEOPLE = {
  ana: { name: 'Ana Costa', email: 'ana@example.com' },
  carla: { name: 'Carla Souza', email: 'carla@example.com' },
  bruno: { name: 'Bruno Lima', email: 'bruno@example.com' }
}

const TEXT = {
  en: {
    initial: 'Initial store setup',
    ignore: 'Add .gitignore',
    count: 'Cart: count items',
    loginValidate: 'Login: validate email',
    loginSession: 'Login: keep session',
    loginForm: 'Login form with disabled button',
    loginTests: 'Login: add tests',
    memberPrice: 'Cart: member prices',
    readme: 'Fix README typos',
    discount: 'Cart: discount codes',
    merge: 'Merge hotfix/readme'
  },
  pt: {
    initial: 'Projeto inicial da loja',
    ignore: 'Adiciona .gitignore',
    count: 'Carrinho: conta os itens',
    loginValidate: 'Login: valida o e-mail',
    loginSession: 'Login: mantém a sessão',
    loginForm: 'Formulário de login com botão desabilitado',
    loginTests: 'Login: adiciona testes',
    memberPrice: 'Carrinho: preço para membros',
    readme: 'Corrige erros de digitação no README',
    discount: 'Carrinho: códigos de desconto',
    merge: 'Merge de hotfix/readme'
  }
}

const CART_V1 = `// Shopping cart helpers.
export function addItem(cart, item) {
  return [...cart, item]
}

export function total(cart) {
  return cart.reduce((sum, item) => sum + item.price, 0)
}
`
const CART_V2 = `// Shopping cart helpers.
export function addItem(cart, item) {
  return [...cart, item]
}

export function countItems(cart) {
  return cart.length
}

export function total(cart) {
  return cart.reduce((sum, item) => sum + item.price, 0)
}
`
const CART_V3 = `// Shopping cart helpers.
export function addItem(cart, item) {
  return [...cart, item]
}

export function countItems(cart) {
  return cart.length
}

export function applyDiscount(amount, code) {
  const rates = { WELCOME: 0.1, VIP: 0.2 }
  return amount * (1 - (rates[code] ?? 0))
}

export function total(cart, code) {
  const amount = cart.reduce((sum, item) => sum + item.price, 0)
  return applyDiscount(amount, code)
}
`
const CART_FEATURE = `// Shopping cart helpers.
export function addItem(cart, item) {
  return [...cart, item]
}

export function countItems(cart) {
  return cart.length
}

export function total(cart) {
  // Logged-in users get the member price.
  return cart.reduce((sum, item) => sum + (item.memberPrice ?? item.price), 0)
}
`
const AUTH_V1 = `export function validEmail(email) {
  return /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)
}
`
const AUTH_V2 = `export function validEmail(email) {
  return /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)
}

export function saveSession(token) {
  localStorage.setItem('session', token)
}
`
const BUTTON_V1 = `export function Button({ label, onClick }) {
  return <button onClick={onClick}>{label}</button>
}
`
const BUTTON_V2 = `export function Button({ label, onClick, disabled = false }) {
  return (
    <button onClick={onClick} disabled={disabled}>
      {label}
    </button>
  )
}
`
const LOGIN_FORM = `import { validEmail } from '../auth/login'
import { Button } from './Button'

export function LoginForm({ email, onSubmit }) {
  const valid = validEmail(email)
  return (
    <form onSubmit={onSubmit}>
      <input value={email} placeholder="you@example.com" />
      <Button label="Sign in" disabled={!valid} />
    </form>
  )
}
`
const README_V1 = `# Acme Shop

A small store front used to try GitTools.

Run \`npm instal\` and then \`npm start\`.
`
const README_V2 = `# Acme Shop

A small store front used to try GitTools.

Run \`npm install\` and then \`npm start\`.
`

/**
 * `lang`: idioma das mensagens de commit ('en' | 'pt'). Devolve os ids dos commits principais.
 * Termina com duas alterações não commitadas (uma delas já no stage).
 */
export function createDemoRepo(dir, lang = 'en', { wip = true } = {}) {
  const m = TEXT[lang]
  mkdirSync(dir, { recursive: true })
  const run = (env, ...args) => execFileSync('git', args, { cwd: dir, env: { ...process.env, ...env }, encoding: 'utf8' }).trim()
  const git = (...args) => run({}, ...args)
  const day = (d, h, min = 0) => new Date(Date.UTC(2026, 9, d, h, min)).toISOString()
  const write = (path, content) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  const commit = (who, when, message, files = {}) => {
    for (const [path, content] of Object.entries(files)) write(path, content)
    git('add', '-A')
    const p = PEOPLE[who]
    const env = { GIT_AUTHOR_NAME: p.name, GIT_AUTHOR_EMAIL: p.email, GIT_AUTHOR_DATE: when, GIT_COMMITTER_NAME: p.name, GIT_COMMITTER_EMAIL: p.email, GIT_COMMITTER_DATE: when }
    run(env, 'commit', '-q', '-m', message)
    return git('rev-parse', 'HEAD')
  }

  git('init', '-q', '-b', 'main')
  git('config', 'user.name', PEOPLE.ana.name)
  git('config', 'user.email', PEOPLE.ana.email)
  git('config', 'commit.gpgsign', 'false')
  git('config', 'core.autocrlf', 'false')

  const ids = {}
  ids.initial = commit('ana', day(12, 10), m.initial, { 'README.md': README_V1, 'package.json': '{\n  "name": "acme-shop",\n  "version": "1.0.0"\n}\n', 'src/cart.js': CART_V1, 'src/ui/Button.tsx': BUTTON_V1 })
  ids.ignore = commit('ana', day(13, 9, 30), m.ignore, { '.gitignore': 'node_modules/\ndist/\n' })
  ids.count = commit('bruno', day(14, 16, 45), m.count, { 'src/cart.js': CART_V2 })

  git('checkout', '-q', '-b', 'feature/login')
  ids.loginValidate = commit('carla', day(15, 11, 10), m.loginValidate, { 'src/auth/login.js': AUTH_V1 })
  ids.loginSession = commit('carla', day(15, 15, 20), m.loginSession, { 'src/auth/login.js': AUTH_V2 })
  ids.loginForm = commit('carla', day(16, 9, 5), m.loginForm, { 'src/ui/LoginForm.tsx': LOGIN_FORM, 'src/ui/Button.tsx': BUTTON_V2 })
  ids.loginTests = commit('carla', day(16, 14), m.loginTests, { 'src/auth/login.test.js': "import { validEmail } from './login'\n\ntest('accepts a normal address', () => {\n  expect(validEmail('a@b.co')).toBe(true)\n})\n" })

  // Uma segunda branch mexe no mesmo trecho do carrinho que a main vai mudar: serve para mostrar conflitos.
  git('checkout', '-q', ids.count)
  git('checkout', '-q', '-b', 'feature/member-price')
  ids.memberPrice = commit('carla', day(16, 15, 30), m.memberPrice, { 'src/cart.js': CART_FEATURE })

  git('checkout', '-q', 'main')
  git('checkout', '-q', '-b', 'hotfix/readme')
  ids.readme = commit('bruno', day(16, 13), m.readme, { 'README.md': README_V2 })
  git('checkout', '-q', 'main')
  ids.discount = commit('ana', day(16, 17, 30), m.discount, {
    'src/cart.js': CART_V3,
    'docs/discounts.md': '# Discount codes\n\n- `WELCOME`: 10% off the first order\n- `VIP`: 20% off for members\n',
    'src/ui/Cart.tsx': 'export function Cart({ items, code }) {\n  return <ul>{items.map((i) => <li key={i.id}>{i.name}</li>)}</ul>\n}\n'
  })
  const env = { GIT_AUTHOR_NAME: PEOPLE.ana.name, GIT_AUTHOR_EMAIL: PEOPLE.ana.email, GIT_AUTHOR_DATE: day(16, 19), GIT_COMMITTER_NAME: PEOPLE.ana.name, GIT_COMMITTER_EMAIL: PEOPLE.ana.email, GIT_COMMITTER_DATE: day(16, 19) }
  run(env, 'merge', '--no-ff', '-q', '-m', m.merge, 'hotfix/readme')
  ids.merge = git('rev-parse', 'HEAD')

  // Trabalho em andamento: um arquivo no stage e outro ainda não.
  if (wip) {
    write('src/cart.js', CART_V3.replace('VIP: 0.2', 'VIP: 0.25'))
    write('docs/notes.md', '# Notes\n\n- check the discount rates with finance\n')
    git('add', 'docs/notes.md')
  }
  return ids
}
