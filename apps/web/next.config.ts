import type { NextConfig } from 'next';

const config: NextConfig = {
  // Pacotes internos exportam TypeScript direto; o Next compila junto.
  transpilePackages: ['@givance/core', '@givance/db', '@givance/integrations'],
  poweredByHeader: false,
};

export default config;
