import { describe, expect, it } from 'vitest';
import { redact, redactText } from './redact';

describe('mascaramento', () => {
  it('mascara telefones brasileiros em vários formatos', () => {
    expect(redactText('Ligue para (11) 91234-5678')).toBe('Ligue para [telefone]');
    expect(redactText('whats +55 19 99999-0001')).toBe('whats [telefone]');
    expect(redactText('tel 11912345678.')).toBe('tel [telefone].');
  });

  it('mascara e-mail, CPF, CNPJ e tokens', () => {
    expect(redactText('escreva para joao.silva@exemplo.com.br')).toBe('escreva para [email]');
    expect(redactText('CPF 123.456.789-09')).toBe('CPF [cpf]');
    expect(redactText('CNPJ 12.345.678/0001-90')).toBe('CNPJ [cnpj]');
    expect(redactText('chave sk_live_abcdefghijklmnop1234')).toBe('chave [token]');
    expect(redactText('Authorization: Bearer abc.def-123456')).toBe(
      'Authorization: Bearer [token]',
    );
  });

  it('preserva valores, datas e horários', () => {
    const texto = 'Promoção de R$ 180,00 no dia 2026-11-20 às 18:00, 3 vagas';
    expect(redactText(texto)).toBe(texto);
  });

  it('oculta chaves sensíveis e percorre estruturas', () => {
    const resultado = redact({
      access_token: 'qualquer coisa',
      senha: '123',
      lead: { nome: 'Ana', telefone: '(19) 98888-7777' },
      itens: ['contato: ana@exemplo.com', 42, true, null],
    });
    expect(resultado).toEqual({
      access_token: '[oculto]',
      senha: '[oculto]',
      lead: { nome: 'Ana', telefone: '[telefone]' },
      itens: ['contato: [email]', 42, true, null],
    });
  });

  it('limita textos longos e listas grandes', () => {
    const longo = redactText('a'.repeat(2500));
    expect(longo.length).toBeLessThan(2100);
    expect(longo).toMatch(/\[\+500 caracteres\]$/);

    const lista = redact(Array.from({ length: 150 }, (_, i) => i)) as unknown[];
    expect(lista).toHaveLength(101);
    expect(lista[100]).toBe('[+50 itens]');
  });
});
