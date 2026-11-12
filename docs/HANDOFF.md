# HANDOFF — Issues #92 a #98

Memória do trabalho entre sessões. Existe só na branch `ccr-8306091c-r5tduy`: o check "Validar fluxo de branches"
reprova o PR que o contenha, e ele sai (`git rm`) no commit de encerramento. Teto: 150 linhas; o detalhe de etapa
fechada está na mensagem do commit dela.

## 1. Pedido e regras do dono

- **Pedido**: "Iniciar implementação das issues do repo. Vc tem autonomia completa sobre tudo do repo" e consulta ao
  `gt-juiz` nas dúvidas. Depois: tudo segue rigorosamente as etapas (regra absoluta e gate em `CLAUDE.md`).
- **Fora do escopo**: PR (só quando o dono pedir). `rerere` nunca ligado por padrão (ver seção 5).
- **Regras deste trabalho**: uma issue (ou parte dela) por etapa, em ordem de risco; todas as etapas na branch acima
  (a designada pela plataforma vale no lugar de `feature/*`), uma de cada vez; frases por `t()` nos seis catálogos.
- **Metas**: sem regressão em processos git, nós no DOM, pacote (`npm run perf:bundle`, teto 700.000 bytes). A #98
  não pode somar bytes à primeira carga além do convite.

## 2. Estado

**A seguir:** `E5`

| Etapa | Objetivo | Estado | Commit | Número que importa |
| --- | --- | --- | --- | --- |
| 0 | #91 segurança de caminhos e `tooLarge` | fechada | `7fffbe7` | 41 testes verdes (13 reprovavam antes) |
| E1 | #93 lista de arquivos do Changes sem rolagem | fechada sem correção (não reproduzido) | ver commit | 4 cenários na tela rolam; #91 revisada: aprovada |
| E2 | #94 combobox do Dashboard escondido | fechada | ver commit | 0/5 pontos clicáveis antes, 5/5 depois em 3 tamanhos de janela |
| E3 | #97 menu principal em janela estreita | fechada | ver commit | roteiro 320/480/640: falhava em 320 e 480, passa nos 3 |
| E4 | #92 fluxo de conflito: lista lenta e modal que fecha | fechada | `adfec47` | modal de 3 opções: aparecia, some; salvar+refresh 9 → 3 processos git |
| E5 | #95 investigação: medir cherry-pick e `rerere` | a fazer | | |
| E6 | #95 implementar os caminhos decididos (seção 5) | a fazer | | |
| E7 | #96 esboço da tela Conflitos | a fazer | | |
| E8-E10 | #96 implementação em incrementos | depende de E4, E6, E7 | | |
| E11 | #98 Tour: desenho e lista de passos | a fazer | | |
| E12-E13 | #98 Tour: infraestrutura e conteúdo | depende de E3, E10, E11 | | |

### Última etapa fechada: `E4` (#92)

- **Causa**: o efeito de `conflictDetails` em `ConflictEditor.tsx` dependia de `onClose`/`toast` (identidade nova a
  cada render): relia os detalhes após salvar e, com o arquivo resolvido, mostrava a modal de três opções.
- **Feito**: efeito só pelo caminho, manipuladores por ref, cancelamento; roteiro `scripts/readme-media/conflict-save.mjs`.
- **Não conferido**: pular, abortar, continuar e nosso/deles na tela; muitos arquivos; lentidão da lista (não
  reproduzida: a lista esvazia ao fim do salvar); `ui.mjs`, perf:bundle.

## 3. Base de medição

Não se aplica ainda. E4 e E5 tiram a base (processos git do fluxo de conflito e do cherry-pick) com
`node scripts/perf/core.mjs moderate` e `--trace`; E3 e E12 usam `node scripts/perf/ui.mjs 4 moderate`.

## 4. Plano

### Etapa `E5` — #95: investigação com números (sem código de produto)

- **Orquestra**: topo
- **Arquivos prováveis**: só `scripts/perf/` se faltar roteiro; teste de integração do sequencer
- **Ler antes**: issue #95; `src/core/repository.ts` (`cherryPickCommits`, `continueOperation`)
- **Aceite**: números de processos/tempo por parada e teste do `rerere` postados na #95; teste de integração de
  cherry-pick com 2+ conflitos em sequência passa. Termina com os números postados; a escolha dos caminhos sai do juiz (seção 5).
- **Testes**: integração, medição
- **Segurança**: sim
- **Depende de**: nada (E4 fechada)

### Etapas seguintes (detalhar quando destravadas)

- **E6** (#95): implementar os caminhos escolhidos, orçamento de processos por parada testado, `security-review`.
- **E7** (#96): esboço da tela Conflitos (lista, operação, editor embutido, duas configurações) para o juiz aprovar.
- **E8-E10** (#96): lista e estado da operação; editor embutido; seção "Conflitos" em Settings; banner informativo.
- **E11** (#98): lista final de recursos e ordem dos passos (juiz aprova); desenho do convite e do cartão.
- **E12-E13** (#98): infraestrutura sob demanda (chunk separado, `data-tour`, convite); depois conteúdo nos seis idiomas
  e teste "todo alvo existe". Medir pacote da primeira carga e CPU 4×.

## 5. Decisões e armadilhas

- Decidido sem o dono: ordem por risco (segurança, bugs de tela, conflitos, Tour). #98 por último: depende do menu
  estreito (#97) e da tela de Conflitos (#96).
- `.claude/triagem.local` é pessoal e fora do git; em sessão nova, o gate libera pelo `docs/HANDOFF.md`.
- `CLAUDE.md` tem 199 linhas, no teto (abaixo de 200): quem editar o guia corta outra linha.
- **Modo fábrica** (o dono mandou decidir sem ele, em definitivo): nada para por decisão do dono. Dúvida vai ao
  `gt-juiz`; o que ele não resolve vira issue de retrabalho, e a próxima etapa segue.
- **E6**: entram "continuar automático" e "reaproveitar decisão", com resumo antes de confirmar (nunca silencioso).
  `rerere` só opcional, desligado por padrão, e só se a investigação (E5) provar segurança.
- **E7**: a tela segue a descrição da issue #96; o `gt-juiz` aprova o esboço.
- **E11**: cobertura = tudo que o usuário usa, exceto Settings (só passada rápida), como na issue #98.
- **#93**: reprodução em `scripts/readme-media/lib.mjs` com `layout: { dock }` exige `changes.unstaged` ativo (clicar a aba); `placeMissing` põe `commit.message` no grupo. Reabrir só com passos do dono. #99: retrabalho de link em `untrackedDiff`/`conflictDetails` (fora do plano; pode entrar antes de E4/E5).
- **Tela do Dashboard**: roteiro de repro em scratchpad usa `launch` + `.dashboards-tab` + `.dash-people > button`; `elementFromPoint` prova cobertura. `.dash-filters` z 20 empata com `.modal-backdrop`; o modal vence pela ordem do DOM (conferido).
- Instalar dependências em contêiner novo: `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci`.

## 6. Encerramento

Sem palavra do dono (modo fábrica): o plano acaba quando a etapa de encerramento fecha. PR só quando o dono pedir.

- [ ] Todas as etapas fechadas; pendências viraram etapa ou issue de retrabalho
- [ ] Documentação que o trabalho tornou falsa foi corrigida (`docs/PERFORMANCE.md`, README, `CLAUDE.md`, `.claude/`)
- [ ] `git rm docs/HANDOFF.md`
- [ ] Worktree usado removido, depois do último push
- [ ] `npm run typecheck`, `npm test`, `npm run build`, `npm run build:extension` e `npm run perf:bundle` verdes
- [ ] Resumo para o PR: o que mudou, antes e depois medidos, o que não foi conferido
- [ ] PR para a `develop` só quando o dono pedir
