# beeside frontend — built from the repository root (npm workspaces). Build with:
#   docker build -f frontend/Dockerfile .
# The runtime image is Node with a dependency-free static server: it serves the built app with the
# security headers the SPA needs, falls back to index.html for client routes, and (optionally)
# forwards /api to the backend service when API_UPSTREAM_URL is set.
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
COPY frontend frontend
# Optional build-time settings (internal staging ribbon; the public Privacy link). Empty by default: a public build sets none of the staging ones.
ARG VITE_FA4_ENV_LABEL=""
ARG VITE_FA4_PRIVACY_URL=""
ARG VITE_FA4_LAUNCH=""
# «Start Your Expansion» destination (https; supplied by Product, never defaulted) and the staging-only opt-in to the no-payment confirmation fallback.
ARG VITE_FA4_PREMIUM_PURCHASE_URL=""
ARG VITE_FA4_ALLOW_PURCHASE_FALLBACK=""
# Production under /discovery: path prefix and the discovery-only bundle (nothing of the legacy apps is reachable).
ARG VITE_BASE_PATH="/"
ARG VITE_DISCOVERY_ONLY=""
ENV VITE_FA4_ENV_LABEL=$VITE_FA4_ENV_LABEL VITE_FA4_PRIVACY_URL=$VITE_FA4_PRIVACY_URL VITE_FA4_LAUNCH=$VITE_FA4_LAUNCH VITE_FA4_PREMIUM_PURCHASE_URL=$VITE_FA4_PREMIUM_PURCHASE_URL VITE_FA4_ALLOW_PURCHASE_FALLBACK=$VITE_FA4_ALLOW_PURCHASE_FALLBACK VITE_BASE_PATH=$VITE_BASE_PATH VITE_DISCOVERY_ONLY=$VITE_DISCOVERY_ONLY
RUN npm run build --workspace=shared/canonical-fields && npm run build --workspace=shared/fa-public-engine && npm run build --workspace=frontend

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /repo/frontend/dist ./dist
COPY frontend/server/static-server.mjs ./static-server.mjs
EXPOSE 8080
USER node
CMD ["node", "static-server.mjs"]
