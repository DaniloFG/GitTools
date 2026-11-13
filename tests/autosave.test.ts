import { spawn } from 'node:child_process'
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

interface Resultado {
  status: number | null
  stdout: string
  stderr: string
}

// Roda um processo sem bloquear o worker do vitest. O spawn síncrono segura o laço de eventos enquanto git e bash
// rodam; no Git Bash do Windows isso passa de 60 s e o RPC onTaskUpdate do vitest estoura. Nunca rejeita: falha de
// spawn (binário ausente) devolve status null, como o spawn síncrono devolvia.
function executar(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {},
): Promise<Resultado> {
  return new Promise((resolve) => {
    const filho = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'] })
    const saida: Buffer[] = []
    const erros: Buffer[] = []
    filho.stdout.on('data', (parte: Buffer) => saida.push(parte))
    filho.stderr.on('data', (parte: Buffer) => erros.push(parte))
    // EPIPE no stdin é normal quando o processo sai antes de ler a entrada (ou nem começa): não pode virar erro não
    // tratado no worker.
    filho.stdin.on('error', () => {})
    filho.on('error', () => resolve({ status: null, stdout: '', stderr: '' }))
    filho.on('close', (status) =>
      resolve({
        status,
        stdout: Buffer.concat(saida).toString('utf8'),
        stderr: Buffer.concat(erros).toString('utf8'),
      }),
    )
    // Fecha o stdin: o spawn síncrono fazia isso sozinho; sem o fim, git ou bash podem ficar esperando entrada.
    filho.stdin.end(opts.input)
  })
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const r = await executar('git', args, { cwd, env: ambienteGit })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} falhou: ${r.stderr}`)
  return r.stdout.trim()
}

async function configurar(dir: string): Promise<void> {
  await git(dir, 'config', 'user.name', 'Teste')
  await git(dir, 'config', 'user.email', 'teste@example.com')
  await git(dir, 'config', 'commit.gpgsign', 'false')
}

async function rodar(projeto: string, ...args: string[]): Promise<Resultado> {
  return rodarEm(projeto, undefined, {}, ...args)
}

// `cwd` é o diretório da sessão (o do hook de verdade); `projeto` vira CLAUDE_PROJECT_DIR.
async function rodarEm(
  projeto: string,
  cwd: string | undefined,
  extra: NodeJS.ProcessEnv = {},
  ...args: string[]
): Promise<Resultado> {
  const r = await executar('bash', [script, ...args], {
    cwd,
    env: { ...ambienteGit, CLAUDE_PROJECT_DIR: projeto, ...extra },
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

const assunto = async (dir: string, ref = 'HEAD') => git(dir, 'log', '-1', '--format=%s', ref)
const contagem = async (dir: string, ref = 'HEAD') => Number(await git(dir, 'rev-list', '--count', ref))
const emCommit = async (dir: string) =>
  (await git(dir, 'show', '--name-only', '--format=', 'HEAD')).split('\n').filter(Boolean)
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
beforeEach(async () => {
  const pasta = mkdtempSync(join(base, 'caso-'))
  remoto = join(pasta, 'remoto.git')
  clone = join(pasta, 'clone')
  outro = join(pasta, 'outro')
  await git(pasta, 'init', '-q', '--bare', remoto)
  await git(pasta, 'clone', '-q', remoto, clone)
  await configurar(clone)
  await git(clone, 'checkout', '-q', '-b', 'trabalho')
  escrever(clone, 'README.md', 'linha\n')
  await git(clone, 'add', '-A')
  await git(clone, 'commit', '-q', '-m', 'inicial')
  await git(clone, 'push', '-q', '-u', 'origin', 'trabalho')
})

// Sequencial de propósito: os testes compartilham o clone e o remoto criados acima.
describe('autosave.sh', () => {
  it('com mudança commita com wip: e o remoto recebe', async () => {
    escrever(clone, 'src/novo.ts', 'export {}\n')
    escrever(clone, 'README.md', 'linha alterada\n')
    await rodar(clone)

    expect(await assunto(clone)).toMatch(/^wip: salvamento automático \(\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\)$/)
    expect(await contagem(clone)).toBe(2)
    expect(await pontaRemota()).toBe(await git(clone, 'rev-parse', 'HEAD'))
    expect(await pendente(clone)).toBe('')

    const corpo = await git(clone, 'log', '-1', '--format=%b')
    expect(corpo).toContain('Último commit antes:')
    expect(corpo).toContain('inicial')
    expect(corpo).toContain('Branch: trabalho')
    expect(corpo).toContain('src/novo.ts')
    expect(corpo).toContain('README.md')
  })

  describe('worktree por issue (#200)', () => {
    let arvore = ''
    beforeEach(async () => {
      arvore = join(clone, '.claude', 'worktrees', 'issue-7')
      await git(clone, 'worktree', 'add', '-q', '-b', 'fix/7-assunto', arvore, 'trabalho')
      await git(clone, 'push', '-q', '-u', 'origin', 'fix/7-assunto')
    })

    it('pendência no worktree vira wip: na branch dele, e a raiz fica intocada', async () => {
      escrever(arvore, 'src/novo.ts', 'export {}\n')
      escrever(clone, 'raiz.txt', 'pendente na raiz\n')
      const pontaRaiz = await git(clone, 'rev-parse', 'HEAD')
      const r = await rodarEm(clone, arvore, { AUTOSAVE_DEBUG: '1' })
      // Na falha, mostra o que o hook viu (stderr e autosave.log da raiz e do worktree): no CI do Windows é a única pista.
      const logs = [clone, arvore]
        .map((d) => {
          const f = join(d, '.claude', 'autosave.log')
          return `${f}: ${existsSync(f) ? readFileSync(f, 'utf8') : '(sem log)'}`
        })
        .join('\n')

      expect(await assunto(arvore), `stderr do hook: ${r.stderr}\n${logs}`).toMatch(/^wip: salvamento automático/)
      expect(await git(arvore, 'show', '--name-only', '--format=', 'HEAD')).toContain('src/novo.ts')
      expect(await git(remoto, 'rev-parse', 'fix/7-assunto')).toBe(await git(arvore, 'rev-parse', 'HEAD'))
      expect(await git(clone, 'rev-parse', 'HEAD')).toBe(pontaRaiz)
      expect(await pendente(clone)).toContain('raiz.txt')
      expect(existsSync(join(clone, '.claude', 'autosave.stamp'))).toBe(false)
      expect(existsSync(join(arvore, '.claude', 'autosave.stamp'))).toBe(true)
    })

    it('com a sessão na raiz, não salva o que está só no worktree', async () => {
      escrever(arvore, 'so-no-worktree.ts', 'x\n')
      await rodarEm(clone, clone)
      expect(await contagem(arvore)).toBe(1)
    })
  })

  it('sem mudança não cria commit', async () => {
    const antes = await git(clone, 'rev-parse', 'HEAD')
    await rodar(clone)
    expect(await git(clone, 'rev-parse', 'HEAD')).toBe(antes)
    expect(await contagem(clone)).toBe(1)
  })

  it('o próprio carimbo e o log do autosave não contam como mudança', async () => {
    escrever(clone, 'a.txt', 'a\n')
    await rodar(clone, '--limitado')
    expect(existsSync(join(clone, '.claude', 'autosave.stamp'))).toBe(true)
    expect(await contagem(clone)).toBe(2)
    escrever(clone, '.claude/autosave.log', 'x\n')
    await rodar(clone)
    expect(await contagem(clone)).toBe(2)
    expect(await emCommit(clone)).not.toContain('.claude/autosave.stamp')
  })

  it.each(['develop', 'homolog', 'main'])('na branch %s não faz nada', async (nome) => {
    await git(clone, 'checkout', '-q', '-b', nome)
    escrever(clone, 'a.txt', 'a\n')
    const antes = await git(clone, 'rev-parse', 'HEAD')
    await rodar(clone)
    expect(await git(clone, 'rev-parse', 'HEAD')).toBe(antes)
    expect(await git(clone, 'status', '--porcelain')).toContain('a.txt')
  })

  it('com HEAD solto não faz nada', async () => {
    await git(clone, 'checkout', '-q', '--detach')
    escrever(clone, 'a.txt', 'a\n')
    const antes = await git(clone, 'rev-parse', 'HEAD')
    await rodar(clone)
    expect(await git(clone, 'rev-parse', 'HEAD')).toBe(antes)
  })

  it.each([
    ['MERGE_HEAD', 'file'],
    ['CHERRY_PICK_HEAD', 'file'],
    ['rebase-merge', 'dir'],
    ['rebase-apply', 'dir'],
  ])('com %s em andamento não faz nada', async (nome, tipo) => {
    const caminho = join(clone, '.git', nome)
    if (tipo === 'dir') mkdirSync(caminho)
    else writeFileSync(caminho, `${await git(clone, 'rev-parse', 'HEAD')}\n`)
    escrever(clone, 'a.txt', 'a\n')
    const antes = await git(clone, 'rev-parse', 'HEAD')
    await rodar(clone)
    expect(await git(clone, 'rev-parse', 'HEAD')).toBe(antes)
  })

  it('sem remoto origin não faz nada', async () => {
    await git(clone, 'remote', 'remove', 'origin')
    escrever(clone, 'a.txt', 'a\n')
    await rodar(clone)
    expect(await contagem(clone)).toBe(1)
  })

  it('fora de um repositório git sai com 0 sem erro', async () => {
    const solto = mkdtempSync(join(base, 'solto-'))
    await rodar(solto)
    await rodar(solto, '--limitado')
  })

  it('deixa de fora .env e arquivo de 6 MB, mas leva o resto', async () => {
    escrever(clone, '.env', 'TOKEN=abc\n')
    escrever(clone, 'grande.bin', Buffer.alloc(6 * 1024 * 1024, 1))
    escrever(clone, 'util.ts', 'export {}\n')
    await rodar(clone)

    expect(await emCommit(clone)).toEqual(['util.ts'])
    const sobra = await git(clone, 'status', '--porcelain')
    expect(sobra).toContain('.env')
    expect(sobra).toContain('grande.bin')
    expect(await git(remoto, 'ls-tree', '-r', '--name-only', 'trabalho')).not.toMatch(/\.env|grande\.bin/)
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
  ])('recusa o arquivo sensível %s', async (nome) => {
    escrever(clone, nome, 'x\n')
    escrever(clone, 'ok.txt', 'ok\n')
    await rodar(clone)
    expect(await emCommit(clone)).toEqual(['ok.txt'])
  })

  it('só com arquivo sensível pendente não cria commit', async () => {
    escrever(clone, '.env', 'TOKEN=abc\n')
    await rodar(clone)
    expect(await contagem(clone)).toBe(1)
  })

  it('não leva arquivo sensível que já estava no índice', async () => {
    escrever(clone, 'id_rsa', 'x\n')
    escrever(clone, 'ok.txt', 'ok\n')
    await git(clone, 'add', 'id_rsa')
    await rodar(clone)
    expect(await emCommit(clone)).toEqual(['ok.txt'])
  })

  it('respeita o .gitignore', async () => {
    writeFileSync(join(clone, '.gitignore'), 'ignorado.txt\n')
    escrever(clone, 'ignorado.txt', 'x\n')
    await rodar(clone)
    expect(await emCommit(clone)).toEqual(['.gitignore'])
  })

  it('lista só 30 arquivos no corpo e resume o resto', async () => {
    for (let i = 0; i < 35; i++) escrever(clone, `lote/f${String(i).padStart(2, '0')}.txt`, `${i}\n`)
    await rodar(clone)
    expect(await emCommit(clone)).toHaveLength(35)
    const corpo = await git(clone, 'log', '-1', '--format=%b')
    expect(corpo).toContain('lote/f00.txt')
    expect(corpo).not.toContain('lote/f34.txt')
    expect(corpo).toContain('… e mais 5')
  })

  it('não cita Claude, Co-Authored nem Claude-Session na mensagem', async () => {
    escrever(clone, 'a.txt', 'a\n')
    await rodar(clone)
    const mensagem = await git(clone, 'log', '-1', '--format=%B')
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

    it('com carimbo recente não faz nada', async () => {
      gravarCarimbo(60)
      escrever(clone, 'a.txt', 'a\n')
      await rodar(clone, '--limitado')
      expect(await contagem(clone)).toBe(1)
    })

    it('com carimbo velho salva e renova o carimbo', async () => {
      gravarCarimbo(700)
      escrever(clone, 'a.txt', 'a\n')
      await rodar(clone, '--limitado')
      expect(await contagem(clone)).toBe(2)
      expect(Math.floor(Date.now() / 1000) - Number(readFileSync(carimbo(), 'utf8'))).toBeLessThan(60)
    })

    it('sem mudança não renova o carimbo (só tentativa de salvar conta)', async () => {
      gravarCarimbo(700)
      const antes = readFileSync(carimbo(), 'utf8')
      await rodar(clone, '--limitado')
      expect(readFileSync(carimbo(), 'utf8')).toBe(antes)
    })

    it('sem a flag ignora o carimbo recente', async () => {
      gravarCarimbo(5)
      escrever(clone, 'a.txt', 'a\n')
      await rodar(clone)
      expect(await contagem(clone)).toBe(2)
    })

    it('carimbo ilegível é tratado como ausente', async () => {
      mkdirSync(join(clone, '.claude'), { recursive: true })
      writeFileSync(carimbo(), 'lixo\n')
      escrever(clone, 'a.txt', 'a\n')
      await rodar(clone, '--limitado')
      expect(await contagem(clone)).toBe(2)
    })
  })

  describe('trava de concorrência', () => {
    it('trava recente: não faz nada e não a remove', async () => {
      const trava = join(clone, '.git', 'autosave.lock')
      mkdirSync(trava)
      escrever(clone, 'a.txt', 'a\n')
      await rodar(clone)
      expect(await contagem(clone)).toBe(1)
      expect(existsSync(trava)).toBe(true)
    })

    it('trava velha (processo morto) é reaproveitada e removida no fim', async () => {
      const trava = join(clone, '.git', 'autosave.lock')
      mkdirSync(trava)
      const velho = new Date(Date.now() - 300_000)
      utimesSync(trava, velho, velho)
      escrever(clone, 'a.txt', 'a\n')
      await rodar(clone)
      expect(await contagem(clone)).toBe(2)
      expect(existsSync(trava)).toBe(false)
    })

    it('remove a trava depois de salvar', async () => {
      escrever(clone, 'a.txt', 'a\n')
      await rodar(clone)
      expect(existsSync(join(clone, '.git', 'autosave.lock'))).toBe(false)
    })
  })

  describe('remoto adiantado', () => {
    beforeEach(async () => {
      await git(base, 'clone', '-q', remoto, outro)
      await configurar(outro)
      await git(outro, 'checkout', '-q', 'trabalho')
    })

    it('rebase na ponta remota e push, sem perder nenhum dos dois', async () => {
      escrever(outro, 'do-outro.txt', 'outro\n')
      await git(outro, 'add', '-A')
      await git(outro, 'commit', '-q', '-m', 'trabalho do outro')
      await git(outro, 'push', '-q', 'origin', 'trabalho')

      escrever(clone, 'meu.txt', 'meu\n')
      await rodar(clone)

      expect(await assunto(clone)).toMatch(/^wip:/)
      expect(await assunto(clone, 'HEAD~1')).toBe('trabalho do outro')
      expect(await pontaRemota()).toBe(await git(clone, 'rev-parse', 'HEAD'))
      expect(existsSync(join(clone, 'do-outro.txt'))).toBe(true)
      expect((await git(remoto, 'ls-tree', '-r', '--name-only', 'trabalho')).split('\n')).toEqual(
        expect.arrayContaining(['do-outro.txt', 'meu.txt']),
      )
      expect(await pendente(clone)).toBe('')
    })

    it('com conflito mantém o commit local, aborta o rebase e deixa a árvore limpa', async () => {
      escrever(outro, 'README.md', 'versão do outro\n')
      await git(outro, 'add', '-A')
      await git(outro, 'commit', '-q', '-m', 'outro mexeu no README')
      await git(outro, 'push', '-q', 'origin', 'trabalho')
      const remotoAntes = await pontaRemota()

      escrever(clone, 'README.md', 'minha versão\n')
      await rodar(clone)

      expect(await assunto(clone)).toMatch(/^wip:/)
      expect(await pontaRemota()).toBe(remotoAntes)
      expect(existsSync(join(clone, '.git', 'rebase-merge'))).toBe(false)
      expect(existsSync(join(clone, '.git', 'rebase-apply'))).toBe(false)
      expect(await git(clone, 'branch', '--show-current')).toBe('trabalho')
      expect(await pendente(clone)).toBe('')
      expect(readFileSync(join(clone, 'README.md'), 'utf8')).toBe('minha versão\n')
      expect(readFileSync(join(clone, '.claude', 'autosave.log'), 'utf8')).toContain(
        'conflito: commit wip mantido local',
      )
    })
  })

  it('o log não passa de ~200 linhas', async () => {
    mkdirSync(join(clone, '.claude'), { recursive: true })
    writeFileSync(join(clone, '.claude', 'autosave.log'), 'linha antiga\n'.repeat(250))
    // Um arquivo sensível faz o script registrar um aviso, o que dispara a aparagem do log.
    escrever(clone, '.env', 'x\n')
    await rodar(clone)
    const linhas = readFileSync(join(clone, '.claude', 'autosave.log'), 'utf8').trim().split('\n')
    expect(linhas.length).toBeLessThanOrEqual(200)
    // O aviso novo entrou e as linhas mais antigas saíram.
    expect(linhas.join('\n')).toContain('.env')
    expect(linhas.filter((l) => l === 'linha antiga')).toHaveLength(linhas.length - 2)
  })
})
