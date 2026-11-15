import type { PlannedItem } from './definitions';

/**
 * Ferramentas previstas no PLANO.md que entram nas próximas etapas da Fase 1. Os cargos já
 * podem citá-las; o runtime só as oferece aos agentes quando forem implementadas.
 */
export const PLANNED_TOOLS: PlannedItem[] = [
  {
    name: 'gmail_listar_novos',
    phase: '1e',
    description: 'Lista e-mails novos desde a última verificação.',
  },
  { name: 'gmail_ler', phase: '1e', description: 'Lê um e-mail (conteúdo de terceiros).' },
  {
    name: 'gmail_rascunhar',
    phase: '1e',
    description: 'Cria um rascunho de resposta na conta do dono.',
  },
  {
    name: 'regras_notificacao',
    phase: '1e',
    description: 'Lê as regras de importância definidas pelo dono.',
  },
  {
    name: 'salvar_triagem',
    phase: '1e',
    description: 'Grava a classificação e o resumo de um e-mail.',
  },
  {
    name: 'calendar_disponibilidade',
    phase: '1e',
    description: 'Consulta horários livres na agenda do dono.',
  },
  {
    name: 'calendar_alterar_evento',
    phase: '1e',
    description: 'Propõe a alteração de um evento existente.',
  },
  { name: 'contatos_buscar', phase: '1e', description: 'Procura um contato pelo nome ou e-mail.' },
];

/** Tipos de ação previstos para as próximas etapas. */
export const PLANNED_ACTIONS: PlannedItem[] = [
  { name: 'gmail.enviar', phase: '1e', description: 'Envia um e-mail pela conta do dono.' },
  {
    name: 'calendar.criar_evento',
    phase: '1e',
    description: 'Cria um evento só na agenda do dono.',
  },
  {
    name: 'calendar.convidar',
    phase: '1e',
    description: 'Cria um evento com convidados e envia convites.',
  },
  {
    name: 'meta.criar_pacote_campanha',
    phase: '2',
    description: 'Cria campanha, conjuntos e anúncios pausados.',
  },
  { name: 'meta.ativar', phase: '2', description: 'Ativa uma campanha criada pausada.' },
  {
    name: 'meta.alterar_orcamento',
    phase: '2',
    description: 'Altera o orçamento diário de uma campanha.',
  },
  { name: 'meta.excluir', phase: '2', description: 'Exclui objetos na Meta (proibido no padrão).' },
];

/** Jobs de sistema (rotinas sem modelo) previstos. */
export const PLANNED_JOBS: PlannedItem[] = [
  {
    name: 'gmail.sincronizar',
    phase: '1e',
    description: 'Busca e-mails novos e dispara a triagem.',
  },
];
