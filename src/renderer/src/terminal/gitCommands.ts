// Catálogo dos comandos git do terminal: subcomandos, opções e o que cada um faz. As descrições
// estão em pt-BR e en (os demais idiomas usam en). Usado pela sugestão (Tab), pela ajuda e pelo `help`.

/** Texto nos dois idiomas do catálogo. */
export interface GitText {
  'pt-BR': string
  en: string
}

/**
 * Opção ou ação. `name` pode trazer aliases separados por vírgula ("-s, --short"); qualquer um deles
 * casa com o que foi digitado. `value` indica que a opção recebe um valor (ex.: -m <mensagem>).
 */
export interface GitFlag {
  name: string
  text: GitText
  value?: boolean
}

/** O que vem depois do subcomando: refs (branches e tags), remote, remote e ref, arquivos ou nada. */
export type GitArgKind = 'none' | 'ref' | 'remote-ref' | 'remote' | 'path'

export interface GitCommandSpec {
  name: string
  text: GitText
  syntax: string
  examples: string[]
  flags: GitFlag[]
  args: GitArgKind
  /** Ações do subcomando (ex.: stash push/pop, remote add/remove). Vêm antes dos argumentos. */
  ops?: GitFlag[]
  /** Só lê o repositório: a interface não precisa se atualizar depois. */
  readOnly?: boolean
}

/** Comandos locais do terminal (não são do git). */
export const LOCAL_COMMANDS: GitFlag[] = [
  { name: 'help', text: { 'pt-BR': 'Mostra a lista de comandos ou a ajuda de um deles', en: 'Shows the command list or the help of one of them' } },
  { name: 'clear', text: { 'pt-BR': 'Limpa a saída do terminal', en: 'Clears the terminal output' } }
]

/** Texto no idioma atual (pt-BR quando existe; en nos demais). */
export function pickText(text: GitText, locale: string): string {
  return locale === 'pt-BR' ? text['pt-BR'] : text.en
}

/** Os nomes de uma opção ("-s, --short" → ["-s", "--short"]). */
export function flagNames(flag: GitFlag): string[] {
  return flag.name.split(',').map((n) => n.trim())
}

const txt = (pt: string, en: string): GitText => ({ 'pt-BR': pt, en })
const f = (name: string, pt: string, en: string, value = false): GitFlag => ({ name, text: txt(pt, en), value })

function cmd(
  name: string,
  pt: string,
  en: string,
  syntax: string,
  examples: string[],
  flags: GitFlag[],
  options: { args?: GitArgKind; ops?: GitFlag[]; readOnly?: boolean } = {}
): GitCommandSpec {
  return { name, text: txt(pt, en), syntax, examples, flags, args: options.args ?? 'none', ops: options.ops, readOnly: options.readOnly }
}

export const GIT_COMMANDS: GitCommandSpec[] = [
  cmd('add', 'Prepara arquivos para o próximo commit', 'Stages files for the next commit', 'git add [-A] [-u] <caminho>…', ['git add arquivo.ts', 'git add -A'], [
    f('-A, --all', 'Prepara todas as mudanças (novas, alteradas e apagadas)', 'Stages all changes (new, modified and deleted)'),
    f('-u, --update', 'Prepara só os arquivos que já são rastreados', 'Stages only files that are already tracked'),
    f('-f, --force', 'Adiciona também arquivos ignorados', 'Also adds ignored files'),
    f('-n, --dry-run', 'Mostra o que seria adicionado, sem adicionar', 'Shows what would be added, without adding'),
    f('-N, --intent-to-add', 'Marca arquivos novos sem preparar o conteúdo', 'Marks new files without staging their content')
  ], { args: 'path' }),
  cmd('bisect', 'Busca binária do commit que introduziu um erro', 'Binary search for the commit that introduced a bug', 'git bisect start | bad | good [<commit>] | reset', ['git bisect start', 'git bisect bad', 'git bisect good v1.0', 'git bisect reset'], [], {
    args: 'ref',
    ops: [
      f('start', 'Inicia a busca', 'Starts the search'),
      f('bad', 'Marca o commit (atual ou indicado) como ruim', 'Marks the commit (current or given) as bad'),
      f('good', 'Marca o commit (atual ou indicado) como bom', 'Marks the commit (current or given) as good'),
      f('skip', 'Pula o commit atual', 'Skips the current commit'),
      f('reset', 'Volta ao estado de antes da busca', 'Returns to the state from before the search'),
      f('log', 'Mostra o histórico da busca', 'Shows the search history'),
      f('run', 'Roda um comando em cada passo (é um comando de shell)', 'Runs a command at each step (it is a shell command)'),
      f('visualize', 'Mostra os commits que ainda faltam testar', 'Shows the commits still left to test')
    ]
  }),
  cmd('blame', 'Mostra quem alterou cada linha de um arquivo', 'Shows who changed each line of a file', 'git blame [-L <início>,<fim>] <arquivo>', ['git blame src/app.ts', 'git blame -L 10,20 src/app.ts'], [
    f('-L', 'Só as linhas do intervalo informado', 'Only the lines in the given range', true),
    f('-w', 'Ignora diferenças de espaços em branco', 'Ignores whitespace differences'),
    f('-C', 'Detecta linhas copiadas de outros arquivos', 'Detects lines copied from other files'),
    f('-M', 'Detecta linhas movidas dentro do mesmo arquivo', 'Detects lines moved within the same file')
  ], { args: 'path', readOnly: true }),
  cmd('branch', 'Lista, cria, renomeia ou apaga branches', 'Lists, creates, renames or deletes branches', 'git branch [-a|-r] [-v] [-d|-D] [-m] [<nome>] [<início>]', ['git branch', 'git branch feature/x', 'git branch -d feature/x'], [
    f('-a, --all', 'Lista branches locais e remotas', 'Lists local and remote branches'),
    f('-r, --remotes', 'Lista só as branches remotas', 'Lists only remote branches'),
    f('-v, --verbose', 'Mostra o último commit de cada branch', 'Shows the last commit of each branch'),
    f('-d, --delete', 'Apaga uma branch já mesclada', 'Deletes a branch that is already merged'),
    f('-D', 'Apaga uma branch mesmo sem estar mesclada', 'Deletes a branch even if it is not merged'),
    f('-m, --move', 'Renomeia uma branch', 'Renames a branch'),
    f('-M', 'Renomeia mesmo que o nome de destino já exista', 'Renames even if the target name already exists'),
    f('--show-current', 'Mostra só o nome da branch atual', 'Shows only the current branch name'),
    f('-u, --set-upstream-to', 'Define a branch remota que a branch acompanha', 'Sets the remote branch to track', true),
    f('--merged', 'Lista as branches já mescladas em um commit', 'Lists branches already merged into a commit', true),
    f('--no-merged', 'Lista as branches ainda não mescladas', 'Lists branches not merged yet')
  ], { args: 'ref' }),
  cmd('checkout', 'Troca de branch ou restaura arquivos (modo antigo)', 'Switches branches or restores files (older mode)', 'git checkout [-b <nova>] <branch|commit> [--] [<arquivo>…]', ['git checkout main', 'git checkout -b feature/x', 'git checkout -- arquivo.ts'], [
    f('-b', 'Cria uma branch nova e muda para ela', 'Creates a new branch and switches to it', true),
    f('-B', 'Cria ou redefine uma branch e muda para ela', 'Creates or resets a branch and switches to it', true),
    f('--detach', 'Vai para um commit sem branch (HEAD solto)', 'Goes to a commit without a branch (detached HEAD)'),
    f('-f, --force', 'Troca de branch mesmo descartando mudanças locais', 'Switches even if it discards local changes'),
    f('-t, --track', 'Cria a branch acompanhando a branch remota', 'Creates the branch tracking the remote branch'),
    f('--orphan', 'Cria uma branch sem histórico', 'Creates a branch with no history', true)
  ], { args: 'ref' }),
  cmd('cherry-pick', 'Aplica o commit de outra branch na atual', 'Applies a commit from another branch to the current one', 'git cherry-pick [-n] [-x] <commit>…', ['git cherry-pick abc1234', 'git cherry-pick --abort'], [
    f('-n, --no-commit', 'Aplica as mudanças sem criar o commit', 'Applies the changes without creating the commit'),
    f('-x', 'Acrescenta à mensagem a origem do commit', 'Appends the origin of the commit to the message'),
    f('-m, --mainline', 'Escolhe o pai a considerar num commit de merge', 'Picks the parent to use for a merge commit', true),
    f('--continue', 'Continua depois de resolver os conflitos', 'Continues after resolving conflicts'),
    f('--skip', 'Pula o commit que deu conflito', 'Skips the commit that conflicted'),
    f('--abort', 'Cancela e volta ao estado anterior', 'Cancels and returns to the previous state')
  ], { args: 'ref' }),
  cmd('clean', 'Apaga arquivos que não são rastreados', 'Deletes untracked files', 'git clean -n | -f [-d] [-x]', ['git clean -n', 'git clean -fd'], [
    f('-n, --dry-run', 'Só mostra o que seria apagado', 'Only shows what would be deleted'),
    f('-f, --force', 'Apaga de verdade (obrigatório, junto com -n ou não)', 'Really deletes (required, unless using -n)'),
    f('-d', 'Inclui diretórios não rastreados', 'Includes untracked directories'),
    f('-x', 'Inclui também os arquivos ignorados', 'Also includes ignored files')
  ], { args: 'path' }),
  cmd('commit', 'Grava as mudanças preparadas como um commit', 'Records the staged changes as a commit', 'git commit -m "<mensagem>" [-a] [--amend] [--no-edit]', ['git commit -m "Corrige o login"', 'git commit -am "Ajusta o texto"', 'git commit --amend --no-edit'], [
    f('-m, --message', 'Mensagem do commit (sem ela, abriria um editor)', 'Commit message (without it, an editor would open)', true),
    f('-a, --all', 'Inclui as alterações de arquivos já rastreados', 'Includes changes to already tracked files'),
    f('--amend', 'Refaz o último commit', 'Redoes the last commit'),
    f('--no-edit', 'Mantém a mensagem atual (com --amend)', 'Keeps the current message (with --amend)'),
    f('-F, --file', 'Lê a mensagem de um arquivo', 'Reads the message from a file', true),
    f('--allow-empty', 'Permite um commit sem alterações', 'Allows a commit without changes'),
    f('-s, --signoff', 'Acrescenta a linha Signed-off-by', 'Adds a Signed-off-by line'),
    f('--fixup', 'Cria um commit de correção para outro commit', 'Creates a fixup commit for another commit', true)
  ], { args: 'path' }),
  cmd('config', 'Lê ou grava opções de configuração', 'Reads or writes configuration options', 'git config [--global|--local] <chave> [<valor>]', ['git config user.name "Seu Nome"', 'git config --get core.autocrlf', 'git config --list --show-origin'], [
    f('--global', 'Grava em ~/.gitconfig (vale para todos os repositórios)', 'Writes to ~/.gitconfig (applies to all repositories)'),
    f('--local', 'Grava só neste repositório', 'Writes only to this repository'),
    f('-l, --list', 'Lista todas as opções', 'Lists all options'),
    f('--get', 'Mostra o valor de uma chave', 'Shows the value of a key', true),
    f('--unset', 'Remove uma chave', 'Removes a key', true),
    f('--show-origin', 'Mostra de qual arquivo vem cada opção', 'Shows which file each option comes from')
  ], { readOnly: false }),
  cmd('describe', 'Dá um nome legível a um commit (a tag mais próxima)', 'Gives a readable name to a commit (the nearest tag)', 'git describe [--tags] [--always] [<commit>]', ['git describe', 'git describe --tags --always'], [
    f('--tags', 'Considera também as tags leves', 'Also considers lightweight tags'),
    f('--always', 'Usa o hash quando não há tag', 'Uses the hash when there is no tag'),
    f('--long', 'Mostra sempre a tag, a distância e o hash', 'Always shows the tag, the distance and the hash'),
    f('--dirty', 'Marca quando há mudanças não commitadas', 'Marks when there are uncommitted changes'),
    f('--abbrev', 'Tamanho do hash abreviado', 'Length of the abbreviated hash', true)
  ], { args: 'ref', readOnly: true }),
  cmd('diff', 'Mostra as diferenças entre arquivos, commits ou a área de stage', 'Shows differences between files, commits or the staging area', 'git diff [--staged] [<commit>] [--] [<caminho>]', ['git diff', 'git diff --staged', 'git diff main...feature'], [
    f('--staged, --cached', 'Compara o que está preparado com o último commit', 'Compares what is staged with the last commit'),
    f('--stat', 'Resumo: arquivos e linhas alterados', 'Summary: changed files and lines'),
    f('--name-only', 'Só os nomes dos arquivos', 'Only the file names'),
    f('--name-status', 'Nomes e tipo da mudança (M, A, D…)', 'Names and change type (M, A, D…)'),
    f('-w, --ignore-all-space', 'Ignora diferenças de espaços', 'Ignores whitespace differences'),
    f('--word-diff', 'Mostra as diferenças palavra por palavra', 'Shows differences word by word'),
    f('-U', 'Quantas linhas de contexto mostrar', 'How many context lines to show', true)
  ], { args: 'ref', readOnly: true }),
  cmd('fetch', 'Baixa commits e branches do remoto, sem mudar o seu trabalho', 'Downloads commits and branches from the remote, without changing your work', 'git fetch [--all] [--prune] [<remote>]', ['git fetch', 'git fetch --all --prune'], [
    f('--all', 'Busca de todos os remotes', 'Fetches from all remotes'),
    f('-p, --prune', 'Remove as branches remotas que sumiram do servidor', 'Removes remote branches that were deleted on the server'),
    f('-t, --tags', 'Baixa todas as tags', 'Downloads all tags'),
    f('--depth', 'Baixa só os últimos N commits (repositório raso)', 'Downloads only the last N commits (shallow repository)', true),
    f('--dry-run', 'Mostra o que seria baixado', 'Shows what would be downloaded')
  ], { args: 'remote-ref' }),
  cmd('fsck', 'Verifica a integridade do banco de objetos', 'Checks the integrity of the object database', 'git fsck [--full] [--lost-found]', ['git fsck', 'git fsck --full'], [
    f('--full', 'Verificação completa (todos os objetos)', 'Full check (all objects)'),
    f('--unreachable', 'Lista objetos sem nenhuma referência', 'Lists objects with no reference'),
    f('--lost-found', 'Grava objetos perdidos em .git/lost-found', 'Writes lost objects to .git/lost-found'),
    f('--no-dangling', 'Não mostra objetos soltos', 'Does not show dangling objects')
  ], { readOnly: true }),
  cmd('gc', 'Limpa e compacta o repositório', 'Cleans up and compacts the repository', 'git gc [--aggressive] [--prune=now]', ['git gc', 'git gc --aggressive'], [
    f('--aggressive', 'Compacta mais (é mais lento)', 'Compacts more (slower)'),
    f('--prune', 'Apaga objetos soltos antigos (ex.: now)', 'Deletes old dangling objects (e.g. now)', true),
    f('--auto', 'Só limpa se for necessário', 'Only cleans up if needed')
  ]),
  cmd('grep', 'Procura um texto nos arquivos rastreados', 'Searches for text in tracked files', 'git grep [-i] [-n] <padrão> [<caminho>]', ['git grep TODO', 'git grep -n "function login"'], [
    f('-i, --ignore-case', 'Ignora maiúsculas e minúsculas', 'Ignores case'),
    f('-n, --line-number', 'Mostra o número da linha', 'Shows the line number'),
    f('-w, --word-regexp', 'Só palavras inteiras', 'Only whole words'),
    f('-l, --files-with-matches', 'Só os nomes dos arquivos', 'Only the file names'),
    f('-c, --count', 'Quantas ocorrências em cada arquivo', 'How many matches in each file'),
    f('--cached', 'Procura no índice, não na pasta de trabalho', 'Searches the index instead of the working tree')
  ], { args: 'path', readOnly: true }),
  cmd('log', 'Mostra o histórico de commits', 'Shows the commit history', 'git log [--oneline] [--graph] [--all] [<ref>|<intervalo>] [-- <caminho>]', ['git log --oneline --graph --all', 'git log -n 10 --stat', 'git log main..feature'], [
    f('--oneline', 'Um commit por linha', 'One commit per line'),
    f('--graph', 'Desenha as ramificações', 'Draws the branches'),
    f('--all', 'Mostra todas as branches e tags', 'Shows all branches and tags'),
    f('-n', 'Limita a quantidade de commits', 'Limits the number of commits', true),
    f('--stat', 'Arquivos e linhas alterados em cada commit', 'Files and lines changed in each commit'),
    f('-p, --patch', 'Mostra o diff de cada commit', 'Shows the diff of each commit'),
    f('--author', 'Só os commits de um autor', 'Only commits by an author', true),
    f('--since', 'Commits desde uma data (ex.: "2 weeks ago")', 'Commits since a date (e.g. "2 weeks ago")', true),
    f('--grep', 'Commits cuja mensagem contém o texto', 'Commits whose message contains the text', true),
    f('--first-parent', 'Segue só o primeiro pai (ignora as branches mescladas)', 'Follows only the first parent (ignores merged branches)'),
    f('--no-merges', 'Esconde os commits de merge', 'Hides merge commits'),
    f('--follow', 'Segue um arquivo mesmo depois de renomeado', 'Follows a file even after it was renamed'),
    f('--format', 'Formato personalizado (ex.: %h %s)', 'Custom format (e.g. %h %s)', true)
  ], { args: 'ref', readOnly: true }),
  cmd('ls-files', 'Lista arquivos do índice, não rastreados, modificados ou apagados', 'Lists index files, untracked, modified or deleted files', 'git ls-files [-c|-o|-m|-d] [--stage]', ['git ls-files', 'git ls-files --others --exclude-standard'], [
    f('-c, --cached', 'Arquivos no índice (padrão)', 'Files in the index (default)'),
    f('-o, --others', 'Arquivos não rastreados', 'Untracked files'),
    f('-m, --modified', 'Arquivos modificados', 'Modified files'),
    f('-d, --deleted', 'Arquivos apagados do disco', 'Files deleted from disk'),
    f('-s, --stage', 'Modo, hash e estágio de cada arquivo', 'Mode, hash and stage of each file'),
    f('-u, --unmerged', 'Arquivos com conflito', 'Files with conflicts'),
    f('--exclude-standard', 'Aplica o .gitignore', 'Applies .gitignore')
  ], { args: 'path', readOnly: true }),
  cmd('merge', 'Junta outra branch na atual', 'Joins another branch into the current one', 'git merge [--no-ff] [--squash] <branch>', ['git merge feature/x', 'git merge --no-ff feature/x', 'git merge --abort'], [
    f('--no-ff', 'Sempre cria um commit de merge', 'Always creates a merge commit'),
    f('--ff-only', 'Só avança se for fast-forward', 'Only moves forward if it is a fast-forward'),
    f('--squash', 'Junta as mudanças sem criar o commit', 'Joins the changes without creating a commit'),
    f('--no-commit', 'Faz o merge mas não cria o commit', 'Merges but does not create the commit'),
    f('-m', 'Mensagem do commit de merge', 'Message of the merge commit', true),
    f('-s, --strategy', 'Estratégia de merge', 'Merge strategy', true),
    f('--continue', 'Continua depois de resolver os conflitos', 'Continues after resolving conflicts'),
    f('--abort', 'Cancela o merge em andamento', 'Cancels the merge in progress')
  ], { args: 'ref' }),
  cmd('mv', 'Move ou renomeia um arquivo rastreado', 'Moves or renames a tracked file', 'git mv <origem> <destino>', ['git mv antigo.ts novo.ts'], [
    f('-f, --force', 'Sobrescreve o destino', 'Overwrites the destination'),
    f('-k', 'Ignora erros em arquivos que não podem ser movidos', 'Ignores errors for files that cannot be moved')
  ], { args: 'path' }),
  cmd('pull', 'Baixa do remoto e junta na branch atual (fetch + merge ou rebase)', 'Downloads from the remote and joins into the current branch (fetch + merge or rebase)', 'git pull [--rebase] [<remote> [<branch>]]', ['git pull', 'git pull --rebase'], [
    f('--rebase', 'Reaplica seus commits sobre o remoto em vez de fazer merge', 'Reapplies your commits on top of the remote instead of merging'),
    f('--no-rebase', 'Volta a usar merge', 'Goes back to merge'),
    f('--ff-only', 'Só atualiza se der fast-forward', 'Only updates if it is a fast-forward'),
    f('--autostash', 'Guarda mudanças locais antes e reaplica depois', 'Stashes local changes before and reapplies them after'),
    f('--prune', 'Remove as branches remotas apagadas', 'Removes deleted remote branches')
  ], { args: 'remote-ref' }),
  cmd('push', 'Envia commits da branch para o remoto', 'Sends the branch commits to the remote', 'git push [-u] [--force-with-lease] [<remote>] [<branch>]', ['git push -u origin feature/x', 'git push --force-with-lease'], [
    f('-u, --set-upstream', 'Define a branch remota que a branch acompanha', 'Sets the remote branch to track'),
    f('--force-with-lease', 'Força só se ninguém enviou nada novo (o jeito seguro)', 'Forces only if nobody pushed anything new (the safe way)'),
    f('-f, --force', 'Força sem verificar nada (pode apagar commits de outros)', 'Forces without checking anything (can delete other people’s commits)'),
    f('--tags', 'Envia todas as tags', 'Sends all tags'),
    f('--follow-tags', 'Envia as tags anotadas dos commits enviados', 'Sends the annotated tags of the pushed commits'),
    f('-d, --delete', 'Apaga a branch no remoto', 'Deletes the branch on the remote'),
    f('--all', 'Envia todas as branches', 'Sends all branches'),
    f('--dry-run', 'Simula o envio', 'Simulates the push')
  ], { args: 'remote-ref' }),
  cmd('rebase', 'Reaplica seus commits sobre outra base', 'Reapplies your commits on top of another base', 'git rebase [--onto <novo-base>] <base>', ['git rebase main', 'git rebase --onto main feature~3 feature', 'git rebase --abort'], [
    f('--onto', 'Reaplica os commits sobre outro commit', 'Reapplies the commits onto another commit', true),
    f('--continue', 'Continua depois de resolver os conflitos', 'Continues after resolving conflicts'),
    f('--skip', 'Pula o commit que deu conflito', 'Skips the commit that conflicted'),
    f('--abort', 'Cancela e volta ao início', 'Cancels and goes back to the start'),
    f('--autostash', 'Guarda mudanças locais antes e reaplica depois', 'Stashes local changes before and reapplies them after'),
    f('--root', 'Reaplica desde o primeiro commit', 'Reapplies from the first commit'),
    f('--exec', 'Roda um comando depois de cada commit (é um comando de shell)', 'Runs a command after each commit (it is a shell command)', true)
  ], { args: 'ref' }),
  cmd('reflog', 'Histórico de onde HEAD e as branches estiveram', 'History of where HEAD and the branches have been', 'git reflog [show] [<ref>]', ['git reflog', 'git reflog -n 20'], [
    f('-n', 'Quantas entradas mostrar', 'How many entries to show', true)
  ], {
    args: 'ref',
    ops: [
      f('show', 'Mostra o histórico de movimentos de uma ref', 'Shows the movement history of a ref'),
      f('expire', 'Apaga entradas antigas do reflog', 'Deletes old reflog entries'),
      f('delete', 'Apaga entradas específicas do reflog', 'Deletes specific reflog entries'),
      f('exists', 'Diz se uma ref tem reflog', 'Tells whether a ref has a reflog')
    ],
    readOnly: true
  }),
  cmd('remote', 'Lista e gerencia os remotes (servidores)', 'Lists and manages remotes (servers)', 'git remote [-v] | add <nome> <url> | remove <nome>', ['git remote -v', 'git remote add origin https://github.com/usuario/projeto.git'], [
    f('-v, --verbose', 'Mostra a URL de cada remote', 'Shows the URL of each remote')
  ], {
    args: 'remote',
    ops: [
      f('add', 'Adiciona um remote', 'Adds a remote'),
      f('remove', 'Remove um remote', 'Removes a remote'),
      f('rename', 'Renomeia um remote', 'Renames a remote'),
      f('set-url', 'Troca a URL de um remote', 'Changes the URL of a remote'),
      f('get-url', 'Mostra a URL de um remote', 'Shows the URL of a remote'),
      f('show', 'Mostra os detalhes de um remote', 'Shows the details of a remote'),
      f('prune', 'Remove as branches remotas que sumiram', 'Removes remote branches that are gone')
    ]
  }),
  cmd('reset', 'Move a branch para outro commit (e opcionalmente mexe no stage e nos arquivos)', 'Moves the branch to another commit (and optionally changes the stage and files)', 'git reset [--soft|--mixed|--hard] [<commit>]', ['git reset HEAD~1', 'git reset --soft HEAD~1', 'git reset -- arquivo.ts'], [
    f('--soft', 'Desfaz o commit e mantém as mudanças preparadas', 'Undoes the commit and keeps the changes staged'),
    f('--mixed', 'Desfaz o commit e tira as mudanças do stage (padrão)', 'Undoes the commit and unstages the changes (default)'),
    f('--hard', 'Desfaz tudo e descarta mudanças locais (cuidado)', 'Undoes everything and discards local changes (careful)'),
    f('--keep', 'Reseta mantendo as mudanças locais não commitadas', 'Resets while keeping uncommitted local changes')
  ], { args: 'ref' }),
  cmd('restore', 'Restaura arquivos da árvore de trabalho ou do stage', 'Restores files in the working tree or the stage', 'git restore [--staged] [--source <ref>] <arquivo>…', ['git restore arquivo.ts', 'git restore --staged arquivo.ts'], [
    f('--staged', 'Tira o arquivo do stage (volta ao que está no último commit)', 'Unstages the file (back to what is in the last commit)'),
    f('-s, --source', 'De qual commit restaurar', 'Which commit to restore from', true),
    f('-W, --worktree', 'Restaura a pasta de trabalho', 'Restores the working tree'),
    f('--ours', 'Usa a versão da branch atual (em conflitos)', 'Uses the current branch version (in conflicts)'),
    f('--theirs', 'Usa a versão da outra branch (em conflitos)', 'Uses the other branch version (in conflicts)')
  ], { args: 'path' }),
  cmd('rev-parse', 'Mostra e converte nomes de refs e caminhos do repositório', 'Shows and converts ref names and repository paths', 'git rev-parse [--short|--abbrev-ref] <ref>', ['git rev-parse HEAD', 'git rev-parse --short HEAD', 'git rev-parse --abbrev-ref HEAD'], [
    f('--short', 'Hash abreviado', 'Abbreviated hash'),
    f('--abbrev-ref', 'Nome curto (ex.: main em vez de refs/heads/main)', 'Short name (e.g. main instead of refs/heads/main)'),
    f('--verify', 'Confere se a ref existe e mostra o hash', 'Checks that the ref exists and shows its hash'),
    f('--show-toplevel', 'Mostra a raiz do repositório', 'Shows the repository root'),
    f('--git-dir', 'Mostra a pasta .git', 'Shows the .git folder'),
    f('--is-inside-work-tree', 'Diz se está numa árvore de trabalho', 'Tells whether it is inside a working tree')
  ], { args: 'ref', readOnly: true }),
  cmd('revert', 'Cria um commit que desfaz outro commit', 'Creates a commit that undoes another commit', 'git revert [--no-edit] [-n] <commit>', ['git revert abc1234', 'git revert --no-edit HEAD'], [
    f('--no-edit', 'Usa a mensagem padrão, sem editor', 'Uses the default message, without an editor'),
    f('-n, --no-commit', 'Desfaz as mudanças sem criar o commit', 'Undoes the changes without creating the commit'),
    f('--continue', 'Continua depois de resolver os conflitos', 'Continues after resolving conflicts'),
    f('--abort', 'Cancela o revert em andamento', 'Cancels the revert in progress')
  ], { args: 'ref' }),
  cmd('rm', 'Remove arquivos do índice e do disco', 'Removes files from the index and from disk', 'git rm [--cached] [-r] <arquivo>…', ['git rm arquivo.ts', 'git rm --cached -r pasta/'], [
    f('--cached', 'Tira do controle do git, mas mantém no disco', 'Stops tracking it, but keeps it on disk'),
    f('-r', 'Remove diretórios recursivamente', 'Removes directories recursively'),
    f('-f, --force', 'Remove mesmo com mudanças', 'Removes even with changes'),
    f('-n, --dry-run', 'Só mostra o que seria removido', 'Only shows what would be removed')
  ], { args: 'path' }),
  cmd('shortlog', 'Resume os commits por autor', 'Summarizes commits by author', 'git shortlog [-s] [-n] [-e] [<ref>]', ['git shortlog -sn', 'git shortlog -sne --since="1 year ago"'], [
    f('-s, --summary', 'Só a quantidade de commits de cada autor', 'Only the number of commits by each author'),
    f('-n, --numbered', 'Ordena pela quantidade de commits', 'Sorts by number of commits'),
    f('-e, --email', 'Mostra também o e-mail', 'Also shows the email'),
    f('--since', 'Commits desde uma data', 'Commits since a date', true)
  ], { args: 'ref', readOnly: true }),
  cmd('show', 'Mostra um commit, uma tag, um blob ou uma árvore', 'Shows a commit, a tag, a blob or a tree', 'git show [--stat] [<commit>|<tag>|<rev>:<arquivo>]', ['git show', 'git show --stat abc1234', 'git show HEAD:README.md'], [
    f('--stat', 'Resumo de arquivos e linhas alterados', 'Summary of changed files and lines'),
    f('--name-only', 'Só os nomes dos arquivos', 'Only the file names'),
    f('-s, --no-patch', 'Só a mensagem, sem o diff', 'Only the message, without the diff'),
    f('--format', 'Formato personalizado', 'Custom format', true)
  ], { args: 'ref', readOnly: true }),
  cmd('stash', 'Guarda as mudanças em andamento para voltar a elas depois', 'Stores work in progress to come back to it later', 'git stash [push [-m <mensagem>] [-u]] | pop | apply | list | drop', ['git stash push -m "trabalho em andamento"', 'git stash pop', 'git stash list'], [
    f('-m, --message', 'Descrição do stash', 'Description of the stash', true),
    f('-u, --include-untracked', 'Inclui arquivos não rastreados', 'Includes untracked files'),
    f('--keep-index', 'Guarda, mas mantém o que está preparado', 'Stashes but keeps what is staged')
  ], {
    args: 'ref',
    ops: [
      f('push', 'Guarda as mudanças e limpa a pasta de trabalho', 'Stores the changes and cleans the working tree'),
      f('pop', 'Aplica o stash e o remove', 'Applies the stash and removes it'),
      f('apply', 'Aplica um stash sem removê-lo', 'Applies a stash without removing it'),
      f('list', 'Lista os stashes', 'Lists the stashes'),
      f('drop', 'Remove um stash', 'Removes a stash'),
      f('show', 'Mostra o conteúdo de um stash', 'Shows the content of a stash'),
      f('branch', 'Cria uma branch a partir de um stash', 'Creates a branch from a stash'),
      f('clear', 'Remove todos os stashes', 'Removes all stashes')
    ]
  }),
  cmd('status', 'Mostra os arquivos alterados, preparados e a branch atual', 'Shows changed and staged files and the current branch', 'git status [-s] [-b]', ['git status', 'git status -sb'], [
    f('-s, --short', 'Formato curto (uma linha por arquivo)', 'Short format (one line per file)'),
    f('-b, --branch', 'Mostra a branch na primeira linha', 'Shows the branch on the first line'),
    f('--ignored', 'Mostra também os arquivos ignorados', 'Also shows ignored files'),
    f('-u, --untracked-files', 'Mostra arquivos não rastreados (all ou no)', 'Shows untracked files (all or no)', true)
  ], { args: 'path', readOnly: true }),
  cmd('submodule', 'Gerencia submódulos (repositórios dentro do repositório)', 'Manages submodules (repositories inside the repository)', 'git submodule [update [--init] [--recursive]] | status | add <url> <caminho>', ['git submodule update --init --recursive', 'git submodule status'], [
    f('--init', 'Inicializa os submódulos junto com a atualização', 'Initializes the submodules together with the update'),
    f('--recursive', 'Vale também para submódulos aninhados', 'Also applies to nested submodules'),
    f('--remote', 'Atualiza para a última versão da branch do submódulo', 'Updates to the latest version of the submodule branch')
  ], {
    args: 'path',
    ops: [
      f('status', 'Mostra o commit de cada submódulo', 'Shows the commit of each submodule'),
      f('init', 'Prepara os submódulos (sem baixar)', 'Prepares the submodules (without downloading)'),
      f('update', 'Baixa e atualiza os submódulos', 'Downloads and updates the submodules'),
      f('add', 'Adiciona um submódulo', 'Adds a submodule'),
      f('sync', 'Atualiza as URLs dos submódulos', 'Updates the submodule URLs'),
      f('deinit', 'Remove o conteúdo de um submódulo', 'Removes the content of a submodule'),
      f('foreach', 'Roda um comando em cada submódulo (é um comando de shell)', 'Runs a command in each submodule (it is a shell command)')
    ]
  }),
  cmd('switch', 'Troca de branch (ou cria uma nova)', 'Switches branches (or creates a new one)', 'git switch [-c <nova>] <branch>', ['git switch main', 'git switch -c feature/x'], [
    f('-c, --create', 'Cria uma branch nova e muda para ela', 'Creates a new branch and switches to it', true),
    f('-C, --force-create', 'Cria ou redefine uma branch e muda para ela', 'Creates or resets a branch and switches to it', true),
    f('-d, --detach', 'Vai para um commit sem branch', 'Goes to a commit without a branch'),
    f('-t, --track', 'Cria a branch acompanhando a branch remota', 'Creates the branch tracking the remote branch'),
    f('--discard-changes', 'Descarta mudanças locais ao trocar', 'Discards local changes when switching'),
    f('--orphan', 'Cria uma branch sem histórico', 'Creates a branch with no history', true)
  ], { args: 'ref' }),
  cmd('tag', 'Cria, lista ou apaga tags', 'Creates, lists or deletes tags', 'git tag [-a] [-m <mensagem>] <nome> [<commit>]', ['git tag v1.0.0', 'git tag -a v1.0.0 -m "Versão 1.0.0"', 'git tag -d v0.9'], [
    f('-a, --annotate', 'Tag anotada (com mensagem)', 'Annotated tag (with a message)'),
    f('-m, --message', 'Mensagem da tag anotada', 'Message of the annotated tag', true),
    f('-d, --delete', 'Apaga uma tag', 'Deletes a tag'),
    f('-l, --list', 'Lista as tags (pode filtrar por padrão)', 'Lists the tags (can filter by pattern)'),
    f('-f, --force', 'Substitui uma tag existente', 'Replaces an existing tag'),
    f('-n', 'Mostra a mensagem de cada tag', 'Shows the message of each tag'),
    f('--points-at', 'Tags que apontam para um commit', 'Tags pointing to a commit', true)
  ], { args: 'ref' }),
  cmd('worktree', 'Cria pastas de trabalho extras para outras branches', 'Creates extra working folders for other branches', 'git worktree add <caminho> <branch> | list | remove <caminho>', ['git worktree add ../projeto-hotfix hotfix', 'git worktree list'], [
    f('-b', 'Cria uma branch nova no novo worktree', 'Creates a new branch in the new worktree', true),
    f('--detach', 'Worktree num commit sem branch', 'Worktree on a commit without a branch'),
    f('-f, --force', 'Força (ex.: branch já usada em outro worktree)', 'Forces (e.g. branch already used in another worktree)')
  ], {
    args: 'path',
    ops: [
      f('list', 'Lista os worktrees', 'Lists the worktrees'),
      f('add', 'Cria um worktree em outra pasta', 'Creates a worktree in another folder'),
      f('remove', 'Remove um worktree', 'Removes a worktree'),
      f('prune', 'Limpa worktrees que sumiram do disco', 'Cleans up worktrees that are gone from disk'),
      f('move', 'Move um worktree', 'Moves a worktree'),
      f('lock', 'Protege um worktree contra remoção', 'Protects a worktree from removal'),
      f('unlock', 'Libera um worktree bloqueado', 'Unlocks a locked worktree'),
      f('repair', 'Conserta as ligações dos worktrees', 'Repairs worktree links')
    ]
  })
]

/** Comando pelo nome exato, ou undefined. */
export function findCommand(name: string): GitCommandSpec | undefined {
  return GIT_COMMANDS.find((c) => c.name === name)
}
