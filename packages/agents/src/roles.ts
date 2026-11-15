import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_LIMITS,
  DEFAULT_ORCHESTRATOR_PROMPT,
  defaultPromptPath,
  formatZodIssues,
  resolvedRoleSchema,
  roleFileSchema,
  strictestAutonomy,
  type AutonomyLevel,
  type ResolvedRole,
  type ResolvedSpecialist,
  type RoleFile,
} from '@givance/core';
import { PLANNED_JOBS, stableStringify, type Registry } from '@givance/tools';
import { parse as parseYaml } from 'yaml';

export interface RoleSource {
  file: string;
  role: RoleFile;
}

export interface RoleSet {
  roles: Map<string, RoleSource>;
  problems: string[];
}

/** Lê e valida todos os arquivos roles/*.yaml. */
export async function loadRoleFiles(contentRoot: string): Promise<RoleSet> {
  const rolesDir = path.join(contentRoot, 'roles');
  const problems: string[] = [];
  const roles = new Map<string, RoleSource>();

  const files = (await readdir(rolesDir))
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort();
  for (const file of files) {
    const relative = `roles/${file}`;
    let raw: unknown;
    try {
      raw = parseYaml(await readFile(path.join(rolesDir, file), 'utf8'), { prettyErrors: true });
    } catch (error) {
      problems.push(
        `${relative}: YAML inválido: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    const parsed = roleFileSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of formatZodIssues(parsed.error)) {
        problems.push(`${relative}: ${issue}`);
      }
      continue;
    }
    const role = parsed.data;
    const expectedName = file.replace(/\.ya?ml$/, '');
    if (role.key !== expectedName) {
      problems.push(
        `${relative}: a chave "${role.key}" deve ser igual ao nome do arquivo ("${expectedName}").`,
      );
      continue;
    }
    if (roles.has(role.key)) {
      problems.push(`${relative}: cargo "${role.key}" definido mais de uma vez.`);
      continue;
    }
    roles.set(role.key, { file: relative, role });
  }
  return { roles, problems };
}

function sameSpecialist(a: ResolvedSpecialist, b: ResolvedSpecialist): boolean {
  return (
    a.prompt === b.prompt &&
    a.modelo === b.modelo &&
    a.esforco === b.esforco &&
    a.turnos_maximos === b.turnos_maximos &&
    a.descricao === b.descricao
  );
}

function toSpecialist(key: string, config: RoleFile['especialistas'][string]): ResolvedSpecialist {
  return {
    prompt: config.prompt ?? defaultPromptPath(key),
    modelo: config.modelo,
    ...(config.esforco ? { esforco: config.esforco } : {}),
    ...(config.turnos_maximos ? { turnos_maximos: config.turnos_maximos } : {}),
    descricao: config.descricao,
    ferramentas: [...new Set(config.ferramentas)].sort(),
  };
}

/**
 * Resolve um cargo: aplica padrões e combina os cargos incluídos.
 * - Especialistas: o cargo combinado pode redefinir um especialista; senão, as definições
 *   dos incluídos precisam ser iguais, e as ferramentas são somadas.
 * - Permissões: vence o nível mais restritivo; ações proibidas são somadas.
 * - Limites: os do próprio cargo valem; os ausentes usam o menor valor entre os incluídos.
 * - Rotinas e conexões obrigatórias são somadas.
 */
export function resolveRole(
  key: string,
  set: RoleSet,
): { role?: ResolvedRole; problems: string[] } {
  const problems: string[] = [];

  const visit = (current: string, stack: string[]): ResolvedRole | undefined => {
    const source = set.roles.get(current);
    if (!source) {
      problems.push(
        `Cargo "${current}" não encontrado (incluído por ${stack.at(-1) ?? 'ninguém'}).`,
      );
      return undefined;
    }
    if (stack.includes(current)) {
      problems.push(`Inclusão circular: ${[...stack, current].join(' -> ')}.`);
      return undefined;
    }
    const role = source.role;
    const included = role.inclui
      .map((child) => visit(child, [...stack, current]))
      .filter((r): r is ResolvedRole => r !== undefined);

    const especialistas: Record<string, ResolvedSpecialist> = {};
    const origem: Record<string, string> = {};
    for (const child of included) {
      for (const [agentKey, specialist] of Object.entries(child.especialistas)) {
        const existing = especialistas[agentKey];
        if (!existing) {
          especialistas[agentKey] = { ...specialist, ferramentas: [...specialist.ferramentas] };
          origem[agentKey] = child.key;
          continue;
        }
        if (!sameSpecialist(existing, specialist) && !role.especialistas[agentKey]) {
          problems.push(
            `${source.file}: o especialista "${agentKey}" está definido de formas diferentes em ` +
              `"${origem[agentKey]}" e "${child.key}". Redefina-o neste cargo para resolver.`,
          );
        }
        existing.ferramentas = [
          ...new Set([...existing.ferramentas, ...specialist.ferramentas]),
        ].sort();
      }
    }
    for (const [agentKey, config] of Object.entries(role.especialistas)) {
      especialistas[agentKey] = toSpecialist(agentKey, config);
    }

    const acoes: Record<string, AutonomyLevel> = {};
    const declarar = (tipo: string, nivel: AutonomyLevel) => {
      acoes[tipo] = strictestAutonomy(acoes[tipo], nivel);
    };
    for (const child of included) {
      for (const [tipo, nivel] of Object.entries(child.permissoes.acoes)) declarar(tipo, nivel);
    }
    for (const [tipo, nivel] of Object.entries(role.permissoes.acoes)) declarar(tipo, nivel);

    const proibidas = new Set<string>(role.permissoes.acoes_proibidas);
    for (const child of included) child.permissoes.acoes_proibidas.forEach((a) => proibidas.add(a));

    const limite = <K extends keyof typeof DEFAULT_LIMITS>(campo: K): number => {
      const proprio = role.limites[campo];
      if (proprio !== undefined) return proprio;
      const dosIncluidos = included
        .map((child) => child.limites[campo])
        .filter((v): v is number => typeof v === 'number');
      return dosIncluidos.length > 0 ? Math.min(...dosIncluidos) : DEFAULT_LIMITS[campo];
    };

    const rotinas = [...included.flatMap((child) => child.rotinas), ...role.rotinas];
    const ids = new Set<string>();
    for (const rotina of rotinas) {
      if (ids.has(rotina.id)) {
        problems.push(`${source.file}: rotina "${rotina.id}" aparece mais de uma vez.`);
      }
      ids.add(rotina.id);
    }

    const conexoes = new Set(role.conexoes_obrigatorias);
    for (const child of included) child.conexoes_obrigatorias.forEach((c) => conexoes.add(c));

    const orquestrador = role.orquestrador;
    const resolved: ResolvedRole = {
      key: role.key,
      version: role.version,
      nome_exibicao: role.nome_exibicao,
      descricao: role.descricao,
      conexoes_obrigatorias: [...conexoes].sort(),
      canal_principal:
        role.canal_principal ??
        included.find((c) => c.canal_principal)?.canal_principal ??
        'painel',
      inclui: [...role.inclui],
      orquestrador: {
        prompt: orquestrador?.prompt ?? DEFAULT_ORCHESTRATOR_PROMPT,
        modelo: orquestrador?.modelo ?? 'claude-opus-5-5',
        ...(orquestrador?.esforco ? { esforco: orquestrador.esforco } : {}),
        ...(orquestrador?.turnos_maximos ? { turnos_maximos: orquestrador.turnos_maximos } : {}),
      },
      especialistas,
      permissoes: { acoes, acoes_proibidas: [...proibidas].sort() },
      limites: {
        custo_maximo_usd_por_tarefa: limite('custo_maximo_usd_por_tarefa'),
        chamadas_por_ferramenta_por_tarefa: limite('chamadas_por_ferramenta_por_tarefa'),
        tentativas_por_tarefa: limite('tentativas_por_tarefa'),
        turnos_maximos: limite('turnos_maximos'),
      },
      rotinas,
    };

    for (const rotina of rotinas) {
      if (
        'agente_inicial' in rotina &&
        rotina.agente_inicial &&
        !especialistas[rotina.agente_inicial]
      ) {
        problems.push(
          `${source.file}: rotina "${rotina.id}" cita o agente "${rotina.agente_inicial}", que não está no cargo.`,
        );
      }
    }

    const check = resolvedRoleSchema.safeParse(resolved);
    if (!check.success) {
      for (const issue of formatZodIssues(check.error)) problems.push(`${source.file}: ${issue}`);
      return undefined;
    }
    return check.data;
  };

  const role = visit(key, []);
  return problems.length === 0 && role ? { role, problems } : { problems };
}

/** sha256 da configuração resolvida (chaves ordenadas). */
export function roleConfigHash(role: ResolvedRole): string {
  return createHash('sha256').update(stableStringify(role)).digest('hex');
}

/** Prompts usados por um cargo resolvido (orquestrador primeiro). */
export function rolePromptPaths(role: ResolvedRole): string[] {
  return [role.orquestrador.prompt, ...Object.values(role.especialistas).map((s) => s.prompt)];
}

/**
 * Validação completa dos cargos do repositório: arquivos, composição, prompts existentes,
 * ferramentas, ações e jobs conhecidos. Devolve a lista de problemas (vazia = tudo certo).
 */
export async function validateRoles(
  contentRoot: string,
  registry: Registry,
): Promise<{ problems: string[]; warnings: string[]; resolved: ResolvedRole[] }> {
  const set = await loadRoleFiles(contentRoot);
  const problems = [...set.problems];
  const pendentes = new Map<string, string>();
  const resolved: ResolvedRole[] = [];
  const knownJobs = new Set(PLANNED_JOBS.map((j) => j.name));

  for (const key of [...set.roles.keys()].sort()) {
    const { role, problems: roleProblems } = resolveRole(key, set);
    problems.push(...roleProblems);
    if (!role) continue;
    resolved.push(role);
    const file = set.roles.get(key)?.file ?? key;

    for (const promptPath of new Set(rolePromptPaths(role))) {
      if (!existsSync(path.join(contentRoot, promptPath))) {
        problems.push(`${file}: prompt não encontrado: ${promptPath}`);
      }
    }
    for (const [agentKey, specialist] of Object.entries(role.especialistas)) {
      for (const tool of specialist.ferramentas) {
        if (!registry.knowsTool(tool)) {
          problems.push(
            `${file}: especialista "${agentKey}" usa a ferramenta desconhecida "${tool}".`,
          );
        } else if (!registry.isToolImplemented(tool)) {
          pendentes.set(tool, registry.plannedTool(tool)?.phase ?? '?');
        }
      }
    }
    for (const tipo of [
      ...Object.keys(role.permissoes.acoes),
      ...role.permissoes.acoes_proibidas,
    ]) {
      if (!registry.knowsAction(tipo)) {
        problems.push(`${file}: ação desconhecida "${tipo}".`);
      }
    }
    for (const rotina of role.rotinas) {
      if ('job' in rotina && !knownJobs.has(rotina.job)) {
        problems.push(`${file}: rotina "${rotina.id}" usa o job desconhecido "${rotina.job}".`);
      }
    }
  }
  const warnings =
    pendentes.size === 0
      ? []
      : [
          'ferramentas citadas nos cargos e ainda não implementadas (ficam de fora até a etapa indicada): ' +
            [...pendentes.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([tool, phase]) => `${tool} (${phase})`)
              .join(', '),
        ];
  return { problems, warnings, resolved };
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** SQL do seed local com o catálogo de cargos (supabase/seeds/10_roles.sql). */
export function rolesSeedSql(roles: ResolvedRole[]): string {
  const linhas = [
    '-- Gerado por `pnpm roles:build` a partir de roles/*.yaml. Não edite à mão.',
    '-- O CI confere se este arquivo está atualizado.',
    '',
  ];
  for (const role of [...roles].sort((a, b) => a.key.localeCompare(b.key))) {
    const config = stableStringify(role);
    linhas.push(
      `insert into public.roles (key, display_name, description) values (${sqlLiteral(role.key)}, ${sqlLiteral(role.nome_exibicao)}, ${sqlLiteral(role.descricao)});`,
      `insert into public.role_versions (role_key, version, config, config_sha256) values (${sqlLiteral(role.key)}, ${role.version}, ${sqlLiteral(config)}::jsonb, ${sqlLiteral(roleConfigHash(role))});`,
      '',
    );
  }
  return linhas.join('\n');
}
