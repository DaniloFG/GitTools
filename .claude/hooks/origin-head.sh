#!/usr/bin/env bash
# origin/HEAD (issue #143): em contêiner novo o clone não traz refs/remotes/origin/HEAD, e as skills code-review e
# security-review quebram ao descobrir a branch-base. `git remote set-head origin -a` falha sem origin/main buscado.
# Hook SessionStart: aponta o símbolo para a primeira branch remota que existir, na ordem develop, homolog, main
# (a ordem é só preferência de qual ref remota existe; não tem relação com a origem da branch de trabalho, que nasce da main).
# Idempotente e offline: se o símbolo já existe, sai sem tocar em nada. Só faz um fetch de develop quando nenhuma das
# três refs existe localmente. Sempre sai 0: nunca bloqueia a sessão; falha vira aviso no stderr.
raiz="${CLAUDE_PROJECT_DIR:-$(pwd)}"

if git -C "$raiz" symbolic-ref -q refs/remotes/origin/HEAD >/dev/null 2>&1; then
  exit 0
fi

# Imprime o nome da primeira branch remota existente na ordem de preferência; falha se nenhuma existir.
primeira_existente() {
  local ramo
  for ramo in develop homolog main; do
    if git -C "$raiz" show-ref --verify --quiet "refs/remotes/origin/$ramo" 2>/dev/null; then
      printf '%s' "$ramo"
      return 0
    fi
  done
  return 1
}

ramo=$(primeira_existente)
if [ -z "$ramo" ]; then
  # Um fetch só, de develop: cria refs/remotes/origin/develop sem depender de main estar buscado. O timeout e
  # GIT_TERMINAL_PROMPT=0 impedem que a rede lenta ou um pedido de senha travem o início da sessão.
  if command -v timeout >/dev/null 2>&1; then
    GIT_TERMINAL_PROMPT=0 timeout 30 git -C "$raiz" fetch --quiet origin develop
  else
    GIT_TERMINAL_PROMPT=0 git -C "$raiz" fetch --quiet origin develop
  fi
  ramo=$(primeira_existente)
fi

if [ -z "$ramo" ]; then
  echo 'aviso: origin/HEAD não definido: nenhuma de develop, homolog ou main existe em refs/remotes/origin/ e o fetch falhou. As skills de revisão precisam dele; com a rede, rode `git fetch origin develop`.' >&2
  exit 0
fi

if ! git -C "$raiz" symbolic-ref refs/remotes/origin/HEAD "refs/remotes/origin/$ramo" 2>/dev/null; then
  echo "aviso: não foi possível definir refs/remotes/origin/HEAD para $ramo." >&2
fi
exit 0
