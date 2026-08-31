#!/usr/bin/env bash
#
# 婚礼邀请函 —— 一键部署到已有 Caddy 的服务器
#
# 这台机器上已经跑着 matrix-chat（拥有 Caddy 和宿主 80/443）和德扑。
# 本脚本的全部设计目标就是：把婚礼站点接进去，而绝不碰那两套。
#
# 三条铁律：
#   1. 幂等 —— 重复执行结果完全一致，Caddyfile 里的站点块按标记整块替换，
#      不会越追加越多。
#   2. 不占宿主端口 —— 容器只接入 Caddy 的 docker 网络。
#   3. 改 Caddyfile 前先备份，validate 不过就自动还原，绝不 reload 一个坏配置。
#
# 用法：
#   WEDDING_DOMAIN=wedding.ccswitch.online bash deploy/deploy.sh
#   bash deploy/deploy.sh --rollback     下线容器并从 Caddyfile 移除站点块
#
# 可覆盖的环境变量：
#   CADDY_CONTAINER   Caddy 容器名（默认 matrix-chat-caddy-1）
#   CADDY_NETWORK     Caddy 所在 docker 网络名（默认自动探测）
#   CADDYFILE_HOST    宿主上的 Caddyfile 路径（默认 /root/matrix-chat/Caddyfile）
#   WEDDING_DOMAIN    站点域名（默认 wedding.ccswitch.online）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

CADDY_CONTAINER="${CADDY_CONTAINER:-matrix-chat-caddy-1}"
CADDYFILE_HOST="${CADDYFILE_HOST:-/root/matrix-chat/Caddyfile}"
CADDY_NETWORK="${CADDY_NETWORK:-}"
WEDDING_DOMAIN="${WEDDING_DOMAIN:-wedding.ccswitch.online}"

ENV_FILE="$ROOT_DIR/.env"
SITE_SNIPPET="$SCRIPT_DIR/caddy-site.txt"
BEGIN_MARK="# >>> wedding BEGIN"
END_MARK="# <<< wedding END"
BACKUP_FILE=""

c_ok=$'\033[32m'; c_warn=$'\033[33m'; c_err=$'\033[31m'; c_off=$'\033[0m'
ok()   { printf '%s✓%s %s\n' "$c_ok" "$c_off" "$*"; }
warn() { printf '%s!%s %s\n' "$c_warn" "$c_off" "$*"; }
die()  { printf '%s✗%s %s\n' "$c_err" "$c_off" "$*" >&2; exit 1; }
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

need() { command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"; }

compose() {
  if docker compose version >/dev/null 2>&1; then docker compose "$@"
  else docker-compose "$@"; fi
}

# ---------------------------------------------------------------- 探测环境
detect() {
  step "探测已有的 Caddy"
  need docker
  docker info >/dev/null 2>&1 || die "docker 跑不起来（要 root 或加入 docker 组）"

  docker inspect "$CADDY_CONTAINER" >/dev/null 2>&1 \
    || die "找不到 Caddy 容器 $CADDY_CONTAINER。用 docker ps 看一眼真实名字，再用 CADDY_CONTAINER=xxx 覆盖。"
  ok "Caddy 容器：$CADDY_CONTAINER"

  if [ -z "$CADDY_NETWORK" ]; then
    CADDY_NETWORK="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' "$CADDY_CONTAINER" | grep -v '^$' | head -1)"
    [ -n "$CADDY_NETWORK" ] || die "探测不到 Caddy 的 docker 网络，请用 CADDY_NETWORK=xxx 指定。"
  fi
  ok "docker 网络：$CADDY_NETWORK"

  [ -f "$CADDYFILE_HOST" ] \
    || die "找不到 Caddyfile：$CADDYFILE_HOST（用 CADDYFILE_HOST=xxx 覆盖）"
  ok "Caddyfile：$CADDYFILE_HOST"

  # 把网络名写进 .env 供 compose 读取（幂等：同 key 只保留一行）
  touch "$ENV_FILE"
  if grep -q '^CADDY_NETWORK=' "$ENV_FILE" 2>/dev/null; then
    awk -v v="$CADDY_NETWORK" '/^CADDY_NETWORK=/{print "CADDY_NETWORK=" v; next} {print}' \
      "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
  else
    printf 'CADDY_NETWORK=%s\n' "$CADDY_NETWORK" >> "$ENV_FILE"
  fi
  ok "已写入 $ENV_FILE"
}

# 探测 Caddyfile 在容器内的路径（读挂载表），取不到就回退 /etc/caddy/Caddyfile
caddyfile_in_container() {
  local p
  p="$(docker inspect -f '{{range .Mounts}}{{.Source}}|{{.Destination}}{{"\n"}}{{end}}' "$CADDY_CONTAINER" 2>/dev/null \
       | awk -F'|' -v s="$CADDYFILE_HOST" '$1==s {print $2; exit}')"
  printf '%s' "${p:-/etc/caddy/Caddyfile}"
}

# 生成"去掉 wedding 站点块"之后的内容到 $1
strip_block() {
  awk -v b="$BEGIN_MARK" -v e="$END_MARK" '
    index($0,b)==1 {skip=1} !skip {print} index($0,e)==1 {skip=0}
  ' "$CADDYFILE_HOST" > "$1"
}

backup_caddyfile() {
  BACKUP_FILE="${CADDYFILE_HOST}.bak.$(date +%Y%m%d-%H%M%S)"
  cp -a "$CADDYFILE_HOST" "$BACKUP_FILE"
  ok "已备份 → $BACKUP_FILE"
}

restore_caddyfile() {
  [ -n "$BACKUP_FILE" ] && [ -f "$BACKUP_FILE" ] || return 0
  cp -a "$BACKUP_FILE" "$CADDYFILE_HOST"
  warn "已还原 Caddyfile"
}

reload_caddy() {
  local inpath; inpath="$(caddyfile_in_container)"
  docker exec "$CADDY_CONTAINER" caddy validate --config "$inpath" --adapter caddyfile >/dev/null 2>&1 \
    || { restore_caddyfile; die "caddy validate 没过，已还原。手工看：docker exec $CADDY_CONTAINER caddy validate --config $inpath"; }
  docker exec "$CADDY_CONTAINER" caddy reload --config "$inpath" --adapter caddyfile >/dev/null 2>&1 \
    || { restore_caddyfile; die "caddy reload 失败，已还原。"; }
  ok "Caddy 已 reload"
}

# ---------------------------------------------------------------- 回滚
if [ "${1:-}" = "--rollback" ]; then
  detect
  step "下线容器"
  compose down || warn "compose down 有告警，继续"
  step "从 Caddyfile 移除站点块"
  if grep -qF "$BEGIN_MARK" "$CADDYFILE_HOST"; then
    backup_caddyfile
    strip_block "$CADDYFILE_HOST.new"
    mv "$CADDYFILE_HOST.new" "$CADDYFILE_HOST"
    reload_caddy
  else
    ok "Caddyfile 里本来就没有 wedding 块"
  fi
  step "完成"
  warn "数据卷 wedding-data 没有删除（里面是宾客回执）。真要删：docker volume rm wedding-data"
  exit 0
fi

# ---------------------------------------------------------------- 部署
detect

step "构建并启动容器"
compose up -d --build
ok "容器已启动"

step "等待健康检查"
deadline=$(( $(date +%s) + 60 ))
while :; do
  status="$(docker inspect -f '{{.State.Health.Status}}' wedding 2>/dev/null || echo unknown)"
  [ "$status" = "healthy" ] && { ok "容器 healthy"; break; }
  [ "$(date +%s)" -ge "$deadline" ] && {
    docker logs --tail 40 wedding || true
    die "60s 内没到 healthy（当前：$status）。日志见上。"
  }
  sleep 3
done

step "接入 Caddy"
if grep -qF "$BEGIN_MARK" "$CADDYFILE_HOST" && \
   diff -q <(awk -v b="$BEGIN_MARK" -v e="$END_MARK" 'index($0,b)==1{f=1} f{print} index($0,e)==1{f=0}' "$CADDYFILE_HOST") \
           <(sed "s/__DOMAIN__/$WEDDING_DOMAIN/g" "$SITE_SNIPPET") >/dev/null 2>&1; then
  ok "Caddyfile 里的站点块已是最新，不动它"
else
  backup_caddyfile
  strip_block "$CADDYFILE_HOST.new"
  # 去掉结尾多余空行，再追加新块
  printf '\n' >> "$CADDYFILE_HOST.new"
  sed "s/__DOMAIN__/$WEDDING_DOMAIN/g" "$SITE_SNIPPET" >> "$CADDYFILE_HOST.new"
  mv "$CADDYFILE_HOST.new" "$CADDYFILE_HOST"
  ok "站点块已写入（整块替换）"
  reload_caddy
fi

step "验证"
sleep 2
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://$WEDDING_DOMAIN/" || echo 000)"
if [ "$code" = "200" ]; then
  ok "https://$WEDDING_DOMAIN/ → 200"
else
  warn "https://$WEDDING_DOMAIN/ 返回 $code"
  warn "首次签证书要几十秒，稍等再试；一直不行看：docker logs --tail 50 $CADDY_CONTAINER"
fi

step "完成"
key="$(docker exec wedding sh -c 'cat /app/site/server/data/admin-key.txt 2>/dev/null' | tr -d '\r\n' || true)"
[ -n "$key" ] && printf '  管理后台  https://%s/admin?key=%s\n' "$WEDDING_DOMAIN" "$key"
printf '  更新     git pull && bash deploy/deploy.sh\n'
printf '  备份     docker run --rm -v wedding-data:/d -v "$PWD":/b alpine tar czf /b/wedding-data-$(date +%%F).tar.gz -C /d .\n'
