FROM node:22-bookworm-slim AS build

WORKDIR /app

# Install browser and server build tooling only in this stage.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.js ./server.js
USER node
CMD ["node", "server.js"]
