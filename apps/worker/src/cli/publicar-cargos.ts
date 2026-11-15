/**
 * Publica os cargos de roles/*.yaml no banco (produção ou staging).
 *
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... pnpm roles:publish
 *
 * Versões são imutáveis: se roles/<cargo>.yaml mudou e a versão não, o comando para e pede
 * para aumentar `version`. Funcionários já contratados continuam na versão antiga.
 */
import { resolveContentRoot, roleConfigHash, validateRoles } from '@givance/agents';
import { assertOk, unwrapMaybe, type Json } from '@givance/db';
import { createServiceClient } from '@givance/db/service';
import { createDefaultRegistry } from '@givance/tools';

async function main() {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Defina SUPABASE_URL e SUPABASE_SECRET_KEY do projeto de destino.');
    process.exit(1);
  }

  const { problems, resolved } = await validateRoles(resolveContentRoot(), createDefaultRegistry());
  if (problems.length > 0) {
    for (const p of problems) console.error(`erro: ${p}`);
    process.exit(1);
  }

  const db = createServiceClient({ url, secretKey });
  let falhas = 0;
  for (const role of resolved) {
    const hash = roleConfigHash(role);
    assertOk(
      `cargo ${role.key}`,
      await db
        .from('roles')
        .upsert({ key: role.key, display_name: role.nome_exibicao, description: role.descricao }),
    );
    const existente = unwrapMaybe(
      `versão ${role.key}`,
      await db
        .from('role_versions')
        .select('config_sha256')
        .eq('role_key', role.key)
        .eq('version', role.version)
        .maybeSingle(),
    );
    if (existente) {
      if (existente.config_sha256 === hash) {
        console.log(`${role.key} v${role.version}: já publicado, sem mudanças.`);
      } else {
        falhas += 1;
        console.error(
          `${role.key} v${role.version}: já publicado com outra configuração. ` +
            `Aumente "version" em roles/${role.key}.yaml para publicar a mudança.`,
        );
      }
      continue;
    }
    assertOk(
      `publicar ${role.key}`,
      await db.from('role_versions').insert({
        role_key: role.key,
        version: role.version,
        config: role as unknown as NonNullable<Json>,
        config_sha256: hash,
      }),
    );
    console.log(`${role.key} v${role.version}: publicado.`);
  }
  process.exit(falhas > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
