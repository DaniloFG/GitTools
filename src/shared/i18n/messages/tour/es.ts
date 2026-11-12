import type { TourMessages } from './types'

export const tourEs: TourMessages = {
  step: {
    open: 'Abre un repositorio que ya está en su computadora.',
    clone: 'Copia un repositorio remoto en una carpeta local.',
    branch: 'Muestra la rama actual, donde entran los nuevos commits.',
    fetch: 'Busca en el remoto lo que cambió, sin modificar sus archivos.',
    pull: 'Trae los cambios del remoto y los integra a la rama actual.',
    push: 'Envía sus commits al remoto.',
    new: 'Crea una rama o una etiqueta, o guarda los cambios.',
    studio: 'Abre el Studio para copiar commits a la rama actual.',
    conflicts: 'Muestra conflictos u operación en curso; abre la pantalla Conflictos.',
    settings: 'El botón de engranaje abre la Configuración (8 secciones) y, en Apariencia, la barra, las pantallas y los paneles.',
    screens: 'Las pestañas de pantalla: Historial, Cambios, Archivos, Comparar, Ramas, Log de git y Paneles.',
    history: 'La lista de commits; haga clic en uno para ver los detalles.',
    'history-diff': 'Las diferencias del commit elegido, archivo por archivo.',
    'changes-commit': 'Escriba el mensaje y confirme lo que está preparado.',
    'changes-diff': 'Vea qué cambió en el archivo seleccionado antes de confirmar.',
    files: 'Los archivos rastreados; abra uno para ver su historial y contenido.',
    compare: 'Elija dos referencias (ramas, etiquetas o commits) para comparar.',
    branches: 'Ramas, etiquetas y stashes: cambie de rama y vea lo que existe.',
    gitlog: 'Los comandos de git que ejecutó GitTools, con copia de cada uno.',
    dashboards: 'Gráficos y números del repositorio; el recorrido solo muestra la pestaña, no abre la pantalla.'
  },
  card: {
    previous: 'Anterior',
    next: 'Siguiente',
    exit: 'Salir',
    finish: 'Terminar',
    progress: '{current} de {total}',
    skippedTitle: 'Pasos omitidos:',
    noRepoEnd: 'El resto del recorrido aparece cuando abra un repositorio.',
    hiddenTitle: 'Pantallas ocultas, sin paso:',
    title: 'Recorrido por la interfaz'
  }
}
