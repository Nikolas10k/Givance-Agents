import { z } from 'zod';

const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(20),
  /** Sem chave, o worker sobe, mas marca as tarefas como falhas com explicação. */
  ANTHROPIC_API_KEY: z.string().min(10).optional(),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(200).max(60_000).default(2_000),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /** WhatsApp Cloud API (número da Givance). Sem estes dois, o canal fica desligado. */
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(5).optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().min(10).optional(),
  WHATSAPP_GRAPH_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default('v23.0'),
  WHATSAPP_TEMPLATE_AVISO: z.string().default('givance_aviso'),
  WHATSAPP_TEMPLATE_CONFIRMACAO: z.string().default('givance_confirmacao'),
  WHATSAPP_TEMPLATE_IDIOMA: z.string().default('pt_BR'),
  /** Versão da API do Instagram (graph.instagram.com). Os tokens vêm das conexões no Vault. */
  INSTAGRAM_GRAPH_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default('v23.0'),
});

export type WorkerConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problemas = parsed.error.issues
      .map((i) => `- ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuração do worker inválida:\n${problemas}`);
  }
  return parsed.data;
}
