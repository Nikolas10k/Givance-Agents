import type {
  ActorType,
  ApprovalStatus,
  AutonomyLevel,
  DecisionChannel,
  JsonValue,
  RiskLevel,
  TaskSource,
} from '@givance/core';

/** Identifica a tarefa e a execução em que uma ferramenta ou ação roda. */
export interface TaskContext {
  orgId: string;
  taskId: string;
  employeeId: string;
  runId: string | null;
  taskSource: TaskSource;
}

/** Estado de uma execução, compartilhado pelas ferramentas chamadas nela. */
export interface RunState {
  /** Vira verdadeiro quando a execução leu conteúdo de terceiros (e-mail, mensagem de lead). */
  tainted: boolean;
  /** Quantas vezes cada ferramenta foi chamada nesta execução. */
  toolCalls: Map<string, number>;
}

export function createRunState(initiallyTainted = false): RunState {
  return { tainted: initiallyTainted, toolCalls: new Map() };
}

/** Permissões do cargo relevantes para ações. */
export interface RolePermissions {
  acoes: Record<string, AutonomyLevel>;
  acoes_proibidas: string[];
}

export interface ApprovalRecord {
  id: string;
  orgId: string;
  taskId: string;
  runId: string | null;
  actionType: string;
  payload: JsonValue;
  editedPayload: JsonValue | null;
  preview: ActionPreview;
  reason: string | null;
  autonomyLevel: AutonomyLevel;
  riskLevel: RiskLevel;
  status: ApprovalStatus;
  requestedByAgent: string;
  idempotencyKey: string;
  createdAt: string;
}

export interface NewApproval {
  orgId: string;
  taskId: string;
  runId: string | null;
  actionType: string;
  payload: JsonValue;
  preview: ActionPreview;
  reason: string | null;
  autonomyLevel: AutonomyLevel;
  riskLevel: RiskLevel;
  requestedByAgent: string;
  idempotencyKey: string;
  /** Aprovação automática já nasce aprovada pelo sistema. */
  autoApproved: boolean;
  expiresAt?: string;
}

export interface ExecutionStart {
  id: string;
  attempt: number;
}

export interface ActionPreview {
  titulo: string;
  resumo: string;
  campos?: Array<{ rotulo: string; valor: string }>;
  [key: string]: JsonValue | undefined;
}

export interface AuditEntry {
  orgId: string;
  actorType: ActorType;
  actorId: string;
  action: string;
  target?: string;
  reason?: string;
  taskId?: string | null;
  runId?: string | null;
  tokens?: number;
  costUsd?: number;
  /** Será mascarado antes de gravar. */
  payload?: unknown;
}

export interface KnowledgeHit {
  chunkId: string;
  documentId: string;
  title: string;
  content: string;
  score: number;
}

export interface ArtifactRecord {
  id: string;
  kind: string;
  title: string;
  version: number;
  data: JsonValue;
  createdByAgent: string;
  createdAt: string;
}

/** Imagem ou vídeo do banco de mídia da empresa. */
export interface MediaInfo {
  id: string;
  kind: 'imagem' | 'video' | 'outro';
  mimeType: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  caption: string | null;
  source: 'whatsapp' | 'upload';
  createdAt: string;
}

/** Regras de conteúdo da empresa (vêm do perfil). */
export interface ContentPolicy {
  doNotSay: string[];
  regulatedSector: string | null;
}

export type InstagramFormat = 'feed' | 'carrossel' | 'reels' | 'story';
export type InstagramCrop = '1:1' | '4:5' | '9:16' | 'original';

/** Post como aprovado pelo dono (payload da ação instagram.publicar). */
export interface InstagramPostRequest {
  formato: InstagramFormat;
  legenda: string;
  midia_ids: string[];
  recorte: InstagramCrop;
  agendar_para?: string | undefined;
}

export interface InstagramPostSummary {
  id: string;
  tipo: string;
  legenda: string | null;
  data: string | null;
  link: string | null;
  curtidas: number | null;
  comentarios: number | null;
  metricas?: Partial<Record<string, number>>;
}

/**
 * Dependências das ferramentas e ações. O pacote @givance/db implementa estas interfaces
 * sobre o Supabase; os testes usam a implementação em memória (./testing).
 */
export interface ToolServices {
  approvals: {
    findByIdempotencyKey(orgId: string, key: string): Promise<ApprovalRecord | null>;
    create(input: NewApproval): Promise<ApprovalRecord>;
    get(orgId: string, approvalId: string): Promise<ApprovalRecord | null>;
    countPendingForTask(orgId: string, taskId: string): Promise<number>;
  };
  executions: {
    /** Abre uma tentativa. Devolve null se outra tentativa está em andamento ou já deu certo. */
    start(orgId: string, approvalId: string): Promise<ExecutionStart | null>;
    succeed(
      orgId: string,
      executionId: string,
      result: { summary: string; externalIds: Record<string, string> },
    ): Promise<void>;
    fail(orgId: string, executionId: string, error: string): Promise<void>;
    hasSucceeded(orgId: string, approvalId: string): Promise<boolean>;
  };
  autonomy: {
    getLevel(orgId: string, actionType: string): Promise<AutonomyLevel | null>;
  };
  audit: {
    log(entry: AuditEntry): Promise<void>;
  };
  artifacts: {
    save(input: {
      orgId: string;
      taskId: string;
      kind: string;
      title: string;
      data: JsonValue;
      createdByAgent: string;
    }): Promise<ArtifactRecord>;
    list(orgId: string, taskId: string): Promise<ArtifactRecord[]>;
  };
  knowledge: {
    search(orgId: string, query: string, limit: number): Promise<KnowledgeHit[]>;
    addDocument(input: {
      orgId: string;
      title: string;
      source: 'decisao' | 'manual';
      chunks: string[];
    }): Promise<{ documentId: string }>;
  };
  messages: {
    /** Registra uma mensagem do funcionário para o dono, na conversa da tarefa. */
    sendToOwner(orgId: string, taskId: string, content: string): Promise<{ messageId: string }>;
    /**
     * Aviso no WhatsApp do dono (canal verificado mais recente). Devolve null se a empresa
     * ainda não tem número verificado.
     */
    notifyOwner(input: {
      orgId: string;
      employeeId: string;
      taskId: string | null;
      content: string;
    }): Promise<{ messageId: string } | null>;
  };
  media: {
    /** Mídias da empresa, das mais recentes para as mais antigas (ou só as dos ids pedidos). */
    list(orgId: string, options: { limit?: number; ids?: string[] }): Promise<MediaInfo[]>;
    /** Ids das mídias anexadas pelo dono a esta tarefa. */
    forTask(orgId: string, taskId: string): Promise<string[]>;
  };
  company: {
    contentPolicy(orgId: string): Promise<ContentPolicy>;
  };
  instagram: {
    /** Conta conectada e ativa, ou null. */
    account(orgId: string): Promise<{ username: string; igUserId: string } | null>;
    recentPosts(
      orgId: string,
      options: { limit: number; withInsights?: boolean },
    ): Promise<InstagramPostSummary[]>;
    /** Registra (ou mantém) o post ligado a uma aprovação de instagram.publicar. */
    saveDraft(input: { orgId: string; taskId: string; approvalId: string }): Promise<void>;
    /** Marca o post como agendado. Devolve true só na primeira vez. */
    markScheduled(orgId: string, approvalId: string, at: string): Promise<boolean>;
    /** Publica o post aprovado. Idempotente por aprovação: não publica duas vezes. */
    publish(input: {
      orgId: string;
      taskId: string;
      approvalId: string;
      post: InstagramPostRequest;
    }): Promise<{ mediaId: string; permalink: string | null }>;
  };
}

export type { DecisionChannel };
