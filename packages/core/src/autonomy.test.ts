import { describe, expect, it } from 'vitest';
import { isAtLeast, strictestAutonomy } from './autonomy';

describe('autonomia', () => {
  it('escolhe o nível mais restritivo', () => {
    expect(strictestAutonomy('automatico', 'confirmar')).toBe('confirmar');
    expect(strictestAutonomy('sempre_aprovar', 'automatico', 'confirmar')).toBe('sempre_aprovar');
    expect(strictestAutonomy(undefined, null, 'automatico')).toBe('automatico');
    expect(strictestAutonomy()).toBe('automatico');
  });

  it('compara pisos', () => {
    expect(isAtLeast('sempre_aprovar', 'confirmar')).toBe(true);
    expect(isAtLeast('confirmar', 'confirmar')).toBe(true);
    expect(isAtLeast('automatico', 'confirmar')).toBe(false);
  });
});
