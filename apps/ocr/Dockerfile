# syntax=docker/dockerfile:1.7
# Serviço de OCR da Ágora (RIA-08): Tesseract em português + Poppler (pdftoppm), sem dependências npm.
# Construir a partir da raiz do monorepo:
#   docker build -f apps/ocr/Dockerfile -t agora-ocr:1.0.0 apps/ocr
# Só a API da Ágora fala com ele, pela rede interna (AGORA_OCR_URL=http://ocr:8080). Não precisa de internet.

ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}

RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-por poppler-utils \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    OCR_PORTA=8080 \
    OCR_HOST=0.0.0.0 \
    OMP_THREAD_LIMIT=1

WORKDIR /app
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node src ./src
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.OCR_PORTA||8080)+'/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
STOPSIGNAL SIGTERM
CMD ["node", "src/servidor.ts"]
