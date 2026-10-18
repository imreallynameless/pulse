FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs relay.mjs ./
COPY web ./web
ENV HOST=0.0.0.0
ENV PORT=4317
USER node
EXPOSE 4317
CMD ["node", "server.mjs"]
