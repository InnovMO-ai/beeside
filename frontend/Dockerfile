# beeside frontend — built from the repository root (npm workspaces). Build with:
#   docker build -f frontend/Dockerfile .
# The runtime image is Node with a dependency-free static server: it serves the built app with the
# security headers the SPA needs, falls back to index.html for client routes, and (optionally)
# forwards /api to the backend service when API_UPSTREAM_URL is set.
FROM node:20-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY shared/canonical-fields/package.json shared/canonical-fields/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --ignore-scripts
COPY shared/canonical-fields shared/canonical-fields
COPY frontend frontend
RUN npm run build --workspace=shared/canonical-fields && npm run build --workspace=frontend

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /repo/frontend/dist ./dist
COPY frontend/server/static-server.mjs ./static-server.mjs
EXPOSE 8080
USER node
CMD ["node", "static-server.mjs"]
