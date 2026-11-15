import { describe, expect, it } from 'vitest';
import { resolveAutonomy, type AutonomyInput } from './autonomy-engine';

const acao = (extra: Partial<AutonomyInput['action']> = {}): AutonomyInput['action'] => ({
  type: 'instagram.publicar',
  defaultAutonomy: 'confirmar',
  ...extra,
});

const base = (extra: Partial<AutonomyInput> = {}): AutonomyInput => ({
  action: acao(),
  roleForbidden: false,
  tainted: false,
  ...extra,
});

describe('motor de autonomia', () => {
  it('usa a escolha da empresa, depois a do cargo, depois o padrão da ação', () => {
    expect(resolveAutonomy(base())).toMatchObject({ allowed: true, level: 'confirmar' });
    expect(resolveAutonomy(base({ roleLevel: 'sempre_aprovar' }))).toMatchObject({
      level: 'sempre_aprovar',
    });
    expect(
      resolveAutonomy(base({ roleLevel: 'sempre_aprovar', orgLevel: 'automatico' })),
    ).toMatchObject({
      level: 'automatico',
    });
  });

  it('gasto de dinheiro nunca fica abaixo de aprovação no painel, nem com escolha da empresa', () => {
    const decision = resolveAutonomy(
      base({ action: acao({ type: 'meta.ativar', spendsMoney: true }), orgLevel: 'automatico' }),
    );
    expect(decision).toMatchObject({ allowed: true, level: 'sempre_aprovar' });
    if (decision.allowed) {
      expect(decision.reasons.join(' ')).toMatch(/gastam dinheiro/);
    }
  });

  it('exclusão é proibida mesmo que a empresa tente liberar', () => {
    const decision = resolveAutonomy(
      base({ action: acao({ type: 'meta.excluir', destructive: true }), orgLevel: 'automatico' }),
    );
    expect(decision).toEqual({ allowed: false, reason: 'Ações que apagam dados são proibidas.' });
  });

  it('conteúdo de terceiros impede ação automática', () => {
    const decision = resolveAutonomy(base({ orgLevel: 'automatico', tainted: true }));
    expect(decision).toMatchObject({ allowed: true, level: 'confirmar' });
    if (decision.allowed) {
      expect(decision.reasons.join(' ')).toMatch(/conteúdo de terceiros/);
    }
  });

  it('conteúdo de terceiros não afrouxa um nível mais restritivo', () => {
    expect(resolveAutonomy(base({ roleLevel: 'sempre_aprovar', tainted: true }))).toMatchObject({
      level: 'sempre_aprovar',
    });
  });

  it('respeita o piso declarado na ação e a lista de proibidas do cargo', () => {
    expect(
      resolveAutonomy(
        base({ action: acao({ minAutonomy: 'sempre_aprovar' }), orgLevel: 'automatico' }),
      ),
    ).toMatchObject({ level: 'sempre_aprovar' });
    expect(resolveAutonomy(base({ roleForbidden: true }))).toMatchObject({ allowed: false });
  });
  it('aviso para o próprio dono continua automático mesmo depois de ler conteúdo de terceiros', () => {
    expect(
      resolveAutonomy(
        base({
          action: acao({
            type: 'whatsapp.avisar_dono',
            defaultAutonomy: 'automatico',
            selfDirected: true,
          }),
          tainted: true,
        }),
      ),
    ).toMatchObject({ allowed: true, level: 'automatico' });
  });
});
