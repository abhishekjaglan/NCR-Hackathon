FROM node:20-alpine AS mcp-builder

WORKDIR /mcp-build

RUN npm install -g bun

COPY ./jira-mcp/package*.json ./
COPY ./jira-mcp/bun.lock* ./

RUN bun install
RUN bun add winston

COPY ./jira-mcp ./
RUN bun run build

FROM node:20-alpine

WORKDIR /app

RUN npm install -g bun

COPY --from=mcp-builder /mcp-build/build /app/jira-mcp-build
COPY --from=mcp-builder /mcp-build/node_modules /app/jira-mcp-node-modules

COPY ./jira-client/package*.json ./
RUN npm install

COPY ./jira-client/src ./src
COPY ./jira-client/.env* ./

ENV JIRA_MCP_PATH=/app/jira-mcp-build/index.js
ENV NODE_PATH=/app/jira-mcp-node-modules
ENV REDIS_HOST=redis
ENV REDIS_PORT=6379

EXPOSE 3000

CMD ["node", "src/index.cjs"]