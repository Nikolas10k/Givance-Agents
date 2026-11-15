import { z } from 'zod';
import { cronProblem, isValidTimezone } from './cron';
import { AUTONOMY_LEVELS, CONNECTION_PROVIDERS } from './enums';

/**
 * Schema dos arquivos de cargo (roles/*.yaml). As chaves ficam em português porque são
 * editadas por quem configura os cargos, não por quem programa.
 */

export const MODEL_IDS = [
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
  'claude-fable-5-2',
] as const;
export type ModelId = (typeof MODEL_IDS)[number];

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export const roleKeySchema = z
  .string()
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    'Use letras minúsculas, números e hífens (ex.: social-media).',
  );

export const agentKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, 'Use letras minúsculas, números e "_" (ex.: executor_ads).');

export const toolNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, 'Nome de ferramenta inválido (ex.: memoria_buscar).');

export const actionTypeSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/,
    'Tipo de ação inválido (ex.: instagram.publicar).',
  );

const cronSchema = z.string().superRefine((value, ctx) => {
  const problem = cronProblem(value);
  if (problem) {
    ctx.addIssue({ code: 'custom', message: problem });
  }
});

const timezoneSchema = z
  .string()
  .refine(isValidTimezone, 'Fuso horário inválido (use o formato IANA, ex.: America/Sao_Paulo).');

const agentFields = {
  /** Caminho do prompt, relativo à raiz do repositório. Padrão: agents/<chave>/system.md */
  prompt: z
    .string()
    .regex(/^agents\/[a-z][a-z0-9_]*\/system\.md$/)
    .optional(),
  modelo: z.enum(MODEL_IDS),
  esforco: z.enum(EFFORT_LEVELS).optional(),
  turnos_maximos: z.number().int().positive().max(200).optional(),
};

export const orchestratorConfigSchema = z.strictObject(agentFields);

export const specialistConfigSchema = z.strictObject({
  ...agentFields,
  /** Quando o orquestrador deve delegar para este especialista. */
  descricao: z.string().min(10).max(600),
  ferramentas: z.array(toolNameSchema).default([]),
});

const routineBase = {
  id: roleKeySchema,
  cron: cronSchema,
  fuso: timezoneSchema.optional(),
};

/** Rotina que vira uma tarefa para o orquestrador. */
export const taskRoutineSchema = z.strictObject({
  ...routineBase,
  titulo: z.string().min(1).max(300).optional(),
  tarefa: z.string().min(5).max(4000),
  agente_inicial: agentKeySchema.optional(),
});

/** Rotina de sistema, sem modelo (ex.: sincronizar e-mails novos). */
export const jobRoutineSchema = z.strictObject({
  ...routineBase,
  job: actionTypeSchema,
});

export const routineConfigSchema = z.union([taskRoutineSchema, jobRoutineSchema]);
export type RoutineConfig = z.infer<typeof routineConfigSchema>;

export const limitsSchema = z.strictObject({
  custo_maximo_usd_por_tarefa: z.number().positive().max(100).optional(),
  chamadas_por_ferramenta_por_tarefa: z.number().int().positive().max(500).optional(),
  tentativas_por_tarefa: z.number().int().min(1).max(10).optional(),
  turnos_maximos: z.number().int().positive().max(500).optional(),
});

export const permissionsSchema = z.strictObject({
  /** Nível de autonomia padrão do cargo para cada tipo de ação. */
  acoes: z.record(actionTypeSchema, z.enum(AUTONOMY_LEVELS)).default({}),
  acoes_proibidas: z.array(actionTypeSchema).default([]),
});

export const roleFileSchema = z.strictObject({
  key: roleKeySchema,
  version: z.number().int().positive(),
  nome_exibicao: z.string().min(1).max(120),
  descricao: z.string().min(1).max(2000),
  conexoes_obrigatorias: z.array(z.enum(CONNECTION_PROVIDERS)).default([]),
  canal_principal: z.enum(['whatsapp', 'painel']).optional(),
  /** Cargos combinados neste pacote. */
  inclui: z.array(roleKeySchema).default([]),
  orquestrador: orchestratorConfigSchema.optional(),
  especialistas: z.record(agentKeySchema, specialistConfigSchema).default({}),
  permissoes: permissionsSchema.default({ acoes: {}, acoes_proibidas: [] }),
  limites: limitsSchema.default({}),
  rotinas: z.array(routineConfigSchema).default([]),
});

export type RoleFile = z.infer<typeof roleFileSchema>;

/** Limites aplicados quando nem o cargo nem os incluídos definem um valor. */
export const DEFAULT_LIMITS = {
  custo_maximo_usd_por_tarefa: 3,
  chamadas_por_ferramenta_por_tarefa: 30,
  tentativas_por_tarefa: 2,
  turnos_maximos: 40,
} as const;

export const DEFAULT_ORCHESTRATOR_PROMPT = 'agents/orquestrador/system.md';

export function defaultPromptPath(agentKey: string): string {
  return `agents/${agentKey}/system.md`;
}

/**
 * Configuração de um cargo depois de resolver composições e padrões. É o que fica gravado em
 * role_versions.config e o que o runtime usa.
 */
export const resolvedAgentSchema = z.strictObject({
  prompt: z.string(),
  modelo: z.enum(MODEL_IDS),
  esforco: z.enum(EFFORT_LEVELS).optional(),
  turnos_maximos: z.number().int().positive().optional(),
});

export const resolvedSpecialistSchema = resolvedAgentSchema.extend({
  descricao: z.string(),
  ferramentas: z.array(toolNameSchema),
});

export const resolvedRoleSchema = z.strictObject({
  key: roleKeySchema,
  version: z.number().int().positive(),
  nome_exibicao: z.string(),
  descricao: z.string(),
  conexoes_obrigatorias: z.array(z.enum(CONNECTION_PROVIDERS)),
  canal_principal: z.enum(['whatsapp', 'painel']),
  inclui: z.array(roleKeySchema),
  orquestrador: resolvedAgentSchema,
  especialistas: z.record(agentKeySchema, resolvedSpecialistSchema),
  permissoes: z.strictObject({
    acoes: z.record(actionTypeSchema, z.enum(AUTONOMY_LEVELS)),
    acoes_proibidas: z.array(actionTypeSchema),
  }),
  limites: z.strictObject({
    custo_maximo_usd_por_tarefa: z.number().positive(),
    chamadas_por_ferramenta_por_tarefa: z.number().int().positive(),
    tentativas_por_tarefa: z.number().int().positive(),
    turnos_maximos: z.number().int().positive(),
  }),
  rotinas: z.array(routineConfigSchema),
});

export type ResolvedAgent = z.infer<typeof resolvedAgentSchema>;
export type ResolvedSpecialist = z.infer<typeof resolvedSpecialistSchema>;
export type ResolvedRole = z.infer<typeof resolvedRoleSchema>;

/** Formata os problemas de validação do Zod em linhas legíveis, com o caminho do campo. */
export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(raiz)';
    return `${path}: ${issue.message}`;
  });
}
