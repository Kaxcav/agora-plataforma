# syntax=docker/dockerfile:1.7
# Ágora — imagem única (API + front-end estático). Construir a partir da raiz do monorepo:
#   docker build -f deploy/Dockerfile -t agora:1.0.0 .

ARG NODE_IMAGE=node:24-alpine

# 1) Dependências completas para compilar
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY packages/dominio/package.json packages/dominio/
COPY packages/contratos/package.json packages/contratos/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund --foreground-scripts

# 2) Compilação (domínio, contratos, web, api)
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm run build

# 3) Somente dependências de produção
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY packages/dominio/package.json packages/dominio/
COPY packages/contratos/package.json packages/contratos/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace @agora/api --no-audit --no-fund --ignore-scripts

# 4) Execução: usuário sem privilégios, sistema de arquivos somente leitura
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    AGORA_PORTA=3000 \
    AGORA_HOST=0.0.0.0 \
    AGORA_DADOS_DIR=/tmp/agora
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/packages/dominio/package.json ./packages/dominio/package.json
COPY --from=build --chown=node:node /app/packages/dominio/dist ./packages/dominio/dist
COPY --from=build --chown=node:node /app/packages/contratos/package.json ./packages/contratos/package.json
COPY --from=build --chown=node:node /app/packages/contratos/dist ./packages/contratos/dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/migracoes ./apps/api/migracoes
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
# Ponto de montagem dos documentos do processo (AGORA_ARQUIVOS_DIR), gravável pelo usuário sem privilégios.
RUN mkdir -p /var/lib/agora/arquivos && chown -R node:node /var/lib/agora
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.AGORA_PORTA||3000)+'/saude/vivo').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
STOPSIGNAL SIGTERM
CMD ["node", "apps/api/dist/servidor.js"]
