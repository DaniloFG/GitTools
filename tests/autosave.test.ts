import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Salvamento automático (issue #112): .claude/hooks/autosave.sh commita com `wip:` e envia o trabalho pendente.
// Sem rede e sem o repositório real: cada teste cria um remoto bare local, um clone de trabalho (branch `trabalho`)
// e, quando precisa de um remoto que andou, um segundo clone.

const script = fileURLToPath(new URL('../.claude/hooks/autosave.sh', import.meta.url))

let base = ''
let remoto = ''
let clone = ''
let outro = ''

// Isola do ~/.gitconfig do desenvolvedor (assinatura, hooks globais, identidade).
const ambienteGit = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
}

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: ambienteGit })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} falhou: ${r.stderr}`)
  return r.stdout.trim()
}

function configurar(dir: string) {
  git(dir, 'config', 'user.name', 'Teste')
  git(dir, 'config', 'user.email', 'teste@example.com')
  git(dir, 'config', 'commit.gpgsign', 'false')
}

function rodar(projeto: string, ...args: string[]) {
  const r = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: { ...ambienteGit, CLAUDE_PROJECT_DIR: projeto },
  })
  // O hook nunca pode bloquear o Claude: em qualquer cenário sai com 0 e sem barulho.
  expect(r.status).toBe(0)
  expect(r.stdout).toBe('')
  return r
}

const escrever = (dir: string, nome: string, conteudo: string | Buffer) => {
  const destino = join(dir, nome)
  mkdirSync(join(destino, '..'), { recursive: true })
  writeFileSync(destino, conteudo)
}

const assunto = (dir: string, ref = 'HEAD') => git(dir, 'log', '-1', '--format=%s', ref)
const contagem = (dir: string, ref = 'HEAD') => Number(git(dir, 'rev-list', '--count', ref))
const emCommit = (dir: string) => git(dir, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean)
// Pendências sem a pasta .claude: o carimbo e o log do autosave ficam lá e o clone de teste não tem .gitignore.
const pendente = (dir: string) => git(dir, 'status', '--porcelain', '--', '.', ':(exclude).claude')
const pontaRemota = () => git(remoto, 'rev-parse', 'trabalho')

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'gittools-autosave-'))
})

afterAll(() => {
  rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

// Remoto bare + clone na branch `trabalho` com um commit inicial já enviado.
beforeEach(() => {
  const pasta = mkdtempSync(join(base, 'caso-'))
  remoto = join(pasta, 'remoto.git')
  clone = join(pasta, 'clone')
  outro = join(pasta, 'outro')
  git(pasta, 'init', '-q', '--bare', remoto)
  git(pasta, 'clone', '-q', remoto, clone)
  configurar(clone)
  git(clone, 'checkout', '-q', '-b', 'trabalho')
  escrever(clone, 'README.md', 'linha\n')
  git(clone, 'add', '-A')
  git(clone, 'commit', '-q', '-m', 'inicial')
  git(clone, 'push', '-q', '-u', 'origin', 'trabalho')
})

describe('autosave.sh', () => {
  it('com mudança commita com wip: e o remoto recebe', () => {
    escrever(clone, 'src/novo.ts', 'export {}\n')
    escrever(clone, 'README.md', 'linha alterada\n')
    rodar(clone)

    expect(assunto(clone)).toMatch(/^wip: salvamento automático \(\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\)$/)
    expect(contagem(clone)).toBe(2)
    expect(pontaRemota()).toBe(git(clone, 'rev-parse', 'HEAD'))
    expect(pendente(clone)).toBe('')

    const corpo = git(clone, 'log', '-1', '--format=%b')
    expect(corpo).toContain('Último commit antes:')
    expect(corpo).toContain('inicial')
    expect(corpo).toContain('Branch: trabalho')
    expect(corpo).toContain('src/novo.ts')
    expect(corpo).toContain('README.md')
  })

  it('sem mudança não cria commit', () => {
    const antes = git(clone, 'rev-parse', 'HEAD')
    rodar(clone)
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(antes)
    expect(contagem(clone)).toBe(1)
  })

  it('o próprio carimbo e o log do autosave não contam como mudança', () => {
    escrever(clone, 'a.txt', 'a\n')
    rodar(clone, '--limitado')
    expect(existsSync(join(clone, '.claude', 'autosave.stamp'))).toBe(true)
    expect(contagem(clone)).toBe(2)
    escrever(clone, '.claude/autosave.log', 'x\n')
    rodar(clone)
    expect(contagem(clone)).toBe(2)
    expect(emCommit(clone)).not.toContain('.claude/autosave.stamp')
  })

  it.each(['develop', 'homolog', 'main'])('na branch %s não faz nada', (nome) => {
    git(clone, 'checkout', '-q', '-b', nome)
    escrever(clone, 'a.txt', 'a\n')
    const antes = git(clone, 'rev-parse', 'HEAD')
    rodar(clone)
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(antes)
    expect(git(clone, 'status', '--porcelain')).toContain('a.txt')
  })

  it('com HEAD solto não faz nada', () => {
    git(clone, 'checkout', '-q', '--detach')
    escrever(clone, 'a.txt', 'a\n')
    const antes = git(clone, 'rev-parse', 'HEAD')
    rodar(clone)
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(antes)
  })

  it.each([
    ['MERGE_HEAD', 'file'],
    ['CHERRY_PICK_HEAD', 'file'],
    ['rebase-merge', 'dir'],
    ['rebase-apply', 'dir'],
  ])('com %s em andamento não faz nada', (nome, tipo) => {
    const caminho = join(clone, '.git', nome)
    if (tipo === 'dir') mkdirSync(caminho)
    else writeFileSync(caminho, `${git(clone, 'rev-parse', 'HEAD')}\n`)
    escrever(clone, 'a.txt', 'a\n')
    const antes = git(clone, 'rev-parse', 'HEAD')
    rodar(clone)
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(antes)
  })

  it('sem remoto origin não faz nada', () => {
    git(clone, 'remote', 'remove', 'origin')
    escrever(clone, 'a.txt', 'a\n')
    rodar(clone)
    expect(contagem(clone)).toBe(1)
  })

  it('fora de um repositório git sai com 0 sem erro', () => {
    const solto = mkdtempSync(join(base, 'solto-'))
    rodar(solto)
    rodar(solto, '--limitado')
  })

  it('deixa de fora .env e arquivo de 6 MB, mas leva o resto', () => {
    escrever(clone, '.env', 'TOKEN=abc\n')
    escrever(clone, 'grande.bin', Buffer.alloc(6 * 1024 * 1024, 1))
    escrever(clone, 'util.ts', 'export {}\n')
    rodar(clone)

    expect(emCommit(clone)).toEqual(['util.ts'])
    const sobra = git(clone, 'status', '--porcelain')
    expect(sobra).toContain('.env')
    expect(sobra).toContain('grande.bin')
    expect(git(remoto, 'ls-tree', '-r', '--name-only', 'trabalho')).not.toMatch(/\.env|grande\.bin/)
    expect(readFileSync(join(clone, '.claude', 'autosave.log'), 'utf8')).toMatch(/\.env.*nome sensível/)
  })

  it.each([
    'cert.pem',
    'chave.key',
    'id_rsa',
    'id_rsa.pub',
    'meu-secret.json',
    'secrets/app.txt',
    'cert.p12',
    'aws-credentials',
    '.env.local',
    'sub/.env',
  ])('recusa o arquivo sensível %s', (nome) => {
    escrever(clone, nome, 'x\n')
    escrever(clone, 'ok.txt', 'ok\n')
    rodar(clone)
    expect(emCommit(clone)).toEqual(['ok.txt'])
  })

  it('só com arquivo sensível pendente não cria commit', () => {
    escrever(clone, '.env', 'TOKEN=abc\n')
    rodar(clone)
    expect(contagem(clone)).toBe(1)
  })

  it('não leva arquivo sensível que já estava no índice', () => {
    escrever(clone, 'id_rsa', 'x\n')
    escrever(clone, 'ok.txt', 'ok\n')
    git(clone, 'add', 'id_rsa')
    rodar(clone)
    expect(emCommit(clone)).toEqual(['ok.txt'])
  })

  it('respeita o .gitignore', () => {
    writeFileSync(join(clone, '.gitignore'), 'ignorado.txt\n')
    escrever(clone, 'ignorado.txt', 'x\n')
    rodar(clone)
    expect(emCommit(clone)).toEqual(['.gitignore'])
  })

  it('lista só 30 arquivos no corpo e resume o resto', () => {
    for (let i = 0; i < 35; i++) escrever(clone, `lote/f${String(i).padStart(2, '0')}.txt`, `${i}\n`)
    rodar(clone)
    expect(emCommit(clone)).toHaveLength(35)
    const corpo = git(clone, 'log', '-1', '--format=%b')
    expect(corpo).toContain('lote/f00.txt')
    expect(corpo).not.toContain('lote/f34.txt')
    expect(corpo).toContain('… e mais 5')
  })

  it('não cita Claude, Co-Authored nem Claude-Session na mensagem', () => {
    escrever(clone, 'a.txt', 'a\n')
    rodar(clone)
    const mensagem = git(clone, 'log', '-1', '--format=%B')
    expect(mensagem).not.toMatch(/claude/i)
    expect(mensagem).not.toMatch(/co-authored/i)
    expect(mensagem).not.toMatch(/claude-session/i)
  })

  describe('--limitado', () => {
    const carimbo = () => join(clone, '.claude', 'autosave.stamp')
    const gravarCarimbo = (segundosAtras: number) => {
      mkdirSync(join(clone, '.claude'), { recursive: true })
      writeFileSync(carimbo(), `${Math.floor(Date.now() / 1000) - segundosAtras}\n`)
    }

    it('com carimbo recente não faz nada', () => {
      gravarCarimbo(60)
      escrever(clone, 'a.txt', 'a\n')
      rodar(clone, '--limitado')
      expect(contagem(clone)).toBe(1)
    })

    it('com carimbo velho salva e renova o carimbo', () => {
      gravarCarimbo(700)
      escrever(clone, 'a.txt', 'a\n')
      rodar(clone, '--limitado')
      expect(contagem(clone)).toBe(2)
      expect(Math.floor(Date.now() / 1000) - Number(readFileSync(carimbo(), 'utf8'))).toBeLessThan(60)
    })

    it('sem mudança não renova o carimbo (só tentativa de salvar conta)', () => {
      gravarCarimbo(700)
      const antes = readFileSync(carimbo(), 'utf8')
      rodar(clone, '--limitado')
      expect(readFileSync(carimbo(), 'utf8')).toBe(antes)
    })

    it('sem a flag ignora o carimbo recente', () => {
      gravarCarimbo(5)
      escrever(clone, 'a.txt', 'a\n')
      rodar(clone)
      expect(contagem(clone)).toBe(2)
    })

    it('carimbo ilegível é tratado como ausente', () => {
      mkdirSync(join(clone, '.claude'), { recursive: true })
      writeFileSync(carimbo(), 'lixo\n')
      escrever(clone, 'a.txt', 'a\n')
      rodar(clone, '--limitado')
      expect(contagem(clone)).toBe(2)
    })
  })

  describe('trava de concorrência', () => {
    it('trava recente: não faz nada e não a remove', () => {
      const trava = join(clone, '.git', 'autosave.lock')
      mkdirSync(trava)
      escrever(clone, 'a.txt', 'a\n')
      rodar(clone)
      expect(contagem(clone)).toBe(1)
      expect(existsSync(trava)).toBe(true)
    })

    it('trava velha (processo morto) é reaproveitada e removida no fim', () => {
      const trava = join(clone, '.git', 'autosave.lock')
      mkdirSync(trava)
      const velho = new Date(Date.now() - 300_000)
      utimesSync(trava, velho, velho)
      escrever(clone, 'a.txt', 'a\n')
      rodar(clone)
      expect(contagem(clone)).toBe(2)
      expect(existsSync(trava)).toBe(false)
    })

    it('remove a trava depois de salvar', () => {
      escrever(clone, 'a.txt', 'a\n')
      rodar(clone)
      expect(existsSync(join(clone, '.git', 'autosave.lock'))).toBe(false)
    })
  })

  describe('remoto adiantado', () => {
    beforeEach(() => {
      git(base, 'clone', '-q', remoto, outro)
      configurar(outro)
      git(outro, 'checkout', '-q', 'trabalho')
    })

    it('rebase na ponta remota e push, sem perder nenhum dos dois', () => {
      escrever(outro, 'do-outro.txt', 'outro\n')
      git(outro, 'add', '-A')
      git(outro, 'commit', '-q', '-m', 'trabalho do outro')
      git(outro, 'push', '-q', 'origin', 'trabalho')

      escrever(clone, 'meu.txt', 'meu\n')
      rodar(clone)

      expect(assunto(clone)).toMatch(/^wip:/)
      expect(assunto(clone, 'HEAD~1')).toBe('trabalho do outro')
      expect(pontaRemota()).toBe(git(clone, 'rev-parse', 'HEAD'))
      expect(existsSync(join(clone, 'do-outro.txt'))).toBe(true)
      expect(git(remoto, 'ls-tree', '-r', '--name-only', 'trabalho').split('\n')).toEqual(
        expect.arrayContaining(['do-outro.txt', 'meu.txt']),
      )
      expect(pendente(clone)).toBe('')
    })

    it('com conflito mantém o commit local, aborta o rebase e deixa a árvore limpa', () => {
      escrever(outro, 'README.md', 'versão do outro\n')
      git(outro, 'add', '-A')
      git(outro, 'commit', '-q', '-m', 'outro mexeu no README')
      git(outro, 'push', '-q', 'origin', 'trabalho')
      const remotoAntes = pontaRemota()

      escrever(clone, 'README.md', 'minha versão\n')
      rodar(clone)

      expect(assunto(clone)).toMatch(/^wip:/)
      expect(pontaRemota()).toBe(remotoAntes)
      expect(existsSync(join(clone, '.git', 'rebase-merge'))).toBe(false)
      expect(existsSync(join(clone, '.git', 'rebase-apply'))).toBe(false)
      expect(git(clone, 'branch', '--show-current')).toBe('trabalho')
      expect(pendente(clone)).toBe('')
      expect(readFileSync(join(clone, 'README.md'), 'utf8')).toBe('minha versão\n')
      expect(readFileSync(join(clone, '.claude', 'autosave.log'), 'utf8')).toContain(
        'conflito: commit wip mantido local',
      )
    })
  })

  it('o log não passa de ~200 linhas', () => {
    mkdirSync(join(clone, '.claude'), { recursive: true })
    writeFileSync(join(clone, '.claude', 'autosave.log'), 'linha antiga\n'.repeat(250))
    // Um arquivo sensível faz o script registrar um aviso, o que dispara a aparagem do log.
    escrever(clone, '.env', 'x\n')
    rodar(clone)
    const linhas = readFileSync(join(clone, '.claude', 'autosave.log'), 'utf8').trim().split('\n')
    expect(linhas.length).toBeLessThanOrEqual(200)
    // O aviso novo entrou e as linhas mais antigas saíram.
    expect(linhas.join('\n')).toContain('.env')
    expect(linhas.filter((l) => l === 'linha antiga')).toHaveLength(linhas.length - 2)
  })
})
