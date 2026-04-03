FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache python3 make g++ vips-dev

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p logs uploads/products uploads/avatars
EXPOSE 5000
USER node
CMD ["node", "server.js"]
