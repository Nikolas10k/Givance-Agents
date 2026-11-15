import type { ActionDefinition, ActionLookup, PlannedItem, ToolDefinition } from './definitions';

/**
 * Registro de ferramentas e ações conhecidas. Itens "planejados" existem no plano e podem ser
 * citados nos cargos, mas ainda não têm implementação: o runtime os deixa de fora.
 */
export class Registry implements ActionLookup {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly actions = new Map<string, ActionDefinition>();
  private readonly plannedTools = new Map<string, PlannedItem>();
  private readonly plannedActions = new Map<string, PlannedItem>();

  constructor(input: {
    tools: ToolDefinition[];
    actions: ActionDefinition[];
    plannedTools?: PlannedItem[];
    plannedActions?: PlannedItem[];
  }) {
    for (const tool of input.tools) {
      if (this.tools.has(tool.name)) {
        throw new Error(`Ferramenta duplicada: ${tool.name}`);
      }
      this.tools.set(tool.name, tool);
    }
    for (const action of input.actions) {
      if (this.actions.has(action.type)) {
        throw new Error(`Ação duplicada: ${action.type}`);
      }
      this.actions.set(action.type, action);
    }
    for (const item of input.plannedTools ?? []) {
      if (!this.tools.has(item.name)) {
        this.plannedTools.set(item.name, item);
      }
    }
    for (const item of input.plannedActions ?? []) {
      if (!this.actions.has(item.name)) {
        this.plannedActions.set(item.name, item);
      }
    }
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAction(type: string): ActionDefinition | undefined {
    return this.actions.get(type);
  }

  /** Ferramenta implementada ou planejada. */
  knowsTool(name: string): boolean {
    return this.tools.has(name) || this.plannedTools.has(name);
  }

  knowsAction(type: string): boolean {
    return this.actions.has(type) || this.plannedActions.has(type);
  }

  isToolImplemented(name: string): boolean {
    return this.tools.has(name);
  }

  plannedTool(name: string): PlannedItem | undefined {
    return this.plannedTools.get(name);
  }

  implementedTools(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  implementedActions(): ActionDefinition[] {
    return [...this.actions.values()];
  }
}
