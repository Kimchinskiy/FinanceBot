FROM node:24-bookworm-slim AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
COPY --from=web-build /app/web/dist ./web/dist
RUN mkdir -p /app/data
ENV DB_PATH=/app/data/financebot.sqlite
EXPOSE 3000
CMD ["node", "server.js"]
