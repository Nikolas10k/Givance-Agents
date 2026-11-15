import type { query } from '@anthropic-ai/claude-agent-sdk';
import type { TypedClient } from '@givance/db';
import type { Registry, ToolServices } from '@givance/tools';
import type { Logger } from './logger';

/** Trabalho de sistema (rotina sem modelo). Os jobs reais entram nas próximas etapas. */
export type JobHandler = (input: {
  orgId: string;
  employeeId: string;
  routineId: string;
}) => Promise<void>;

export interface WorkerDeps {
  db: TypedClient;
  services: ToolServices;
  registry: Registry;
  /** Pasta com roles/ e agents/. */
  contentRoot: string;
  apiKey?: string;
  logger: Logger;
  jobs: Record<string, JobHandler>;
  /** Para testes: substitui a função query do Agent SDK. */
  queryFn?: typeof query;
  now?: () => Date;
}
