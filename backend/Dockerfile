# beeside backend — Phase 1 skeleton image.
# Multi-stage build so production images never contain devDependencies or source maps beyond what's needed.
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 8080
USER node
CMD ["node", "dist/index.js"]
