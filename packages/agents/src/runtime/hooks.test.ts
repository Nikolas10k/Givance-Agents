import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { AgentAttribution, createRuntimeHooks, type StepRecorder } from './hooks';

function preparar() {
  const eventos: string[] = [];
  const recorder: StepRecorder = {
    toolStarted: (e) => eventos.push(`inicio:${e.agent}:${e.toolName}`),
    toolFinished: (e) => eventos.push(`fim:${e.agent}:${e.toolName}:${e.status}`),
    toolDenied: (e) => eventos.push(`negado:${e.agent}:${e.toolName}`),
    delegated: (e) => eventos.push(`delegacao:${e.agent}:${e.phase}`),
  };
  const attribution = new AgentAttribution();
  const hooks = createRuntimeHooks({
    allowedSubagents: new Set(['social', 'copywriter']),
    toolsByAgent: new Map([
      ['orquestrador', new Set(['mcp__givance__acao_solicitar'])],
      ['social', new Set(['mcp__givance__salvar_artefato'])],
    ]),
    attribution,
    recorder,
  });
  const pre = hooks.PreToolUse![0]!.hooks[0]!;
  const base = { session_id: 's', transcript_path: '/tmp/x', cwd: '/tmp' };
  const chamar = (input: Record<string, unknown>) =>
    pre(
      { ...base, hook_event_name: 'PreToolUse', tool_use_id: 'tu', ...input } as HookInput,
      'tu',
      {
        signal: new AbortController().signal,
      },
    );
  return { chamar, eventos, attribution };
}

describe('hooks de permissão', () => {
  it('delegação só para especialistas do cargo e sempre em primeiro plano', async () => {
    const { chamar } = preparar();
    const ok = await chamar({
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'social',
        prompt: 'Faça o post',
        description: 'post',
        run_in_background: true,
        model: 'haiku',
        isolation: 'remote',
      },
    });
    expect(ok).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'allow',
        updatedInput: {
          subagent_type: 'social',
          prompt: 'Faça o post',
          description: 'post',
          run_in_background: false,
        },
      },
    });
    const updated = (ok as { hookSpecificOutput: { updatedInput: Record<string, unknown> } })
      .hookSpecificOutput.updatedInput;
    expect(updated).not.toHaveProperty('model');
    expect(updated).not.toHaveProperty('isolation');

    const intruso = await chamar({
      tool_name: 'Agent',
      tool_input: { subagent_type: 'general-purpose', prompt: 'x' },
    });
    expect(intruso).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
  });

  it('especialista não delega e só usa as próprias ferramentas', async () => {
    const { chamar, eventos } = preparar();
    const delegar = await chamar({
      tool_name: 'Agent',
      agent_id: 'a1',
      agent_type: 'social',
      tool_input: { subagent_type: 'copywriter' },
    });
    expect(delegar).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });

    const alheia = await chamar({
      tool_name: 'mcp__givance__acao_solicitar',
      agent_id: 'a1',
      agent_type: 'social',
      tool_input: {},
    });
    expect(alheia).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });

    const propria = await chamar({
      tool_name: 'mcp__givance__salvar_artefato',
      agent_id: 'a1',
      agent_type: 'social',
      tool_input: {},
    });
    expect(propria).toEqual({});
    expect(eventos).toContain('inicio:social:mcp__givance__salvar_artefato');
  });

  it('nega ferramentas nativas e de outros servidores', async () => {
    const { chamar } = preparar();
    for (const tool_name of ['Bash', 'WebFetch', 'mcp__outro__qualquer']) {
      expect(await chamar({ tool_name, tool_input: {} })).toMatchObject({
        hookSpecificOutput: { permissionDecision: 'deny' },
      });
    }
  });

  it('a atribuição liga a chamada da ferramenta ao agente que a fez', async () => {
    const { chamar, attribution } = preparar();
    await chamar({
      tool_name: 'mcp__givance__salvar_artefato',
      agent_id: 'a1',
      agent_type: 'social',
      tool_input: {},
    });
    expect(attribution.take('mcp__givance__salvar_artefato', {})).toBe('social');
    expect(attribution.take('mcp__givance__salvar_artefato', {})).toBe('orquestrador');
  });
});
