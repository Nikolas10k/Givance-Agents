/**
 * Valores de domínio compartilhados entre banco, worker e painel.
 * Cada lista espelha uma restrição CHECK nas migrations (supabase/migrations). O teste de
 * banco (packages/db/tests) confere que as duas fontes continuam iguais.
 */

export const MEMBERSHIP_ROLES = ['owner', 'admin', 'member'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

/** Papéis que podem decidir aprovações. */
export const APPROVER_ROLES: readonly MembershipRole[] = ['owner', 'admin'];

export const TASK_STATUSES = [
  'a_fazer',
  'em_andamento',
  'aguardando_aprovacao',
  'concluida',
  'falhou',
  'cancelada',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  a_fazer: 'A fazer',
  em_andamento: 'Em andamento',
  aguardando_aprovacao: 'Aguardando aprovação',
  concluida: 'Concluída',
  falhou: 'Falhou',
  cancelada: 'Cancelada',
};

export const TASK_SOURCES = ['painel', 'whatsapp', 'rotina', 'webhook', 'sistema'] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

export const EMPLOYEE_STATUSES = [
  'trabalhando',
  'aguardando_aprovacao',
  'ocioso',
  'pausado',
] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  trabalhando: 'Trabalhando',
  aguardando_aprovacao: 'Aguardando aprovação',
  ocioso: 'Ocioso',
  pausado: 'Pausado',
};

/**
 * Níveis de autonomia, do menos para o mais restritivo.
 * - automatico: executa e avisa depois
 * - confirmar: prévia com botões; um toque executa
 * - sempre_aprovar: card no painel com prévia completa
 */
export const AUTONOMY_LEVELS = ['automatico', 'confirmar', 'sempre_aprovar'] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const AUTONOMY_LEVEL_LABELS: Record<AutonomyLevel, string> = {
  automatico: 'Automático',
  confirmar: 'Confirmação de um toque',
  sempre_aprovar: 'Aprovação no painel',
};

export const APPROVAL_STATUSES = [
  'pendente',
  'aprovada',
  'editada',
  'recusada',
  'expirada',
  'cancelada',
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  pendente: 'Pendente',
  aprovada: 'Aprovada',
  editada: 'Aprovada com edição',
  recusada: 'Recusada',
  expirada: 'Expirada',
  cancelada: 'Cancelada',
};

export const RISK_LEVELS = ['baixo', 'medio', 'alto'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const DECISION_CHANNELS = ['painel', 'whatsapp', 'sistema'] as const;
export type DecisionChannel = (typeof DECISION_CHANNELS)[number];

export const EXECUTION_STATUSES = ['executando', 'sucesso', 'falhou'] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const RUN_STATUSES = [
  'em_andamento',
  'concluida',
  'pausada',
  'falhou',
  'cancelada',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_TRIGGERS = ['inicio', 'retomada', 'reexecucao'] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

export const STEP_KINDS = ['tool_call', 'delegacao', 'mensagem', 'erro'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const STEP_STATUSES = ['ok', 'erro', 'negado'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const ACTOR_TYPES = ['agente', 'usuario', 'sistema'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const CONNECTION_PROVIDERS = ['meta', 'instagram', 'whatsapp', 'google'] as const;
export type ConnectionProvider = (typeof CONNECTION_PROVIDERS)[number];

export const CONNECTION_STATUSES = ['ativa', 'expirada', 'revogada', 'erro'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const MESSAGE_AUTHORS = ['dono', 'funcionario', 'sistema'] as const;
export type MessageAuthor = (typeof MESSAGE_AUTHORS)[number];

export const ROUTINE_KINDS = ['tarefa', 'job'] as const;
export type RoutineKind = (typeof ROUTINE_KINDS)[number];

/** Filas do worker (pgmq). */
export const QUEUES = ['tarefas', 'acoes', 'rotinas'] as const;
export type QueueName = (typeof QUEUES)[number];

export const REGULATED_SECTORS = ['saude', 'financeiro', 'juridico', 'educacao', 'outro'] as const;
export type RegulatedSector = (typeof REGULATED_SECTORS)[number];
