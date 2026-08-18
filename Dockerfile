# ÉtapeForge — image de production (Synology Container Manager, Docker, Podman…)
# Base glibc (bookworm-slim) : better-sqlite3 s'installe via ses binaires
# précompilés, aucun outil de compilation nécessaire.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    ETAPEFORGE_DATA_DIR=/data \
    PORT=4567

WORKDIR /app

# Dépendances d'abord (cache de build efficace).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Code applicatif (ni tests, ni docs — voir .dockerignore).
COPY backend ./backend
COPY pipeline ./pipeline
COPY frontend ./frontend
COPY scripts ./scripts

# Utilisateur non-root ; /data est le SEUL emplacement inscriptible attendu
# (base SQLite + caches) — à monter en volume.
RUN useradd --system --uid 10001 --user-group etapeforge \
    && mkdir -p /data \
    && chown etapeforge:etapeforge /data
USER etapeforge

EXPOSE 4567
VOLUME ["/data"]

HEALTHCHECK --interval=60s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4567)+'/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/server.js"]
