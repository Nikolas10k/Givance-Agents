import { AUTONOMY_LEVELS, type AutonomyLevel } from './enums';

/** Posição do nível na escala: quanto maior, mais restritivo. */
export function autonomyRank(level: AutonomyLevel): number {
  return AUTONOMY_LEVELS.indexOf(level);
}

/** O nível mais restritivo entre os informados (ignora valores ausentes). */
export function strictestAutonomy(
  ...levels: Array<AutonomyLevel | null | undefined>
): AutonomyLevel {
  let result: AutonomyLevel = 'automatico';
  for (const level of levels) {
    if (level && autonomyRank(level) > autonomyRank(result)) {
      result = level;
    }
  }
  return result;
}

/** Verdadeiro quando `level` é pelo menos tão restritivo quanto `floor`. */
export function isAtLeast(level: AutonomyLevel, floor: AutonomyLevel): boolean {
  return autonomyRank(level) >= autonomyRank(floor);
}
