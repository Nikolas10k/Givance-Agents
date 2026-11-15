import { describe, expect, it } from 'vitest';
import { UsageTracker, type ObservedMessage } from './usage';

const assistente = (
  id: string,
  usage: { input_tokens: number; output_tokens: number },
  extra: Partial<ObservedMessage> = {},
  content: NonNullable<ObservedMessage['message']>['content'] = [],
): ObservedMessage => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { id, model: 'claude-opus-5-5', usage, content },
  ...extra,
});

describe('divisão do consumo por agente', () => {
  it('atribui ao especialista as respostas do subagente e ajusta ao total oficial', () => {
    const tracker = new UsageTracker('claude-opus-5-5');
    tracker.observe(
      assistente('m1', { input_tokens: 1000, output_tokens: 100 }, {}, [
        {
          type: 'tool_use',
          id: 'call-1',
          name: 'Agent',
          input: { subagent_type: 'social', prompt: 'x' },
        },
      ]),
    );
    // O mesmo id em dois quadros não pode contar em dobro.
    tracker.observe(
      assistente('m2', { input_tokens: 500, output_tokens: 50 }, { parent_tool_use_id: 'call-1' }),
    );
    tracker.observe(
      assistente('m2', { input_tokens: 500, output_tokens: 80 }, { parent_tool_use_id: 'call-1' }),
    );
    tracker.observe({
      type: 'result',
      subtype: 'success',
      total_cost_usd: 0.1,
      modelUsage: {
        'claude-opus-5-5': {
          inputTokens: 1500,
          outputTokens: 180,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          costUSD: 0.1,
        },
      },
    });

    const resumo = tracker.summary();
    expect(Object.keys(resumo.byAgent).sort()).toEqual(['orquestrador', 'social']);
    expect(resumo.byAgent.social!.usage).toMatchObject({ inputTokens: 500, outputTokens: 80 });
    expect(resumo.byAgent.orquestrador!.usage).toMatchObject({
      inputTokens: 1000,
      outputTokens: 100,
    });
    expect(resumo.costUsd).toBe(0.1);
    const soma = resumo.byAgent.social!.costUsd + resumo.byAgent.orquestrador!.costUsd;
    expect(soma).toBeCloseTo(0.1, 10);
    expect(resumo.total).toMatchObject({ inputTokens: 1500, outputTokens: 180 });
  });

  it('sem resultado oficial, usa a estimativa da tabela de preços', () => {
    const tracker = new UsageTracker('claude-opus-5-5');
    tracker.observe(assistente('m1', { input_tokens: 1_000_000, output_tokens: 0 }));
    expect(tracker.summary().costUsd).toBeCloseTo(4, 6);
  });
});
