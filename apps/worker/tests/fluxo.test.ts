/**
 * Teste de ponta a ponta do worker contra o Supabase local (supabase start), sem chamar a API
 * da Anthropic: um "modelo roteirizado" substitui a função query do Agent SDK e chama as
 * ferramentas reais pelo protocolo MCP, passando pelos hooks reais de permissão.
 *
 * Cobre: tarefa -> execução -> artefato do especialista -> pedido de ação -> aprovação do
 * dono -> execução da ação -> retomada da tarefa com histórico -> conclusão.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { HookInput, Options, SDKMessage, query } from '@anthropic-ai/claude-agent-sdk';
import { createSupabaseToolServices, type QueueMessage } from '@givance/db';
import { createServiceClient } from '@givance/db/service';
import { createDefaultRegistry } from '@givance/tools';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorkerDeps } from '../src/deps';
import { createActionExecuteHandler } from '../src/handlers/action-execute';
import { createTaskRunHandler } from '../src/handlers/task-run';
import { silentLogger } from '../src/logger';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
/** Chave secreta do Supabase local: do ambiente (CI) ou do `supabase status`. */
function localSecretKey(): string {
  if (process.env.SUPABASE_SECRET_KEY) return process.env.SUPABASE_SECRET_KEY;
  const status = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
    cwd: path.resolve(import.meta.dirname, '../../..'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return (JSON.parse(status) as { SECRET_KEY: string }).SECRET_KEY;
}
const SECRET = localSecretKey();
const DB_URL =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const DONA = '10000000-0000-4000-8000-000000000002';
const ROOT = path.resolve(import.meta.dirname, '../../..');

let pgc: pg.Client;
let orgId: string;
let slug: string;
let employeeId: string;

type Hook = (
  input: HookInput,
  id: string | undefined,
  o: { signal: AbortSignal },
) => Promise<unknown>;

/** Simula o modelo: conecta ao servidor MCP da execução e chama ferramentas com os hooks reais. */
async function conectar(options: Options) {
  const server = options.mcpServers!.givance as unknown as {
    instance: { connect(t: unknown): Promise<void> };
  };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.instance.connect(serverTransport);
  const client = new Client({ name: 'modelo-roteirizado', version: '1.0.0' });
  await client.connect(clientTransport);
  const pre = options.hooks!.PreToolUse![0]!.hooks[0] as Hook;
  const post = options.hooks!.PostToolUse![0]!.hooks[0] as Hook;
  const signal = new AbortController().signal;
  const base = { session_id: 'sessao-teste', transcript_path: '/tmp/t', cwd: '/tmp' };

  return async function chamar(agente: string, ferramenta: string, args: Record<string, unknown>) {
    const nome = `mcp__givance__${ferramenta}`;
    const id = `tu-${randomUUID()}`;
    const quem = agente === 'orquestrador' ? {} : { agent_id: `sub-${agente}`, agent_type: agente };
    const decisao = (await pre(
      {
        ...base,
        ...quem,
        hook_event_name: 'PreToolUse',
        tool_name: nome,
        tool_input: args,
        tool_use_id: id,
      } as HookInput,
      id,
      { signal },
    )) as { hookSpecificOutput?: { permissionDecision?: string } };
    if (decisao.hookSpecificOutput?.permissionDecision === 'deny') {
      return { negado: true as const, texto: '' };
    }
    const resultado = await client.callTool({ name: ferramenta, arguments: args });
    await post(
      {
        ...base,
        ...quem,
        hook_event_name: 'PostToolUse',
        tool_name: nome,
        tool_input: args,
        tool_response: resultado,
        tool_use_id: id,
      } as HookInput,
      id,
      { signal },
    );
    const conteudo = resultado.content as Array<{ type: string; text?: string }>;
    return {
      negado: false as const,
      texto: conteudo.map((c) => c.text ?? '').join('\n'),
      erro: resultado.isError === true,
    };
  };
}

const uso = (input: number, output: number) => ({ input_tokens: input, output_tokens: output });

function resultado(custo: number): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    result: 'Pronto.',
    total_cost_usd: custo,
    modelUsage: {
      'claude-opus-5-5': {
        inputTokens: 3000,
        outputTokens: 400,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUSD: custo,
      },
    },
    session_id: 'sessao-teste',
  } as unknown as SDKMessage;
}

function mensagem(taskId: string, readCount = 1): QueueMessage {
  return {
    msgId: 0,
    readCount,
    enqueuedAt: new Date().toISOString(),
    message: { type: 'task.run', task_id: taskId, org_id: orgId },
  };
}

function deps(opcoes: { queryFn?: typeof query; semChave?: boolean } = {}): WorkerDeps {
  const db = createServiceClient({ url: SUPABASE_URL, secretKey: SECRET });
  const { queryFn } = opcoes;
  return {
    db,
    services: createSupabaseToolServices(db),
    registry: createDefaultRegistry(),
    contentRoot: ROOT,
    ...(opcoes.semChave ? {} : { apiKey: 'sk-ant-teste' }),
    logger: silentLogger,
    jobs: {},
    ...(queryFn ? { queryFn } : {}),
  };
}

async function criarTarefa(mensagemDoDono: string): Promise<string> {
  const { rows } = await pgc.query<{ id: string }>(
    `insert into tasks (org_id, employee_id, title, input, source) values ($1, $2, 'Regra de preço', $3, 'painel') returning id`,
    [orgId, employeeId, JSON.stringify({ mensagem: mensagemDoDono })],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  pgc = new pg.Client({ connectionString: DB_URL });
  await pgc.connect();
  slug = `teste-fluxo-${randomUUID().slice(0, 8)}`;
  const org = await pgc.query<{ id: string }>(
    `insert into organizations (name, slug) values ('Empresa de Teste do Fluxo', $1) returning id`,
    [slug],
  );
  orgId = org.rows[0]!.id;
  await pgc.query(`insert into memberships (org_id, user_id, role) values ($1, $2, 'owner')`, [
    orgId,
    DONA,
  ]);
  await pgc.query(
    `insert into company_profiles (org_id, description, tone_of_voice, regulated_sector) values ($1, 'Clínica de teste', 'Acolhedor', 'saude')`,
    [orgId],
  );
  const contratado = await pgc.query<{ id: string }>(
    `select public.hire_employee($1, 'braco-direito', 1, 'Lia de Teste') as id`,
    [orgId],
  );
  employeeId = contratado.rows[0]!.id;
});

afterAll(async () => {
  for (const fila of ['tarefas', 'acoes', 'rotinas']) {
    await pgc.query(`delete from pgmq.q_${fila} where message ->> 'org_id' = $1`, [orgId]);
  }
  await pgc.query('select public.admin_purge_organization($1, $2)', [orgId, slug]);
  await pgc.end();
});

describe('fluxo completo de uma tarefa', () => {
  it('executa, pede aprovação, executa a ação aprovada e retoma com histórico', async () => {
    const taskId = await criarTarefa(
      'Registre na memória que não divulgamos o preço do clareamento.',
    );
    const vistos: string[] = [];

    // 1ª execução: orquestrador busca na memória, delega ao copywriter, pede a ação e avisa o dono.
    const primeira: typeof query = async function* ({ options }: { options: Options }) {
      const chamar = await conectar(options);
      yield {
        type: 'system',
        subtype: 'init',
        session_id: 'sessao-teste',
      } as unknown as SDKMessage;

      vistos.push(
        (await chamar('orquestrador', 'memoria_buscar', { consulta: 'preço clareamento' })).texto,
      );
      // Ferramenta de outro agente: o hook nega.
      vistos.push(String((await chamar('orquestrador', 'gmail_enviar', {})).negado));

      yield {
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          id: 'msg-1',
          model: 'claude-opus-5-5',
          usage: uso(2000, 200),
          content: [
            {
              type: 'tool_use',
              id: 'call-copy',
              name: 'Agent',
              input: { subagent_type: 'copywriter', prompt: 'Escreva a regra' },
            },
          ],
        },
      } as unknown as SDKMessage;
      yield {
        type: 'assistant',
        parent_tool_use_id: 'call-copy',
        message: { id: 'msg-2', model: 'claude-opus-5-5', usage: uso(1000, 200), content: [] },
      } as unknown as SDKMessage;
      await chamar('copywriter', 'salvar_artefato', {
        tipo: 'texto',
        titulo: 'Regra de preço do clareamento',
        dados: { finalidade: 'memoria', versoes: ['Não divulgamos o preço do clareamento.'] },
      });
      // Especialista não pode pedir ação: acao_solicitar é só do orquestrador.
      vistos.push(
        String(
          (
            await chamar('copywriter', 'acao_solicitar', {
              tipo: 'memoria.registrar',
              dados: {},
              motivo: 'teste',
            })
          ).negado,
        ),
      );

      const pedido = await chamar('orquestrador', 'acao_solicitar', {
        tipo: 'memoria.registrar',
        dados: {
          titulo: 'Preço do clareamento',
          conteudo: 'Não divulgamos o preço do clareamento em posts.',
        },
        motivo: 'Pedido do dono no painel.',
      });
      vistos.push(pedido.texto);
      await chamar('orquestrador', 'cliente_responder', {
        mensagem: 'Preparei o registro na memória; falta sua confirmação.',
      });
      yield resultado(0.05);
    } as unknown as typeof query;

    await createTaskRunHandler(deps({ queryFn: primeira }))(
      mensagem(taskId),
      new AbortController().signal,
    );

    expect(vistos[0]).toMatch(/Nada encontrado/);
    expect(vistos[1]).toBe('true');
    expect(vistos[2]).toBe('true');
    expect(vistos[3]).toMatch(/aguardando decisão/);

    const tarefa = await pgc.query('select status from tasks where id = $1', [taskId]);
    expect(tarefa.rows[0]).toEqual({ status: 'aguardando_aprovacao' });

    const execucao = await pgc.query(
      `select status, session_id, cost_usd::float as custo, usage_by_agent, prompt_hashes, usage_recorded from agent_runs where task_id = $1`,
      [taskId],
    );
    expect(execucao.rows).toHaveLength(1);
    const run = execucao.rows[0];
    expect(run).toMatchObject({
      status: 'pausada',
      session_id: 'sessao-teste',
      custo: 0.05,
      usage_recorded: true,
    });
    expect(Object.keys(run.usage_by_agent).sort()).toEqual(['copywriter', 'orquestrador']);
    expect(Object.keys(run.prompt_hashes)).toEqual(
      expect.arrayContaining(['orquestrador', 'copywriter', 'social']),
    );

    const passos = await pgc.query(
      `select s.agent, s.tool_name, s.status from agent_steps s join agent_runs r on r.id = s.run_id where r.task_id = $1 order by s.id`,
      [taskId],
    );
    expect(passos.rows).toEqual(
      expect.arrayContaining([
        { agent: 'orquestrador', tool_name: 'mcp__givance__memoria_buscar', status: 'ok' },
        { agent: 'orquestrador', tool_name: 'mcp__givance__gmail_enviar', status: 'negado' },
        { agent: 'copywriter', tool_name: 'mcp__givance__salvar_artefato', status: 'ok' },
        { agent: 'copywriter', tool_name: 'mcp__givance__acao_solicitar', status: 'negado' },
        { agent: 'orquestrador', tool_name: 'mcp__givance__acao_solicitar', status: 'ok' },
      ]),
    );

    const artefatos = await pgc.query(
      `select kind, created_by_agent from artifacts where task_id = $1`,
      [taskId],
    );
    expect(artefatos.rows).toEqual([{ kind: 'texto', created_by_agent: 'copywriter' }]);

    const aprovacoes = await pgc.query<{
      id: string;
      status: string;
      autonomy_level: string;
      requested_by_agent: string;
    }>(`select id, status, autonomy_level, requested_by_agent from approvals where task_id = $1`, [
      taskId,
    ]);
    expect(aprovacoes.rows).toHaveLength(1);
    expect(aprovacoes.rows[0]).toMatchObject({
      status: 'pendente',
      autonomy_level: 'confirmar',
      requested_by_agent: 'orquestrador',
    });

    const consumo = await pgc.query(
      `select runs, cost_usd::float as custo from usage_ledger where employee_id = $1`,
      [employeeId],
    );
    expect(consumo.rows[0]).toEqual({ runs: 1, custo: 0.05 });

    const mensagens = await pgc.query(`select author, content from messages where task_id = $1`, [
      taskId,
    ]);
    expect(mensagens.rows).toEqual([
      { author: 'funcionario', content: 'Preparei o registro na memória; falta sua confirmação.' },
    ]);

    // O dono aprova pelo painel (RPC com o JWT dele).
    const approvalId = aprovacoes.rows[0]!.id;
    await pgc.query('begin');
    await pgc.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: DONA, role: 'authenticated' }),
    ]);
    await pgc.query('set local role authenticated');
    await pgc.query(`select public.decide_approval($1, 'aprovar')`, [approvalId]);
    await pgc.query('commit');

    await createActionExecuteHandler(
      deps(),
      4,
    )({
      msgId: 0,
      readCount: 1,
      enqueuedAt: new Date().toISOString(),
      message: { type: 'action.execute', approval_id: approvalId, org_id: orgId },
    });

    const execucoes = await pgc.query(
      `select status, attempt from action_executions where approval_id = $1`,
      [approvalId],
    );
    expect(execucoes.rows).toEqual([{ status: 'sucesso', attempt: 1 }]);
    const memoria = await pgc.query(
      `select title, source from knowledge_documents where org_id = $1`,
      [orgId],
    );
    expect(memoria.rows).toEqual([{ title: 'Preço do clareamento', source: 'decisao' }]);
    const retomada = await pgc.query('select status from tasks where id = $1', [taskId]);
    expect(retomada.rows[0]).toEqual({ status: 'a_fazer' });

    // 2ª execução: o orquestrador recebe o histórico, confirma ao dono e encerra.
    let pedidoDaRetomada = '';
    const segunda: typeof query = async function* ({
      prompt,
      options,
    }: {
      prompt: string;
      options: Options;
    }) {
      pedidoDaRetomada = prompt;
      const chamar = await conectar(options);
      const busca = await chamar('orquestrador', 'memoria_buscar', { consulta: 'clareamento' });
      vistos.push(busca.texto);
      await chamar('orquestrador', 'cliente_responder', { mensagem: 'Registrado na memória.' });
      yield resultado(0.01);
    } as unknown as typeof query;

    await createTaskRunHandler(deps({ queryFn: segunda }))(
      mensagem(taskId),
      new AbortController().signal,
    );

    expect(pedidoDaRetomada).toContain('# Histórico desta tarefa');
    expect(pedidoDaRetomada).toMatch(/memoria\.registrar .*aprovada.*execução: sucesso/);
    expect(vistos.at(-1)).toMatch(/Não divulgamos o preço do clareamento/);
    const fim = await pgc.query('select status, result from tasks where id = $1', [taskId]);
    expect(fim.rows[0]).toEqual({ status: 'concluida', result: { resumo: 'Pronto.' } });
    const runs = await pgc.query(
      `select run_number, trigger, status from agent_runs where task_id = $1 order by run_number`,
      [taskId],
    );
    expect(runs.rows).toEqual([
      { run_number: 1, trigger: 'inicio', status: 'pausada' },
      { run_number: 2, trigger: 'retomada', status: 'concluida' },
    ]);
    const funcionario = await pgc.query('select status from employees where id = $1', [employeeId]);
    expect(funcionario.rows[0]).toEqual({ status: 'ocioso' });
  });

  it('sem chave da API, a tarefa falha com explicação para o dono', async () => {
    const taskId = await criarTarefa('Qualquer pedido.');
    await createTaskRunHandler(deps({ semChave: true }))(
      mensagem(taskId),
      new AbortController().signal,
    );
    const tarefa = await pgc.query('select status, error from tasks where id = $1', [taskId]);
    expect(tarefa.rows[0]).toMatchObject({
      status: 'falhou',
      error: 'ANTHROPIC_API_KEY não configurada no worker.',
    });
    const aviso = await pgc.query(`select content from messages where task_id = $1`, [taskId]);
    expect(aviso.rows[0].content).toMatch(/chave da API/);
  });

  it('falha do modelo: tenta de novo com espera e depois desiste avisando o dono', async () => {
    const taskId = await criarTarefa('Pedido que vai falhar.');
    const falha: typeof query = async function* () {
      yield {
        type: 'result',
        subtype: 'error_during_execution',
        errors: ['API sobrecarregada'],
        total_cost_usd: 0,
      } as unknown as SDKMessage;
    } as unknown as typeof query;

    await createTaskRunHandler(deps({ queryFn: falha }))(
      mensagem(taskId),
      new AbortController().signal,
    );
    const depoisDaPrimeira = await pgc.query(
      'select status, error, attempts from tasks where id = $1',
      [taskId],
    );
    expect(depoisDaPrimeira.rows[0]).toMatchObject({
      status: 'a_fazer',
      error: 'API sobrecarregada',
      attempts: 1,
    });
    const fila = await pgc.query(
      `select count(*)::int as n from pgmq.q_tarefas where message ->> 'task_id' = $1 and vt > now() + interval '30 seconds'`,
      [taskId],
    );
    expect(fila.rows[0].n).toBe(1);

    await createTaskRunHandler(deps({ queryFn: falha }))(
      mensagem(taskId),
      new AbortController().signal,
    );
    const final = await pgc.query('select status, attempts from tasks where id = $1', [taskId]);
    expect(final.rows[0]).toMatchObject({ status: 'falhou', attempts: 2 });
  });
});
