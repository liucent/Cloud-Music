# --- 阶段 1：编译原生模块 ---
FROM node:22-alpine AS builder

WORKDIR /app

# 安装 SQLite C++ 编译环境
RUN apk add --no-cache python3 make g++ build-base

# 复制 backend 依赖配置
COPY backend/package*.json ./

# 修正：没有 package-lock.json 时，使用 npm install 代替 npm ci
RUN npm install --omit=dev

# --- 阶段 2：极简运行时 ---
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV DATA_DIR=/app/data

# 从编译阶段复制 node_modules
COPY --from=builder /app/node_modules ./node_modules
COPY backend/ ./backend/
COPY frontend/ ./frontend/

EXPOSE 3000

VOLUME ["/app/data"]

CMD ["node", "backend/server.js"]
