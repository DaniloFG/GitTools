#!/usr/bin/env bash
# Aplica as rulesets que impõem o fluxo: trabalho → develop, trabalho → homolog (nunca develop → homolog) e homolog → main.
# Idempotente: cria a ruleset se ela não existir, ou atualiza a existente com o mesmo nome.
#
# Uso: scripts/apply-branch-protection.sh [owner/repo]
# Requer: gh autenticado com permissão de administrador no repositório, e jq.
set -euo pipefail

REPO="${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"

# Aprovações exigidas em PR. Com um só mantenedor, 0 mantém o PR obrigatório sem
# impedir o próprio merge; suba para 1 quando houver um segundo revisor.
APROVACOES=0

# Checks que precisam estar verdes para o merge. Os nomes têm que bater com os das runs.
CHECKS=$(jq -n '[
  "Validar fluxo de branches",
  "check (ubuntu-latest)",
  "check (windows-latest)",
  "check (macos-latest)"
] | map({context: .})')

aplicar() {
  local nome=$1 branch=$2 metodos=$3 strict=$4
  local payload id

  payload=$(jq -n \
    --arg nome "$nome" \
    --arg ref "refs/heads/$branch" \
    --argjson metodos "$metodos" \
    --argjson aprovacoes "$APROVACOES" \
    --argjson strict "$strict" \
    --argjson checks "$CHECKS" '{
      name: $nome,
      target: "branch",
      enforcement: "active",
      bypass_actors: [],
      conditions: {ref_name: {include: [$ref], exclude: []}},
      rules: [
        {type: "deletion"},
        {type: "non_fast_forward"},
        {type: "pull_request", parameters: {
          required_approving_review_count: $aprovacoes,
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: true,
          allowed_merge_methods: $metodos
        }},
        {type: "required_status_checks", parameters: {
          strict_required_status_checks_policy: $strict,
          required_status_checks: $checks
        }}
      ]
    }')

  id=$(gh api "repos/$REPO/rulesets" --jq ".[] | select(.name == \"$nome\") | .id")
  if [ -n "$id" ]; then
    gh api --method PUT "repos/$REPO/rulesets/$id" --input - <<<"$payload" >/dev/null
    echo "Atualizada: $nome ($branch)"
  else
    gh api --method POST "repos/$REPO/rulesets" --input - <<<"$payload" >/dev/null
    echo "Criada: $nome ($branch)"
  fi
}

# Os merges em homolog e main entram por merge commit: squash ou rebase quebram o histórico comum
# entre a branch de trabalho, homolog e main e geram conflitos no PR seguinte.
#
# O quarto parâmetro é "branch atualizada em relação à base" (strict). Só a main o exige. Na develop e na homolog
# ele fica false: a develop só concatena merges da fábrica paralela, e exigir a branch atualizada faria cada PR
# esperar o anterior ser mergeado para poder entrar, o que serializa tudo. A validação da develop e da homolog é
# por commit de merge (skill validar), então não depende de a branch estar em dia com a base.
aplicar "Fluxo: main" main '["merge"]' true
aplicar "Fluxo: homolog" homolog '["merge"]' false
aplicar "Fluxo: develop" develop '["merge","squash"]' false
