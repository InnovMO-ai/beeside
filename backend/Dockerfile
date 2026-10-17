# beeside backend — built from the repository root (npm workspaces).
#
# The backend depends on the @beeside/canonical-fields workspace and on the root package-lock, so
# the build context is the repository, not backend/. Build with:
#   docker build -f backend/Dockerfile .
# The image runs the API by default; the same image runs the background worker
# (node dist/worker.js) and the migration job (node dist/scripts/migrate.js).
FROM node:20-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY shared/canonical-fields/package.json shared/canonical-fields/
COPY shared/fa-public-engine/package.json shared/fa-public-engine/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --ignore-scripts
COPY shared/canonical-fields shared/canonical-fields
COPY shared/fa-public-engine shared/fa-public-engine
COPY backend backend
RUN npm run build --workspace=shared/canonical-fields && npm run build --workspace=shared/fa-public-engine && npm run build --workspace=backend

FROM node:20-slim AS runtime-base
WORKDIR /repo
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY shared/canonical-fields/package.json shared/canonical-fields/
COPY shared/fa-public-engine/package.json shared/fa-public-engine/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# Production dependencies only: no build tooling, no test tooling, no frontend packages.
RUN npm ci --omit=dev --ignore-scripts --workspace=@beeside/backend --include-workspace-root \
 && npm cache clean --force
COPY --from=build /repo/shared/canonical-fields/dist shared/canonical-fields/dist
COPY --from=build /repo/shared/fa-public-engine/dist shared/fa-public-engine/dist
COPY --from=build /repo/backend/dist backend/dist
# Migrations travel with the image: the migration job applies them and the readiness probe counts them.
COPY backend/db/migrations backend/db/migrations
# Knowledge Layer: its own migrations and PDF assets (theme, fonts, logo, paginator) travel with the image (read by the kl-migrate job and kl-worker).
COPY backend/src/kl/db/migrations backend/dist/kl/db/migrations
COPY backend/src/kl/products/assets backend/dist/kl/products/assets
WORKDIR /repo/backend

# kl-worker only: Chromium for the PDF generator (B6). The API and the other jobs keep the lean image above.
FROM runtime-base AS runtime-kl-worker
USER root
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx --no-install playwright-core install --with-deps chromium \
 && chmod -R a+rX /ms-playwright \
 && rm -rf /var/lib/apt/lists/*
USER node
CMD ["node", "dist/kl/worker/kl-worker.js"]

# Default target (unchanged behavior for every existing deployment): the API image.
FROM runtime-base AS runtime
EXPOSE 8080
USER node
CMD ["node", "dist/index.js"]
