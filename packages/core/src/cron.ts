import { CronExpressionParser } from 'cron-parser';

/** Verdadeiro para um fuso IANA válido (ex.: America/Sao_Paulo). */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Valida uma expressão cron de 5 campos (minuto hora dia mês dia-da-semana).
 * Devolve uma mensagem em português quando inválida.
 */
export function cronProblem(expression: string): string | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    return 'Use 5 campos: minuto hora dia mês dia-da-semana (ex.: "0 7 * * *").';
  }
  try {
    CronExpressionParser.parse(expression, { strict: false });
    return null;
  } catch (error) {
    return `Expressão cron inválida: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Próxima execução estritamente depois de `from`, no fuso informado. */
export function computeNextRun(
  expression: string,
  timezone: string,
  from: Date = new Date(),
): Date {
  const problem = cronProblem(expression);
  if (problem) {
    throw new Error(problem);
  }
  if (!isValidTimezone(timezone)) {
    throw new Error(`Fuso horário inválido: ${timezone}`);
  }
  return CronExpressionParser.parse(expression, { currentDate: from, tz: timezone })
    .next()
    .toDate();
}
