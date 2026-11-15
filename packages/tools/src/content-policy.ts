import type { ContentPolicy } from './types';

/**
 * Checagem determinística de textos públicos (legendas, mensagens, anúncios). Não substitui o
 * bom senso do copywriter: pega o que não pode passar de jeito nenhum (termos que a empresa
 * proibiu, promessas vetadas em setor regulado, limites do Instagram) e aponta riscos.
 */

export type TextContext = 'legenda' | 'mensagem' | 'anuncio';

export interface PolicyCheck {
  /** Impedem a publicação. */
  problemas: string[];
  /** Pedem revisão, mas não bloqueiam. */
  alertas: string[];
}

export const INSTAGRAM_LIMITS = { legenda: 2200, hashtags: 30, mencoes: 20 } as const;

/** Promessas vetadas por setor (publicidade de saúde: CFM, CFO/CRO; financeiro: CVM/Bacen). */
const BLOQUEIOS_POR_SETOR: Record<string, string[]> = {
  saude: [
    'antes e depois',
    'resultado garantido',
    'resultados garantidos',
    'garantimos o resultado',
    'cura garantida',
    'sem dor',
    '100% eficaz',
    '100% seguro',
    'o melhor dentista',
    'o melhor medico',
    'a melhor clinica',
  ],
  financeiro: ['rentabilidade garantida', 'lucro garantido', 'sem risco', 'dinheiro facil'],
  educacao: ['aprovacao garantida', 'emprego garantido'],
};

/** Padrões de risco em qualquer setor: viram alerta. */
const ALERTAS_GERAIS: Array<{ padrao: RegExp; mensagem: string }> = [
  {
    padrao: /\bgarant(e|ido|ida|imos|ia)\b/,
    mensagem: 'Evite prometer garantia; descreva o que a empresa faz, não o resultado.',
  },
  {
    padrao: /\b100\s?%/,
    mensagem: '"100%" costuma ser lido como promessa absoluta; prefira algo verificável.',
  },
  {
    padrao: /\b(voce|vc)\s+(esta|e)\s+(gordo|gorda|endividado|endividada|doente|careca)\b/,
    mensagem: 'Não afirme atributos pessoais do leitor (regra da Meta para anúncios).',
  },
  {
    padrao: /\b(ultimas?|ultima)\s+(vagas?|unidades?)\b/,
    mensagem: 'Escassez só se for verdade; confirme com o dono.',
  },
];

/** Minúsculas, sem acentos e com espaços normalizados, para comparar termos. */
export function normalizeText(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function countHashtags(texto: string): number {
  return (texto.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
}

export function countMentions(texto: string): number {
  return (texto.match(/(^|\s)@[\w.]+/g) ?? []).length;
}

function contemTermo(textoNormalizado: string, termo: string): boolean {
  const alvo = normalizeText(termo);
  if (!alvo) return false;
  const escapado = alvo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapado}($|[^\\p{L}\\p{N}])`, 'u').test(
    textoNormalizado,
  );
}

export function checkText(
  texto: string,
  policy: ContentPolicy,
  context: TextContext = 'legenda',
): PolicyCheck {
  const problemas: string[] = [];
  const alertas: string[] = [];
  const normalizado = normalizeText(texto);

  for (const termo of policy.doNotSay) {
    if (contemTermo(normalizado, termo)) {
      problemas.push(`A empresa não usa o termo "${termo}".`);
    }
  }

  const setor = policy.regulatedSector;
  for (const termo of setor ? (BLOQUEIOS_POR_SETOR[setor] ?? []) : []) {
    if (contemTermo(normalizado, termo)) {
      problemas.push(`"${termo}" não pode ser usado na comunicação de uma empresa deste setor.`);
    }
  }

  for (const regra of ALERTAS_GERAIS) {
    if (regra.padrao.test(normalizado) && !alertas.includes(regra.mensagem)) {
      alertas.push(regra.mensagem);
    }
  }

  if (context === 'legenda') {
    if (texto.length > INSTAGRAM_LIMITS.legenda) {
      problemas.push(
        `Legenda com ${texto.length} caracteres; o Instagram aceita até ${INSTAGRAM_LIMITS.legenda}.`,
      );
    }
    const hashtags = countHashtags(texto);
    if (hashtags > INSTAGRAM_LIMITS.hashtags) {
      problemas.push(`${hashtags} hashtags; o Instagram aceita até ${INSTAGRAM_LIMITS.hashtags}.`);
    } else if (hashtags > 10) {
      alertas.push(`${hashtags} hashtags: acima de 10 costuma parecer spam; prefira de 3 a 8.`);
    }
    const mencoes = countMentions(texto);
    if (mencoes > INSTAGRAM_LIMITS.mencoes) {
      problemas.push(`${mencoes} menções; o Instagram aceita até ${INSTAGRAM_LIMITS.mencoes}.`);
    }
  }

  if (/[A-ZÀ-Ú]{12,}/.test(texto.replace(/[^A-Za-zÀ-ú]/g, ''))) {
    alertas.push('Trecho longo em maiúsculas soa como grito; use só para destacar uma palavra.');
  }

  return { problemas, alertas };
}

export function formatPolicyCheck(check: PolicyCheck): string {
  if (check.problemas.length === 0 && check.alertas.length === 0) {
    return 'Texto aprovado na checagem: nenhum problema encontrado.';
  }
  const linhas: string[] = [];
  if (check.problemas.length > 0) {
    linhas.push('Problemas (impedem a publicação, corrija):');
    for (const p of check.problemas) linhas.push(`- ${p}`);
  }
  if (check.alertas.length > 0) {
    linhas.push('Alertas (revise; não bloqueiam):');
    for (const a of check.alertas) linhas.push(`- ${a}`);
  }
  return linhas.join('\n');
}
