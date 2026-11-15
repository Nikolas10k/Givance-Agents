import path from 'node:path';
import { createDefaultRegistry } from '@givance/tools';
import { describe, expect, it } from 'vitest';
import {
  loadRoleFiles,
  resolveRole,
  roleConfigHash,
  rolesSeedSql,
  validateRoles,
  type RoleSet,
} from './roles';

const ROOT = path.resolve(import.meta.dirname, '../../..');

function setDe(roles: Array<Record<string, unknown> & { key: string }>): RoleSet {
  const map: RoleSet['roles'] = new Map();
  for (const raw of roles) {
    const role = {
      inclui: [],
      conexoes_obrigatorias: [],
      especialistas: {},
      permissoes: { acoes: {}, acoes_proibidas: [] },
      limites: {},
      rotinas: [],
      ...raw,
    } as unknown as RoleSet['roles'] extends Map<string, infer S>
      ? S extends { role: infer R }
        ? R
        : never
      : never;
    map.set(raw.key, { file: `roles/${raw.key}.yaml`, role });
  }
  return { roles: map, problems: [] };
}

const especialista = (extra: Record<string, unknown> = {}) => ({
  modelo: 'claude-opus-5-5',
  descricao: 'Especialista de teste com descrição.',
  ferramentas: [],
  ...extra,
});

describe('cargos do repositório', () => {
  it('são válidos, com prompts existentes e ferramentas conhecidas', async () => {
    const { problems, resolved } = await validateRoles(ROOT, createDefaultRegistry());
    expect(problems).toEqual([]);
    expect(resolved.map((r) => r.key)).toEqual([
      'assistente-executivo',
      'braco-direito',
      'social-media',
    ]);
  });

  it('o Braço Direito junta especialistas, rotinas e conexões dos cargos incluídos', async () => {
    const set = await loadRoleFiles(ROOT);
    const { role } = resolveRole('braco-direito', set);
    expect(Object.keys(role!.especialistas).sort()).toEqual([
      'copywriter',
      'criativo',
      'secretaria',
      'social',
      'triagem',
    ]);
    expect(role!.rotinas.map((r) => r.id)).toEqual([
      'resumo-diario',
      'sincronizar-email',
      'planejamento-semanal',
    ]);
    expect(role!.conexoes_obrigatorias).toEqual(['google', 'instagram', 'whatsapp']);
    expect(role!.limites.custo_maximo_usd_por_tarefa).toBe(3);
    expect(role!.limites.chamadas_por_ferramenta_por_tarefa).toBe(30);
  });

  it('o seed gerado está em dia com os arquivos', async () => {
    const { resolved } = await validateRoles(ROOT, createDefaultRegistry());
    const { readFile } = await import('node:fs/promises');
    const atual = await readFile(path.join(ROOT, 'supabase/seeds/10_roles.sql'), 'utf8');
    expect(atual).toBe(rolesSeedSql(resolved));
  });
});

describe('composição de cargos', () => {
  it('permissões: vence o nível mais restritivo; proibidas são somadas', () => {
    const set = setDe([
      {
        key: 'a',
        version: 1,
        nome_exibicao: 'A',
        descricao: 'A',
        permissoes: { acoes: { 'x.fazer': 'automatico' }, acoes_proibidas: ['x.apagar'] },
      },
      {
        key: 'b',
        version: 1,
        nome_exibicao: 'B',
        descricao: 'B',
        permissoes: { acoes: { 'x.fazer': 'sempre_aprovar' }, acoes_proibidas: [] },
      },
      {
        key: 'pacote',
        version: 1,
        nome_exibicao: 'P',
        descricao: 'P',
        inclui: ['a', 'b'],
        permissoes: { acoes: { 'x.fazer': 'confirmar' }, acoes_proibidas: [] },
      },
    ]);
    const { role, problems } = resolveRole('pacote', set);
    expect(problems).toEqual([]);
    expect(role!.permissoes).toEqual({
      acoes: { 'x.fazer': 'sempre_aprovar' },
      acoes_proibidas: ['x.apagar'],
    });
  });

  it('limites: os do pacote valem; os ausentes usam o menor dos incluídos', () => {
    const set = setDe([
      {
        key: 'a',
        version: 1,
        nome_exibicao: 'A',
        descricao: 'A',
        limites: { custo_maximo_usd_por_tarefa: 1, turnos_maximos: 10 },
      },
      {
        key: 'b',
        version: 1,
        nome_exibicao: 'B',
        descricao: 'B',
        limites: { custo_maximo_usd_por_tarefa: 5, turnos_maximos: 20 },
      },
      {
        key: 'pacote',
        version: 1,
        nome_exibicao: 'P',
        descricao: 'P',
        inclui: ['a', 'b'],
        limites: { custo_maximo_usd_por_tarefa: 4 },
      },
    ]);
    const { role } = resolveRole('pacote', set);
    expect(role!.limites.custo_maximo_usd_por_tarefa).toBe(4);
    expect(role!.limites.turnos_maximos).toBe(10);
  });

  it('mesmo especialista em dois cargos: ferramentas somadas; definições diferentes exigem redefinição', () => {
    const base = [
      {
        key: 'a',
        version: 1,
        nome_exibicao: 'A',
        descricao: 'A',
        especialistas: { copy: especialista({ ferramentas: ['memoria_buscar'] }) },
      },
      {
        key: 'b',
        version: 1,
        nome_exibicao: 'B',
        descricao: 'B',
        especialistas: { copy: especialista({ ferramentas: ['salvar_artefato'] }) },
      },
    ];
    const ok = resolveRole(
      'pacote',
      setDe([
        ...base,
        { key: 'pacote', version: 1, nome_exibicao: 'P', descricao: 'P', inclui: ['a', 'b'] },
      ]),
    );
    expect(ok.role!.especialistas.copy!.ferramentas).toEqual(['memoria_buscar', 'salvar_artefato']);

    const conflito = setDe([
      base[0]!,
      { ...base[1]!, especialistas: { copy: especialista({ modelo: 'claude-sonnet-5-5' }) } },
      { key: 'pacote', version: 1, nome_exibicao: 'P', descricao: 'P', inclui: ['a', 'b'] },
    ]);
    expect(resolveRole('pacote', conflito).problems.join(' ')).toMatch(
      /definido de formas diferentes/,
    );
  });

  it('detecta inclusão circular, cargo inexistente e rotina duplicada', () => {
    const circular = setDe([
      { key: 'a', version: 1, nome_exibicao: 'A', descricao: 'A', inclui: ['b'] },
      { key: 'b', version: 1, nome_exibicao: 'B', descricao: 'B', inclui: ['a'] },
    ]);
    expect(resolveRole('a', circular).problems.join(' ')).toMatch(/circular/);
    expect(resolveRole('x', circular).problems.join(' ')).toMatch(/não encontrado/);

    const rotina = { id: 'r', cron: '0 7 * * *', tarefa: 'Fazer algo útil.' };
    const duplicada = setDe([
      { key: 'a', version: 1, nome_exibicao: 'A', descricao: 'A', rotinas: [rotina] },
      {
        key: 'p',
        version: 1,
        nome_exibicao: 'P',
        descricao: 'P',
        inclui: ['a'],
        rotinas: [rotina],
      },
    ]);
    expect(resolveRole('p', duplicada).problems.join(' ')).toMatch(/mais de uma vez/);
  });

  it('o hash da configuração não depende da ordem das chaves', () => {
    const set = setDe([{ key: 'a', version: 1, nome_exibicao: 'A', descricao: 'A' }]);
    const { role } = resolveRole('a', set);
    const reordenado = Object.fromEntries(Object.entries(role!).reverse()) as typeof role;
    expect(roleConfigHash(reordenado!)).toBe(roleConfigHash(role!));
  });
});
