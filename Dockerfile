# ─── Equipe Beatriz & Rodrigo — Docs Viewer ───────────────────────────────────
# O claude CLI deve estar instalado na VPS e o AIOS_CORE_DIR montado como volume.
#
# Exemplo Coolify / Docker:
#   AIOS_CORE_DIR=/aios-core (volume montado)
#   CLAUDE_BIN=/root/.local/bin/claude (path do claude na VPS)
#
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production --no-audit --no-fund

COPY server.js ./
COPY public ./public

# docs/ e squads/ locais são usados apenas como fallback.
# Em produção, o AIOS_CORE_DIR aponta para o volume montado.
COPY squads ./squads
COPY docs ./docs

ENV NODE_ENV=production
ENV PORT=3030

EXPOSE 3030

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://localhost:3030/api/config > /dev/null || exit 1

CMD ["node", "server.js"]
