import { randomUUID } from 'node:crypto';
import type { AutonomyLevel } from '@givance/core';
import type {
  ApprovalRecord,
  ArtifactRecord,
  AuditEntry,
  ContentPolicy,
  InstagramPostRequest,
  InstagramPostSummary,
  KnowledgeHit,
  MediaInfo,
  ToolServices,
} from '../types';

interface MemoryExecution {
  id: string;
  orgId: string;
  approvalId: string;
  attempt: number;
  status: 'executando' | 'sucesso' | 'falhou';
  summary?: string;
  error?: string;
}

/**
 * Implementação em memória de ToolServices, para testes. Respeita as mesmas regras do banco
 * que importam para o fluxo (idempotência de aprovações, uma execução por vez, uma de sucesso).
 */
export function createMemoryServices() {
  const approvals: ApprovalRecord[] = [];
  const executions: MemoryExecution[] = [];
  const auditLog: AuditEntry[] = [];
  const artifacts: Array<ArtifactRecord & { orgId: string; taskId: string }> = [];
  const documents: Array<{ id: string; orgId: string; title: string; chunks: string[] }> = [];
  const messages: Array<{ id: string; orgId: string; taskId: string; content: string }> = [];
  const autonomyPolicies = new Map<string, AutonomyLevel>();
  const notices: Array<{ id: string; orgId: string; taskId: string | null; content: string }> = [];
  let ownerChannel = true;
  const media: Array<MediaInfo & { orgId: string; taskId?: string }> = [];
  let contentPolicy: ContentPolicy = { doNotSay: [], regulatedSector: null };
  let instagramAccount: { username: string; igUserId: string } | null = {
    username: 'empresa_teste',
    igUserId: '1789',
  };
  const instagramPosts: InstagramPostSummary[] = [];
  const drafts: Array<{ orgId: string; taskId: string; approvalId: string; scheduledAt?: string }> =
    [];
  const published: Array<{ orgId: string; approvalId: string; post: InstagramPostRequest }> = [];

  const services: ToolServices = {
    approvals: {
      async findByIdempotencyKey(orgId, key) {
        return approvals.find((a) => a.orgId === orgId && a.idempotencyKey === key) ?? null;
      },
      async create(input) {
        const record: ApprovalRecord = {
          id: randomUUID(),
          orgId: input.orgId,
          taskId: input.taskId,
          runId: input.runId,
          actionType: input.actionType,
          payload: input.payload,
          editedPayload: null,
          preview: input.preview,
          reason: input.reason,
          autonomyLevel: input.autonomyLevel,
          riskLevel: input.riskLevel,
          status: input.autoApproved ? 'aprovada' : 'pendente',
          requestedByAgent: input.requestedByAgent,
          idempotencyKey: input.idempotencyKey,
          createdAt: new Date().toISOString(),
        };
        approvals.push(record);
        return record;
      },
      async get(orgId, approvalId) {
        return approvals.find((a) => a.orgId === orgId && a.id === approvalId) ?? null;
      },
      async countPendingForTask(orgId, taskId) {
        return approvals.filter(
          (a) => a.orgId === orgId && a.taskId === taskId && a.status === 'pendente',
        ).length;
      },
    },
    executions: {
      async start(orgId, approvalId) {
        const previous = executions.filter((e) => e.orgId === orgId && e.approvalId === approvalId);
        if (previous.some((e) => e.status === 'executando' || e.status === 'sucesso')) {
          return null;
        }
        const record: MemoryExecution = {
          id: randomUUID(),
          orgId,
          approvalId,
          attempt: previous.length + 1,
          status: 'executando',
        };
        executions.push(record);
        return { id: record.id, attempt: record.attempt };
      },
      async succeed(orgId, executionId, result) {
        const record = executions.find((e) => e.orgId === orgId && e.id === executionId);
        if (record) {
          record.status = 'sucesso';
          record.summary = result.summary;
        }
      },
      async fail(orgId, executionId, error) {
        const record = executions.find((e) => e.orgId === orgId && e.id === executionId);
        if (record) {
          record.status = 'falhou';
          record.error = error;
        }
      },
      async hasSucceeded(orgId, approvalId) {
        return executions.some(
          (e) => e.orgId === orgId && e.approvalId === approvalId && e.status === 'sucesso',
        );
      },
    },
    autonomy: {
      async getLevel(orgId, actionType) {
        return autonomyPolicies.get(`${orgId}:${actionType}`) ?? null;
      },
    },
    audit: {
      async log(entry) {
        auditLog.push(entry);
      },
    },
    artifacts: {
      async save(input) {
        const version =
          artifacts.filter(
            (a) => a.orgId === input.orgId && a.taskId === input.taskId && a.kind === input.kind,
          ).length + 1;
        const record = {
          id: randomUUID(),
          orgId: input.orgId,
          taskId: input.taskId,
          kind: input.kind,
          title: input.title,
          version,
          data: input.data,
          createdByAgent: input.createdByAgent,
          createdAt: new Date().toISOString(),
        };
        artifacts.push(record);
        return record;
      },
      async list(orgId, taskId) {
        return artifacts.filter((a) => a.orgId === orgId && a.taskId === taskId);
      },
    },
    knowledge: {
      async search(orgId, query, limit) {
        const termos = query.toLowerCase().split(/\s+/).filter(Boolean);
        const hits: KnowledgeHit[] = [];
        for (const document of documents.filter((d) => d.orgId === orgId)) {
          document.chunks.forEach((chunk, index) => {
            const texto = chunk.toLowerCase();
            const score = termos.filter((t) => texto.includes(t)).length;
            if (score > 0) {
              hits.push({
                chunkId: `${document.id}:${index}`,
                documentId: document.id,
                title: document.title,
                content: chunk,
                score,
              });
            }
          });
        }
        return hits.sort((a, b) => b.score - a.score).slice(0, limit);
      },
      async addDocument(input) {
        const id = randomUUID();
        documents.push({ id, orgId: input.orgId, title: input.title, chunks: input.chunks });
        return { documentId: id };
      },
    },
    messages: {
      async sendToOwner(orgId, taskId, content) {
        const id = randomUUID();
        messages.push({ id, orgId, taskId, content });
        return { messageId: id };
      },
      async notifyOwner(input) {
        if (!ownerChannel) return null;
        const id = randomUUID();
        notices.push({ id, orgId: input.orgId, taskId: input.taskId, content: input.content });
        return { messageId: id };
      },
    },
    media: {
      async list(orgId, options) {
        const daEmpresa = media.filter((m) => m.orgId === orgId);
        if (options.ids) return daEmpresa.filter((m) => options.ids!.includes(m.id));
        return [...daEmpresa].reverse().slice(0, options.limit ?? 10);
      },
      async forTask(orgId, taskId) {
        return media.filter((m) => m.orgId === orgId && m.taskId === taskId).map((m) => m.id);
      },
    },
    company: {
      async contentPolicy() {
        return contentPolicy;
      },
    },
    instagram: {
      async account() {
        return instagramAccount;
      },
      async recentPosts(_orgId, options) {
        return instagramPosts.slice(0, options.limit);
      },
      async saveDraft(input) {
        if (!drafts.some((d) => d.approvalId === input.approvalId)) drafts.push({ ...input });
      },
      async markScheduled(_orgId, approvalId, at) {
        const draft = drafts.find((d) => d.approvalId === approvalId);
        if (!draft || draft.scheduledAt) return false;
        draft.scheduledAt = at;
        return true;
      },
      async publish(input) {
        const existente = published.find((p) => p.approvalId === input.approvalId);
        if (!existente)
          published.push({ orgId: input.orgId, approvalId: input.approvalId, post: input.post });
        const n = published.findIndex((p) => p.approvalId === input.approvalId) + 1;
        return { mediaId: `ig-${n}`, permalink: `https://www.instagram.com/p/teste${n}/` };
      },
    },
  };

  return {
    services,
    state: {
      approvals,
      executions,
      auditLog,
      artifacts,
      documents,
      messages,
      notices,
      media,
      drafts,
      published,
      instagramPosts,
    },
    addMedia(
      orgId: string,
      input: Partial<MediaInfo> & { kind: MediaInfo['kind'] },
      taskId?: string,
    ): string {
      const id = randomUUID();
      media.push({
        id,
        orgId,
        mimeType: input.kind === 'video' ? 'video/mp4' : 'image/jpeg',
        width: 1080,
        height: 1350,
        durationSeconds: input.kind === 'video' ? 20 : null,
        caption: null,
        source: 'whatsapp',
        createdAt: new Date().toISOString(),
        ...input,
        ...(taskId ? { taskId } : {}),
      });
      return id;
    },
    setContentPolicy(policy: ContentPolicy) {
      contentPolicy = policy;
    },
    setInstagramAccount(account: { username: string; igUserId: string } | null) {
      instagramAccount = account;
    },
    setOwnerChannel(value: boolean) {
      ownerChannel = value;
    },
    setAutonomy(orgId: string, actionType: string, level: AutonomyLevel) {
      autonomyPolicies.set(`${orgId}:${actionType}`, level);
    },
    decide(
      approvalId: string,
      status: 'aprovada' | 'recusada',
      editedPayload?: ApprovalRecord['payload'],
    ) {
      const approval = approvals.find((a) => a.id === approvalId);
      if (!approval) {
        throw new Error('aprovação não encontrada');
      }
      approval.status = editedPayload ? 'editada' : status;
      approval.editedPayload = editedPayload ?? null;
    },
  };
}
