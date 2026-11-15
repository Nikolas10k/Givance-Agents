# syntax=docker/dockerfile:1
# Imagem do worker (Fly.io ou Railway). Build a partir da raiz do repositório:
#   docker build -f apps/worker/Dockerfile -t givance-worker .

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/tools/package.json packages/tools/
COPY packages/agents/package.json packages/agents/
COPY packages/integrations/package.json packages/integrations/
# O secret "ca" é opcional: só para builds atrás de proxy com certificado próprio
# (docker build --secret id=ca,src=/caminho/ca.crt ...). Não fica gravado na imagem.
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    pnpm install --frozen-lockfile --filter @givance/worker...
COPY tsconfig.base.json ./
COPY apps/worker apps/worker
COPY packages packages
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    pnpm --filter @givance/worker build \
    && pnpm --filter @givance/worker deploy --prod --legacy /out \
    # A imagem usa glibc (Debian): o binário musl do Claude Code (~340 MB) não é necessário.
    && rm -rf /out/node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-linux-*-musl@*

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    GIVANCE_CONTENT_DIR=/app/content \
    PORT=8080
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/worker/dist ./dist
# Cargos e prompts acompanham o deploy: editar agents/<nome>/system.md e publicar o worker.
COPY roles ./content/roles
COPY agents ./content/agents
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
