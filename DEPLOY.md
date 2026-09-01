# 部署到 wedding.ccswitch.online

服务器 107.172.225.199（RackNerd 1GB KVM）上已经跑着两套东西，
**这份文档的全部前提就是不碰它们**：

| 已有 | 占用 |
|---|---|
| `matrix-chat` | 拥有 Caddy 容器 `matrix-chat-caddy-1` 和宿主 80 / 443，Caddyfile 在 `/root/matrix-chat/Caddyfile` |
| `poker`（德扑） | 容器内 8080、TURN 的 3478 和 49160–49200/udp。**不映射宿主端口** |

婚礼站点照德扑的同一套模式接进去：不占宿主端口，加入 Caddy 那个已存在的
docker 网络，Caddy 用容器名找到它。

```
Cloudflare(仅 DNS，灰云)
        ↓
  宿主 443 → matrix-chat-caddy-1
        ↓ 同一 docker 网络
     wedding:8080
```

> 容器内的 8080 和德扑的 8080 **不冲突** —— 两个独立的网络命名空间，
> Caddy 靠容器名区分 `poker:8080` / `wedding:8080`。不用改端口。

---

## 一次性部署

```bash
git clone https://github.com/Jinzhengxu/wedding.git /root/wedding
cd /root/wedding
WEDDING_DOMAIN=wedding.ccswitch.online bash deploy/deploy.sh
```

脚本会自己做完这些：探测 Caddy 容器 / 网络 / Caddyfile 路径 → 写 `.env` →
`docker compose up -d --build` → 等容器 healthy → **备份 Caddyfile** →
整块替换站点配置 → `caddy validate`（不过就自动还原）→ `caddy reload` → 验 200。

跑完会打印管理后台地址（带 key）。

DNS 那边保持**灰云（仅 DNS）**即可，Caddy 会自动签证书、自动续期，不用 certbot。

---

## 日常

```bash
cd /root/wedding && git pull && bash deploy/deploy.sh   # 更新（幂等，随便重复跑）
docker logs -f wedding                                  # 看日志
docker compose restart wedding                          # 重启
bash deploy/deploy.sh --rollback                        # 下线并从 Caddyfile 摘掉
```

**备份宾客数据**（回执 + 留言 + 管理密钥都在 `wedding-data` 卷里）：

```bash
docker run --rm -v wedding-data:/d -v "$PWD":/b alpine \
  tar czf /b/wedding-data-$(date +%F).tar.gz -C /d .
```

婚礼前一周挂个 cron 每天跑一次。

---

## 几个坑，都已经在配置里处理了，别改回去

**`header_up X-Forwarded-For {remote_host}` 不能省。**
Caddy 默认是把客户端 IP **追加**到已有的 XFF 头后面，而 `server.js:91` 取的是
第一个值。不覆盖的话，访客自己发一个 `X-Forwarded-For: 1.2.3.4`，
`server.js:126` 的限流就形同虚设，留言墙能被一个人刷满。

**`HOST=0.0.0.0` 不能改回 127.0.0.1。**
`server.js` 默认绑回环，那是**容器自己的**回环，Caddy 容器连不上。
宿主端口没有映射，所以 0.0.0.0 的暴露面只有 docker 网络内部。

**data 目录必须是 named volume。**
不挂卷的话，下一次 `docker compose up --build` 就把所有人的回执抹了。
Dockerfile 里那句 `chown -R node:node` 也不能删 —— docker 初始化空卷时会沿用
镜像里该路径的属主，漏了容器以 node 身份跑起来写不进去，第一个提交回执的亲戚会拿到 500。

**compose 里不要加 `ports:`。**
宿主 80/443 属于 matrix-chat 的 Caddy，抢占会把 matrix 和德扑一起搞挂。

---

## 排障：站点 502 / TLS alert 80 / 证书签不下来

先分清是哪一层：

```bash
curl -I --resolve wedding.ccswitch.online:80:107.172.225.199 http://wedding.ccswitch.online/
```

- **回 308** → Caddy 认得这个域名，问题在 TLS 或上游。
- **连接直接断（curl 报 000）** → Caddy 压根不知道这个域名，看下一条。

```bash
docker exec matrix-chat-caddy-1 grep -c wedding /etc/caddy/Caddyfile
```

**宿主上的 Caddyfile 有 wedding，但这条命令输出 0 —— 这是最坑的一种。**
Caddyfile 是以【单个文件】bind mount 进 caddy 容器的，docker 挂的是 inode 不是路径。
任何用 `mv` 或「写临时文件再改名」的方式改这个文件，都会换掉 inode：
宿主这边看着改好了，容器里读到的还是旧文件。于是 `caddy validate` 和
`caddy reload` 全部「成功」，日志里只有一句 `config is unchanged`，
Caddy 从没见过这个站点，也就永远不会去签证书 —— 没有报错，没有失败记录，
什么都不会发生。

`deploy.sh` 现在一律原地覆盖（`cat a > b`），并且在 reload 前会验证容器内可见性。
如果挂载关系已经被历史操作破坏了，只有重启能修：

```bash
docker restart matrix-chat-caddy-1    # matrix / chat / 德扑会断几秒
```

证书签发过程：

```bash
docker logs -f --since 10s matrix-chat-caddy-1 | grep -iE "wedding|obtain|cert|error"
docker exec matrix-chat-caddy-1 sh -c 'ls /data/caddy/certificates/*/'   # 现有证书
```

Let's Encrypt 对同一域名验证失败有每小时 5 次上限，别盲目重试，看清错误再动。

---

## 以后若把 Cloudflare 改成橙云代理

`deploy/caddy-site.txt` 里换一行：

```caddy
header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}
```

不换的话，所有访客在服务端看起来都是同一个 Cloudflare 边缘 IP，
一个亲戚多发两条留言，全家一起被 429。

同时 Cloudflare 的 SSL 模式要设成 **Full (strict)** ——
Flexible 会和 Caddy 的自动 HTTPS 跳转打架，转成重定向循环。

---

## 上线后立刻验

```bash
curl -I https://wedding.ccswitch.online/                         # 200
curl -s https://wedding.ccswitch.online/api/wishes | head -c 120  # {"ok":true,...}
docker stats --no-stream wedding poker                           # 1GB 小机，看一眼内存
```

然后**用手机微信打开一次**。微信 X5 内核和 Chrome 表现不一样，
字体、音乐引导气泡、三个地图按钮都要在微信里真点一遍。
