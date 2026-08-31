# 婚礼邀请函 —— 生产镜像
#
# 这个服务零依赖（只用 node: 内置模块），所以没有依赖层、没有 npm ci，
# 整个镜像就是 node:22-alpine + 几百 KB 源码 + 4MB 静态资源。
FROM node:22-alpine

# HOST 必须是 0.0.0.0：server.js 默认绑 127.0.0.1，那是【容器自己的】回环，
# 同一 docker 网络里的 Caddy 容器根本连不上。宿主端口没有映射，
# 所以 0.0.0.0 的暴露面只有这个 docker 网络内部。
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    TZ=Asia/Shanghai

WORKDIR /app

# 只拷 site/。pics/ 是 35MB 原图素材、tools/ 是构建脚本，都不该进镜像。
COPY --chown=node:node site/ ./site/

# 回执和留言写在这里，compose 里挂成 named volume。
# 必须在切 USER 之前建好并 chown：docker 初始化空卷时会沿用镜像里该路径的属主，
# 漏了这步容器以 node 身份跑起来就写不进去，第一个提交回执的亲戚会拿到 500。
RUN mkdir -p /app/site/server/data && chown -R node:node /app/site/server/data

USER node
WORKDIR /app/site

EXPOSE 8080

# server.js 没有 /healthz，用首页当探活端点。镜像里没有 curl，用 node 自带 fetch。
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 和德扑、matrix 同挤一台 1GB 小机。纯静态服务堆占用极低，64MB 老生代绰绰有余，
# 压低上限是为了让 GC 早点介入，别把整机拖进 OOM。
CMD ["node", "--max-old-space-size=64", "server/server.js"]
