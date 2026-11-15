import { autonomyRank, strictestAutonomy, type AutonomyLevel } from '@givance/core';
import type { ActionDefinition } from './definitions';

export interface AutonomyInput {
  action: Pick<
    ActionDefinition,
    'type' | 'defaultAutonomy' | 'minAutonomy' | 'spendsMoney' | 'destructive' | 'selfDirected'
  >;
  /** Nível padrão do cargo (roles/*.yaml, permissoes.acoes). */
  roleLevel?: AutonomyLevel;
  /** Nível escolhido pela empresa no painel (autonomy_policies). */
  orgLevel?: AutonomyLevel | null;
  /** A ação está em permissoes.acoes_proibidas do cargo. */
  roleForbidden: boolean;
  /** A execução leu conteúdo de terceiros. */
  tainted: boolean;
}

export type AutonomyDecision =
  { allowed: false; reason: string } | { allowed: true; level: AutonomyLevel; reasons: string[] };

/**
 * Decide como uma ação proposta por um agente pode acontecer.
 *
 * Ordem: a escolha da empresa vale sobre o padrão do cargo, que vale sobre o padrão da ação.
 * Depois entram os pisos fixos, que ninguém afrouxa pelo painel:
 * - excluir é proibido;
 * - gastar dinheiro exige aprovação no painel;
 * - ação pedida numa execução que leu conteúdo de terceiros exige ao menos confirmação;
 * - o piso declarado na própria ação.
 */
export function resolveAutonomy(input: AutonomyInput): AutonomyDecision {
  const { action } = input;

  if (action.destructive) {
    return { allowed: false, reason: 'Ações que apagam dados são proibidas.' };
  }
  if (input.roleForbidden) {
    return { allowed: false, reason: `O cargo não permite a ação ${action.type}.` };
  }

  const base = input.orgLevel ?? input.roleLevel ?? action.defaultAutonomy;
  const reasons: string[] = [];
  let level = base;

  const applyFloor = (floor: AutonomyLevel, reason: string) => {
    if (autonomyRank(floor) > autonomyRank(level)) {
      level = strictestAutonomy(level, floor);
      reasons.push(reason);
    }
  };

  if (action.minAutonomy) {
    applyFloor(action.minAutonomy, 'Nível mínimo definido para este tipo de ação.');
  }
  if (action.spendsMoney) {
    applyFloor(
      'sempre_aprovar',
      'Ações que gastam dinheiro sempre passam por aprovação no painel.',
    );
  }
  if (input.tainted && !action.selfDirected) {
    applyFloor(
      'confirmar',
      'Pedida depois de ler conteúdo de terceiros (e-mail ou mensagem): precisa da sua confirmação.',
    );
  }

  return { allowed: true, level, reasons };
}
