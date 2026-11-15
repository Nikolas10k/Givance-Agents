import { describe, expect, it } from 'vitest';
import { formatZodIssues, roleFileSchema } from './role';

const valido = {
  key: 'social-media',
  version: 1,
  nome_exibicao: 'Social Media',
  descricao: 'Cuida dos posts orgânicos.',
  especialistas: {
    social: {
      modelo: 'claude-opus-5-5',
      descricao: 'Planeja e prepara posts do Instagram.',
      ferramentas: ['memoria_buscar'],
    },
  },
  permissoes: { acoes: { 'instagram.publicar': 'confirmar' } },
  rotinas: [
    { id: 'resumo-diario', cron: '0 7 * * *', tarefa: 'Mandar o resumo do dia.' },
    { id: 'sincronizar-email', cron: '*/3 * * * *', job: 'gmail.sincronizar' },
  ],
};

describe('schema de cargo', () => {
  it('aceita um cargo válido e preenche padrões', () => {
    const cargo = roleFileSchema.parse(valido);
    expect(cargo.inclui).toEqual([]);
    expect(cargo.permissoes.acoes_proibidas).toEqual([]);
    expect(cargo.especialistas.social?.ferramentas).toEqual(['memoria_buscar']);
  });

  it('recusa campos desconhecidos, cron inválido e nível de autonomia inventado', () => {
    const resultado = roleFileSchema.safeParse({
      ...valido,
      campo_extra: true,
      permissoes: { acoes: { 'instagram.publicar': 'quando_der' } },
      rotinas: [{ id: 'x', cron: 'toda hora', tarefa: 'Fazer algo útil.' }],
    });
    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      const linhas = formatZodIssues(resultado.error).join('\n');
      expect(linhas).toMatch(/campo_extra/);
      expect(linhas).toMatch(/permissoes\.acoes\.instagram\.publicar/);
      expect(linhas).toMatch(/rotinas\.0/);
    }
  });

  it('recusa chaves fora do padrão', () => {
    expect(roleFileSchema.safeParse({ ...valido, key: 'Social Media' }).success).toBe(false);
    expect(
      roleFileSchema.safeParse({
        ...valido,
        especialistas: { 'Social-Media': valido.especialistas.social },
      }).success,
    ).toBe(false);
  });
});
