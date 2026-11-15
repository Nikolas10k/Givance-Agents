import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { memoriaRegistrar } from './actions/memoria-registrar';
import { defineAction, type ToolCallContext } from './definitions';
import { executeApprovedAction, RetryableActionError } from './execute-action';
import { Registry } from './registry';
import { requestAction } from './request-action';
import { createAcaoSolicitar, describeActions, memoriaBuscar } from './system-tools';
import { createMemoryServices } from './testing';
import { createRunState, type RolePermissions } from './types';

const ORG = randomUUID();

const pagamentoTeste = defineAction({
  type: 'teste.pagar',
  description: 'Ação de teste que gasta dinheiro.',
  payload: z.strictObject({ valor_centavos: z.number().int().positive() }),
  defaultAutonomy: 'automatico',
  spendsMoney: true,
  risk: 'alto',
  async guard(_ctx, payload) {
    if (payload.valor_centavos > 10_000) {
      return { ok: false, problems: ['Valor acima do teto diário da empresa.'] };
    }
    return { ok: true, payload };
  },
  preview: (p) => ({ titulo: 'Pagamento', resumo: `R$ ${(p.valor_centavos / 100).toFixed(2)}` }),
  async execute(_ctx, p) {
    return { summary: `Pago ${p.valor_centavos}`, externalIds: { pagamento: 'pg_1' } };
  },
});

let falhasRestantes = 0;
const instavel = defineAction({
  type: 'teste.instavel',
  description: 'Falha algumas vezes antes de funcionar.',
  payload: z.strictObject({ n: z.number() }),
  defaultAutonomy: 'automatico',
  risk: 'baixo',
  preview: () => ({ titulo: 'Instável', resumo: '' }),
  async execute() {
    if (falhasRestantes > 0) {
      falhasRestantes -= 1;
      throw new RetryableActionError('API fora do ar');
    }
    return { summary: 'ok' };
  },
});

function contexto(permissions: Partial<RolePermissions> = {}, tainted = false) {
  const memory = createMemoryServices();
  const registry = new Registry({
    tools: [],
    actions: [memoriaRegistrar, pagamentoTeste, instavel],
  });
  const ctx: ToolCallContext = {
    task: {
      orgId: ORG,
      taskId: randomUUID(),
      employeeId: randomUUID(),
      runId: null,
      taskSource: 'painel',
    },
    run: createRunState(tainted),
    agent: 'orquestrador',
    permissions: {
      acoes: {
        'memoria.registrar': 'confirmar',
        'teste.pagar': 'automatico',
        'teste.instavel': 'automatico',
      },
      acoes_proibidas: [],
      ...permissions,
    },
    services: memory.services,
    registry,
  };
  return { ctx, memory, registry };
}

describe('pedido de ação', () => {
  it('cria aprovação pendente e não duplica o mesmo pedido', async () => {
    const { ctx, memory } = contexto();
    const payload = {
      titulo: 'Preços nos posts',
      conteudo: 'Não divulgar preço de clareamento em posts.',
    };

    const primeiro = await requestAction(ctx, {
      type: 'memoria.registrar',
      payload,
      reason: 'Pedido do dono',
    });
    expect(primeiro).toMatchObject({ status: 'pendente', level: 'confirmar' });

    const segundo = await requestAction(ctx, {
      type: 'memoria.registrar',
      payload: { ...payload },
    });
    expect(segundo).toMatchObject({ status: 'ja_registrada' });
    expect(memory.state.approvals).toHaveLength(1);
    expect(memory.state.auditLog.map((a) => a.action)).toEqual(['acao.solicitada']);
  });

  it('valida o payload e explica os problemas', async () => {
    const { ctx } = contexto();
    const resultado = await requestAction(ctx, {
      type: 'memoria.registrar',
      payload: { titulo: 'x' },
    });
    expect(resultado.status).toBe('invalida');
    if (resultado.status === 'invalida') {
      expect(resultado.problems.join(' ')).toMatch(/titulo|conteudo/);
    }
  });

  it('barra pelo guard antes de criar qualquer aprovação', async () => {
    const { ctx, memory } = contexto();
    const resultado = await requestAction(ctx, {
      type: 'teste.pagar',
      payload: { valor_centavos: 50_000 },
    });
    expect(resultado).toMatchObject({
      status: 'invalida',
      problems: ['Valor acima do teto diário da empresa.'],
    });
    expect(memory.state.approvals).toHaveLength(0);
  });

  it('ação que gasta dinheiro vira aprovação no painel mesmo com padrão automático', async () => {
    const { ctx, memory } = contexto();
    memory.setAutonomy(ORG, 'teste.pagar', 'automatico');
    const resultado = await requestAction(ctx, {
      type: 'teste.pagar',
      payload: { valor_centavos: 5_000 },
    });
    expect(resultado).toMatchObject({ status: 'pendente', level: 'sempre_aprovar' });
  });

  it('nível automático já nasce aprovado; depois de ler conteúdo de terceiros, não', async () => {
    const limpo = contexto({ acoes: { 'memoria.registrar': 'automatico' } });
    const payload = { titulo: 'Horário', conteudo: 'A clínica abre aos sábados das 8h às 12h.' };
    expect(await requestAction(limpo.ctx, { type: 'memoria.registrar', payload })).toMatchObject({
      status: 'aprovada_automaticamente',
    });

    const contaminado = contexto({ acoes: { 'memoria.registrar': 'automatico' } }, true);
    expect(
      await requestAction(contaminado.ctx, { type: 'memoria.registrar', payload }),
    ).toMatchObject({
      status: 'pendente',
      level: 'confirmar',
    });
  });

  it('recusa tipo desconhecido e ação proibida pelo cargo', async () => {
    const { ctx } = contexto({ acoes_proibidas: ['memoria.registrar'] });
    expect(await requestAction(ctx, { type: 'nada.existe', payload: {} })).toMatchObject({
      status: 'desconhecida',
    });
    expect(
      await requestAction(ctx, {
        type: 'memoria.registrar',
        payload: { titulo: 'abc', conteudo: 'conteúdo suficiente' },
      }),
    ).toMatchObject({ status: 'proibida' });
  });

  it('ação fora das permissões do cargo é recusada e não aparece na descrição', async () => {
    const { ctx, registry, memory } = contexto({ acoes: { 'memoria.registrar': 'confirmar' } });
    expect(await requestAction(ctx, { type: 'teste.instavel', payload: { n: 1 } })).toMatchObject({
      status: 'proibida',
    });
    expect(memory.state.approvals).toHaveLength(0);
    const descricao = describeActions(registry, ctx.permissions);
    expect(descricao).toContain('memoria.registrar');
    expect(descricao).not.toContain('teste.instavel');
  });
});

describe('execução de ação aprovada', () => {
  it('executa uma vez, grava auditoria e ignora repetições', async () => {
    const { ctx, memory, registry } = contexto();
    const pedido = await requestAction(ctx, {
      type: 'memoria.registrar',
      payload: { titulo: 'Tom de voz', conteudo: 'Usar tratamento por você, nunca por senhor(a).' },
    });
    if (!('approvalId' in pedido)) throw new Error('esperava aprovação');

    const antes = await executeApprovedAction({
      services: memory.services,
      registry,
      orgId: ORG,
      approvalId: pedido.approvalId,
      employeeId: ctx.task.employeeId,
    });
    expect(antes).toMatchObject({ status: 'ignorada' });

    memory.decide(pedido.approvalId, 'aprovada');
    const primeira = await executeApprovedAction({
      services: memory.services,
      registry,
      orgId: ORG,
      approvalId: pedido.approvalId,
      employeeId: ctx.task.employeeId,
    });
    expect(primeira).toMatchObject({ status: 'sucesso' });
    expect(memory.state.documents).toHaveLength(1);

    const segunda = await executeApprovedAction({
      services: memory.services,
      registry,
      orgId: ORG,
      approvalId: pedido.approvalId,
      employeeId: ctx.task.employeeId,
    });
    expect(segunda).toMatchObject({ status: 'ignorada', reason: 'Ação já executada.' });
    expect(memory.state.documents).toHaveLength(1);
    expect(memory.state.auditLog.map((a) => a.action)).toContain('acao.executada');
  });

  it('revalida o payload editado pelo dono e roda o guard de novo', async () => {
    const { ctx, memory, registry } = contexto();
    const pedido = await requestAction(ctx, {
      type: 'teste.pagar',
      payload: { valor_centavos: 1_000 },
    });
    if (!('approvalId' in pedido)) throw new Error('esperava aprovação');

    memory.decide(pedido.approvalId, 'aprovada', { valor_centavos: 999_999 });
    const resultado = await executeApprovedAction({
      services: memory.services,
      registry,
      orgId: ORG,
      approvalId: pedido.approvalId,
      employeeId: ctx.task.employeeId,
    });
    expect(resultado).toMatchObject({ status: 'falhou', retryable: false });
    if (resultado.status === 'falhou') {
      expect(resultado.error).toMatch(/teto diário/);
    }
  });

  it('marca falhas temporárias como retentáveis e permite nova tentativa', async () => {
    const { ctx, memory, registry } = contexto();
    falhasRestantes = 1;
    const pedido = await requestAction(ctx, { type: 'teste.instavel', payload: { n: 1 } });
    if (!('approvalId' in pedido)) throw new Error('esperava aprovação');

    const args = {
      services: memory.services,
      registry,
      orgId: ORG,
      approvalId: pedido.approvalId,
      employeeId: ctx.task.employeeId,
    };
    expect(await executeApprovedAction(args)).toMatchObject({ status: 'falhou', retryable: true });
    expect(await executeApprovedAction(args)).toMatchObject({ status: 'sucesso' });
    expect(memory.state.executions.map((e) => e.attempt)).toEqual([1, 2]);
  });
});

describe('ferramentas de sistema', () => {
  it('acao_solicitar devolve erro legível ao modelo', async () => {
    const { ctx, registry } = contexto();
    const ferramenta = createAcaoSolicitar(describeActions(registry, ctx.permissions));
    expect(ferramenta.description).toMatch(/memoria\.registrar/);
    const resultado = await ferramenta.handler(ctx, {
      tipo: 'memoria.registrar',
      dados: {},
      motivo: 'testando o fluxo',
    });
    expect(resultado.isError).toBe(true);
    expect(resultado.text).toMatch(/Problemas/);
  });

  it('memoria_buscar avisa quando não há informação, para o agente não inventar', async () => {
    const { ctx } = contexto();
    const resultado = await memoriaBuscar.handler(ctx, { consulta: 'preço do clareamento' });
    expect(resultado.text).toMatch(/Não invente/);
  });
});
