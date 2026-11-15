import { instagramPublicar } from './actions/instagram-publicar';
import { memoriaRegistrar } from './actions/memoria-registrar';
import { whatsappAvisarDono } from './actions/whatsapp-avisar-dono';
import { PLANNED_ACTIONS, PLANNED_TOOLS } from './catalog';
import type { ActionDefinition, ToolDefinition } from './definitions';
import { INSTAGRAM_TOOLS } from './instagram-tools';
import { Registry } from './registry';
import { SYSTEM_TOOL_NAMES, systemTools } from './system-tools';

/** Ações implementadas nesta etapa. */
export const IMPLEMENTED_ACTIONS: ActionDefinition[] = [
  memoriaRegistrar,
  whatsappAvisarDono,
  instagramPublicar,
];

/**
 * Registro padrão. As ferramentas de sistema entram com uma descrição de ações genérica;
 * o runtime monta a descrição específica do cargo ao criar o servidor de ferramentas.
 */
export function createDefaultRegistry(extra?: {
  tools?: ToolDefinition[];
  actions?: ActionDefinition[];
}): Registry {
  return new Registry({
    tools: [
      ...systemTools('Veja a lista no início da tarefa.'),
      ...INSTAGRAM_TOOLS,
      ...(extra?.tools ?? []),
    ],
    actions: [...IMPLEMENTED_ACTIONS, ...(extra?.actions ?? [])],
    plannedTools: PLANNED_TOOLS,
    plannedActions: PLANNED_ACTIONS,
  });
}

export { SYSTEM_TOOL_NAMES };
