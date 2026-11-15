import { redact, type AutonomyLevel, type JsonValue } from '@givance/core';
import type { ActionPreview, ApprovalRecord, ToolServices } from '@givance/tools';
import {
  assertOk,
  DbError,
  isUniqueViolation,
  unwrap,
  unwrapMaybe,
  type TypedClient,
} from './client';
import type { Json, Tables } from './database.types';

function toApproval(row: Tables<'approvals'>): ApprovalRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    taskId: row.task_id,
    runId: row.run_id,
    actionType: row.action_type,
    payload: row.payload as JsonValue,
    editedPayload: (row.edited_payload ?? null) as JsonValue | null,
    preview: row.preview as ActionPreview,
    reason: row.reason,
    autonomyLevel: row.autonomy_level as AutonomyLevel,
    riskLevel: row.risk_level as ApprovalRecord['riskLevel'],
    status: row.status as ApprovalRecord['status'],
    requestedByAgent: row.requested_by_agent,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
  };
}

/** Implementação de ToolServices sobre o Supabase (chave secreta, sempre filtrando por org_id). */
export function createSupabaseToolServices(db: TypedClient): ToolServices {
  return {
    approvals: {
      async findByIdempotencyKey(orgId, key) {
        const row = unwrapMaybe(
          'aprovação: buscar por chave',
          await db
            .from('approvals')
            .select('*')
            .eq('org_id', orgId)
            .eq('idempotency_key', key)
            .maybeSingle(),
        );
        return row ? toApproval(row) : null;
      },
      async create(input) {
        const agora = new Date().toISOString();
        const row = unwrap(
          'aprovação: criar',
          await db
            .from('approvals')
            .insert({
              org_id: input.orgId,
              task_id: input.taskId,
              run_id: input.runId,
              action_type: input.actionType,
              payload: input.payload as NonNullable<Json>,
              preview: input.preview as unknown as NonNullable<Json>,
              reason: input.reason,
              autonomy_level: input.autonomyLevel,
              risk_level: input.riskLevel,
              requested_by_agent: input.requestedByAgent,
              idempotency_key: input.idempotencyKey,
              ...(input.expiresAt ? { expires_at: input.expiresAt } : {}),
              ...(input.autoApproved
                ? { status: 'aprovada', decided_at: agora, decision_channel: 'sistema' }
                : {}),
            })
            .select('*')
            .single(),
        );
        return toApproval(row);
      },
      async get(orgId, approvalId) {
        const row = unwrapMaybe(
          'aprovação: ler',
          await db
            .from('approvals')
            .select('*')
            .eq('org_id', orgId)
            .eq('id', approvalId)
            .maybeSingle(),
        );
        return row ? toApproval(row) : null;
      },
      async countPendingForTask(orgId, taskId) {
        const result = await db
          .from('approvals')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .eq('task_id', taskId)
          .eq('status', 'pendente');
        assertOk('aprovações: contar', result);
        return result.count ?? 0;
      },
    },

    executions: {
      async start(orgId, approvalId) {
        const anteriores = unwrapMaybe(
          'execuções: listar tentativas',
          await db
            .from('action_executions')
            .select('attempt, status')
            .eq('org_id', orgId)
            .eq('approval_id', approvalId),
        );
        if ((anteriores ?? []).some((e) => e.status === 'executando' || e.status === 'sucesso')) {
          return null;
        }
        const attempt = Math.max(0, ...(anteriores ?? []).map((e) => e.attempt)) + 1;
        try {
          const row = unwrap(
            'execução: abrir tentativa',
            await db
              .from('action_executions')
              .insert({ org_id: orgId, approval_id: approvalId, attempt })
              .select('id, attempt')
              .single(),
          );
          return { id: row.id, attempt: row.attempt };
        } catch (error) {
          // Outro worker abriu a tentativa ao mesmo tempo (índice de uma execução em andamento).
          if (isUniqueViolation(error)) return null;
          throw error;
        }
      },
      async succeed(orgId, executionId, result) {
        assertOk(
          'execução: sucesso',
          await db
            .from('action_executions')
            .update({
              status: 'sucesso',
              external_ids: result.externalIds,
              result_redacted: redact({ resumo: result.summary }) as Json,
              finished_at: new Date().toISOString(),
            })
            .eq('org_id', orgId)
            .eq('id', executionId),
        );
      },
      async fail(orgId, executionId, error) {
        assertOk(
          'execução: falha',
          await db
            .from('action_executions')
            .update({
              status: 'falhou',
              error: error.slice(0, 4000),
              finished_at: new Date().toISOString(),
            })
            .eq('org_id', orgId)
            .eq('id', executionId),
        );
      },
      async hasSucceeded(orgId, approvalId) {
        const result = await db
          .from('action_executions')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .eq('approval_id', approvalId)
          .eq('status', 'sucesso');
        assertOk('execuções: verificar sucesso', result);
        return (result.count ?? 0) > 0;
      },
    },

    autonomy: {
      async getLevel(orgId, actionType) {
        const row = unwrapMaybe(
          'autonomia: ler',
          await db
            .from('autonomy_policies')
            .select('level')
            .eq('org_id', orgId)
            .eq('action_type', actionType)
            .maybeSingle(),
        );
        return (row?.level as AutonomyLevel | undefined) ?? null;
      },
    },

    audit: {
      async log(entry) {
        assertOk(
          'auditoria: gravar',
          await db.from('audit_log').insert({
            org_id: entry.orgId,
            actor_type: entry.actorType,
            actor_id: entry.actorId.slice(0, 200),
            action: entry.action.slice(0, 100),
            target: entry.target?.slice(0, 300) ?? null,
            reason: entry.reason?.slice(0, 4000) ?? null,
            task_id: entry.taskId ?? null,
            run_id: entry.runId ?? null,
            tokens: entry.tokens ?? null,
            cost_usd: entry.costUsd ?? null,
            payload_redacted: entry.payload === undefined ? null : (redact(entry.payload) as Json),
          }),
        );
      },
    },

    artifacts: {
      async save(input) {
        for (let tentativa = 0; tentativa < 3; tentativa++) {
          const ultima = unwrapMaybe(
            'artefato: versão atual',
            await db
              .from('artifacts')
              .select('version')
              .eq('org_id', input.orgId)
              .eq('task_id', input.taskId)
              .eq('kind', input.kind)
              .order('version', { ascending: false })
              .limit(1)
              .maybeSingle(),
          );
          try {
            const row = unwrap(
              'artefato: salvar',
              await db
                .from('artifacts')
                .insert({
                  org_id: input.orgId,
                  task_id: input.taskId,
                  kind: input.kind,
                  title: input.title.slice(0, 300),
                  data: input.data as NonNullable<Json>,
                  version: (ultima?.version ?? 0) + 1,
                  created_by_agent: input.createdByAgent.slice(0, 80),
                })
                .select('*')
                .single(),
            );
            return {
              id: row.id,
              kind: row.kind,
              title: row.title,
              version: row.version,
              data: row.data as JsonValue,
              createdByAgent: row.created_by_agent,
              createdAt: row.created_at,
            };
          } catch (error) {
            if (!isUniqueViolation(error)) throw error;
          }
        }
        throw new DbError('artefato: salvar', '23505', 'conflito de versão repetido');
      },
      async list(orgId, taskId) {
        const rows = unwrapMaybe(
          'artefatos: listar',
          await db
            .from('artifacts')
            .select('*')
            .eq('org_id', orgId)
            .eq('task_id', taskId)
            .order('created_at'),
        );
        return (rows ?? []).map((row) => ({
          id: row.id,
          kind: row.kind,
          title: row.title,
          version: row.version,
          data: row.data as JsonValue,
          createdByAgent: row.created_by_agent,
          createdAt: row.created_at,
        }));
      },
    },

    knowledge: {
      async search(orgId, query, limit) {
        const rows = unwrapMaybe(
          'memória: buscar',
          await db.rpc('search_knowledge', { p_org_id: orgId, p_query: query, p_limit: limit }),
        );
        return (rows ?? []).map((row) => ({
          chunkId: row.chunk_id,
          documentId: row.document_id,
          title: row.title,
          content: row.content,
          score: row.score,
        }));
      },
      async addDocument(input) {
        const documento = unwrap(
          'memória: criar documento',
          await db
            .from('knowledge_documents')
            .insert({
              org_id: input.orgId,
              title: input.title,
              source: input.source,
              status: 'processado',
            })
            .select('id')
            .single(),
        );
        if (input.chunks.length > 0) {
          assertOk(
            'memória: gravar trechos',
            await db.from('knowledge_chunks').insert(
              input.chunks.map((content, index) => ({
                org_id: input.orgId,
                document_id: documento.id,
                chunk_index: index,
                content,
              })),
            ),
          );
        }
        return { documentId: documento.id };
      },
    },

    messages: {
      async sendToOwner(orgId, taskId, content) {
        const task = unwrap(
          'mensagem: ler tarefa',
          await db
            .from('tasks')
            .select('id, employee_id, conversation_id')
            .eq('org_id', orgId)
            .eq('id', taskId)
            .single(),
        );
        let conversationId = task.conversation_id;
        let channel = 'painel';
        if (conversationId) {
          const conversa = unwrap(
            'mensagem: ler conversa',
            await db
              .from('conversations')
              .select('channel')
              .eq('org_id', orgId)
              .eq('id', conversationId)
              .single(),
          );
          channel = conversa.channel;
        } else {
          const conversa = unwrap(
            'mensagem: abrir conversa',
            await db
              .from('conversations')
              .insert({ org_id: orgId, employee_id: task.employee_id, channel: 'painel' })
              .select('id')
              .single(),
          );
          conversationId = conversa.id;
          assertOk(
            'mensagem: ligar conversa',
            await db
              .from('tasks')
              .update({ conversation_id: conversationId })
              .eq('org_id', orgId)
              .eq('id', taskId),
          );
        }
        const message = unwrap(
          'mensagem: gravar',
          await db
            .from('messages')
            .insert({
              org_id: orgId,
              conversation_id: conversationId,
              task_id: taskId,
              author: 'funcionario',
              content: content.slice(0, 20000),
              delivery_status: channel === 'whatsapp' ? 'pendente' : 'nao_aplicavel',
            })
            .select('id')
            .single(),
        );
        return { messageId: message.id };
      },
    },
  };
}
