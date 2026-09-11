# beeside frontend — Phase 1 skeleton image, built for Cloud Run.
# Cloud Run injects PORT at runtime; this image must listen on it, not a
# hardcoded port.
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
RUN npm install -g serve@14
COPY --from=build /app/dist ./dist
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["sh", "-c", "serve -s dist -l $PORT"]
