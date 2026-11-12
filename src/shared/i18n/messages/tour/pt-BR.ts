import type { TourMessages } from './types'

export const tourPtBR: TourMessages = {
  step: {
    open: 'Abre um repositório que já está no seu computador.',
    clone: 'Copia um repositório remoto para uma pasta local.',
    branch: 'Mostra a branch atual, onde os novos commits entram.',
    fetch: 'Busca no remoto o que mudou, sem alterar seus arquivos.',
    pull: 'Traz as mudanças do remoto e as integra à branch atual.',
    push: 'Envia seus commits para o remoto.',
    new: 'Cria uma branch, uma tag ou guarda as alterações.',
    studio: 'Abre o Studio para copiar commits para a branch atual.',
    conflicts: 'Mostra conflitos ou operação em andamento; abre a tela Conflitos.',
    settings: 'O botão de engrenagem abre as Configurações (8 seções) e, em Aparência, a barra, as telas e os painéis.',
    screens: 'As abas de tela: Histórico, Alterações, Arquivos, Comparar, Branches, Log do git e Dashboards.',
    history: 'A lista de commits; clique num deles para ver os detalhes.',
    'history-diff': 'As diferenças do commit escolhido, arquivo por arquivo.',
    'changes-commit': 'Escreva a mensagem e confirme o que está preparado.',
    'changes-diff': 'Veja o que mudou no arquivo selecionado antes de confirmar.',
    files: 'Os arquivos rastreados; abra um para ver histórico e conteúdo.',
    compare: 'Escolha duas referências (branches, tags ou commits) para comparar.',
    branches: 'Branches, tags e stashes: troque de branch e veja o que existe.',
    gitlog: 'Os comandos git que o GitTools executou, com cópia de cada um.',
    dashboards: 'Gráficos e números do repositório; o passeio só mostra a aba, não abre a tela.'
  },
  card: {
    previous: 'Anterior',
    next: 'Próximo',
    exit: 'Sair',
    finish: 'Concluir',
    progress: '{current} de {total}',
    skippedTitle: 'Passos pulados:',
    noRepoEnd: 'O resto do tour aparece quando você abrir um repositório.',
    hiddenTitle: 'Telas ocultas, sem passo:',
    title: 'Tour pela interface'
  }
}
