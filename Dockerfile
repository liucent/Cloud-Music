# ================= 第一阶段：依赖下载 =================
FROM node:20-alpine AS installer
WORKDIR /app
COPY backend/package.json ./
# 仅安装生产环境依赖
RUN npm install --production --registry=https://registry.npmmirror.com

# ================= 第二阶段：极限压缩镜像 =================
FROM node:20-alpine AS runner
WORKDIR /app

# 设置容器内的生产环境标识
ENV NODE_ENV=production

# 复制前端资源
COPY frontend/ ./frontend/

# 复制后端核心逻辑与依赖
COPY backend/server.js ./backend/
COPY --from=installer /app/node_modules ./backend/node_modules

# 声明匿名卷，并在启动前确保其存在
RUN mkdir -p /app/backend/data

EXPOSE 3000
WORKDIR /app/backend

# 启动 Node.js
CMD ["node", "server.js"]