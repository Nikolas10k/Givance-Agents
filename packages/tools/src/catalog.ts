import type { PlannedItem } from './definitions';

/**
 * Ferramentas previstas no PLANO.md que entram nas próximas etapas da Fase 1. Os cargos já
 * podem citá-las; o runtime só as oferece aos agentes quando forem implementadas.
 */
export const PLANNED_TOOLS: PlannedItem[] = [
  {
    name: 'midia_listar',
    phase: '1c',
    description: 'Lista imagens e vídeos do banco de mídia da empresa.',
  },
  {
    name: 'instagram_listar_posts',
    phase: '1c',
    description: 'Lista os posts recentes do Instagram da empresa.',
  },
  { name: 'instagram_insights', phase: '1c', description: 'Lê métricas dos posts do Instagram.' },
  {
    name: 'instagram_preparar_post',
    phase: '1c',
    description: 'Monta a prévia de um post e pede a publicação.',
  },
  {
    name: 'politica_checar_texto',
    phase: '1c',
    description: 'Confere um texto contra as regras de conteúdo (Meta, CFM/CRO, termos proibidos).',
  },
  {
    name: 'gmail_listar_novos',
    phase: '1d',
    description: 'Lista e-mails novos desde a última verificação.',
  },
  { name: 'gmail_ler', phase: '1d', description: 'Lê um e-mail (conteúdo de terceiros).' },
  {
    name: 'gmail_rascunhar',
    phase: '1d',
    description: 'Cria um rascunho de resposta na conta do dono.',
  },
  {
    name: 'regras_notificacao',
    phase: '1d',
    description: 'Lê as regras de importância definidas pelo dono.',
  },
  {
    name: 'salvar_triagem',
    phase: '1d',
    description: 'Grava a classificação e o resumo de um e-mail.',
  },
  {
    name: 'calendar_disponibilidade',
    phase: '1d',
    description: 'Consulta horários livres na agenda do dono.',
  },
  {
    name: 'calendar_alterar_evento',
    phase: '1d',
    description: 'Propõe a alteração de um evento existente.',
  },
  { name: 'contatos_buscar', phase: '1d', description: 'Procura um contato pelo nome ou e-mail.' },
  {
    name: 'whatsapp_avisar_dono',
    phase: '1b',
    description: 'Manda um aviso curto para o WhatsApp do dono.',
  },
];

/** Tipos de ação previstos para as próximas etapas. */
export const PLANNED_ACTIONS: PlannedItem[] = [
  {
    name: 'whatsapp.avisar_dono',
    phase: '1b',
    description: 'Aviso para o WhatsApp do próprio dono.',
  },
  {
    name: 'instagram.publicar',
    phase: '1c',
    description: 'Publica um post no Instagram da empresa.',
  },
  { name: 'gmail.enviar', phase: '1d', description: 'Envia um e-mail pela conta do dono.' },
  {
    name: 'calendar.criar_evento',
    phase: '1d',
    description: 'Cria um evento só na agenda do dono.',
  },
  {
    name: 'calendar.convidar',
    phase: '1d',
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
    phase: '1d',
    description: 'Busca e-mails novos e dispara a triagem.',
  },
];
