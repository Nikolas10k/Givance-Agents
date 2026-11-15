/**
 * pnpm roles:validate  -> valida roles/*.yaml e os prompts em agents/
 * pnpm roles:build     -> valida e gera supabase/seeds/10_roles.sql
 * pnpm roles:build --check -> falha se o seed estiver desatualizado (usado no CI)
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDefaultRegistry } from '@givance/tools';
import { resolveContentRoot } from '../content';
import { rolesSeedSql, validateRoles } from '../roles';

async function main() {
  const [comando, ...flags] = process.argv.slice(2);
  const root = resolveContentRoot();
  const { problems, warnings, resolved } = await validateRoles(root, createDefaultRegistry());

  for (const aviso of warnings) console.log(`aviso: ${aviso}`);
  if (problems.length > 0) {
    for (const problema of problems) console.error(`erro: ${problema}`);
    console.error(`\n${problems.length} problema(s) nos cargos.`);
    process.exit(1);
  }
  console.log(`Cargos válidos: ${resolved.map((r) => `${r.key} v${r.version}`).join(', ')}`);

  if (comando === 'gerar-seed') {
    const destino = path.join(root, 'supabase', 'seeds', '10_roles.sql');
    const sql = rolesSeedSql(resolved);
    if (flags.includes('--check')) {
      const atual = existsSync(destino) ? await readFile(destino, 'utf8') : '';
      if (atual !== sql) {
        console.error('supabase/seeds/10_roles.sql está desatualizado. Rode `pnpm roles:build`.');
        process.exit(1);
      }
      console.log('Seed de cargos atualizado.');
      return;
    }
    await writeFile(destino, sql);
    console.log(`Seed gerado em ${path.relative(root, destino)}.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
