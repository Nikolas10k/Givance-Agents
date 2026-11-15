/** Dados da empresa que entram no contexto de todos os agentes. */
export interface CompanyContext {
  funcionario: string;
  empresa: string;
  segmento?: string | null;
  descricao?: string | null;
  tomDeVoz?: string | null;
  regioes?: string[];
  naoDizer?: string[];
  setorRegulado?: string | null;
  horarioAtendimento?: string | null;
  site?: string | null;
  instagram?: string | null;
  fuso: string;
  produtos?: Array<{
    nome: string;
    descricao?: string | null;
    precoCentavos?: number | null;
    precoPublico: boolean;
  }>;
}

const SETORES: Record<string, string> = {
  saude: 'saúde',
  financeiro: 'serviços financeiros',
  juridico: 'jurídico',
  educacao: 'educação',
  outro: 'outro setor regulado',
};

export function formatBrl(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

/**
 * Bloco de contexto da empresa em markdown. A ordem é fixa para aproveitar o cache de
 * prompt entre execuções da mesma empresa; a data de hoje fica fora daqui (ver taskPrompt).
 */
export function buildCompanyContext(company: CompanyContext): string {
  const linhas: string[] = ['# Contexto da empresa', ''];
  linhas.push(`- Funcionário: ${company.funcionario}`);
  linhas.push(`- Empresa: ${company.empresa}`);
  if (company.segmento) linhas.push(`- Segmento: ${company.segmento}`);
  if (company.regioes && company.regioes.length > 0) {
    linhas.push(`- Regiões atendidas: ${company.regioes.join(', ')}`);
  }
  if (company.horarioAtendimento)
    linhas.push(`- Horário de atendimento: ${company.horarioAtendimento}`);
  if (company.site) linhas.push(`- Site: ${company.site}`);
  if (company.instagram) linhas.push(`- Instagram: @${company.instagram}`);
  linhas.push(`- Fuso horário: ${company.fuso}`);

  if (company.descricao) {
    linhas.push('', '## Sobre a empresa', company.descricao.trim());
  }
  if (company.tomDeVoz) {
    linhas.push('', '## Tom de voz', company.tomDeVoz.trim());
  }
  if (company.setorRegulado) {
    const setor = SETORES[company.setorRegulado] ?? company.setorRegulado;
    linhas.push(
      '',
      '## Setor regulado',
      `A empresa atua em ${setor}. Siga as regras de publicidade e comunicação desse setor e, na dúvida, escolha a opção mais conservadora.`,
    );
  }
  if (company.naoDizer && company.naoDizer.length > 0) {
    linhas.push('', '## Termos e promessas que a empresa não usa');
    for (const termo of company.naoDizer) linhas.push(`- ${termo}`);
  }

  const produtos = company.produtos ?? [];
  if (produtos.length > 0) {
    linhas.push('', '## Produtos e serviços');
    for (const produto of produtos) {
      let preco = '';
      if (typeof produto.precoCentavos === 'number') {
        preco = produto.precoPublico
          ? ` (preço público: ${formatBrl(produto.precoCentavos)})`
          : ' (preço interno: não divulgar)';
      }
      const descricao = produto.descricao ? ` — ${produto.descricao.trim()}` : '';
      linhas.push(`- ${produto.nome}${preco}${descricao}`);
    }
  }

  return linhas.join('\n');
}
