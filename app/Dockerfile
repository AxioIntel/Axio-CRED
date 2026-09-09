FROM node:22-alpine AS build
WORKDIR /src
COPY package*.json ./
COPY backend/package*.json backend/
COPY frontend/package*.json frontend/
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /src/package*.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/backend/dist ./backend/dist
COPY --from=build /src/backend/sql ./backend/sql
COPY --from=build /src/frontend/dist ./frontend/dist
USER node
EXPOSE 8080
CMD ["sh", "-c", "node backend/dist/migrate.js && node backend/dist/server.js"]
