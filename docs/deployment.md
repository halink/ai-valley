# 线上预览的发布与回滚

这份手册使用一台已配置 systemd、Caddy 和 HTTPS 的 Linux 主机作示例。运行前用部署者本地的记录核对主机、账户、端口和路径。示例使用 `/ai-valley/`，Caddy 提供固定版本的 Godot 导出，并将同源的世界快照请求转发给监听 loopback 的持久后台。

| 项目 | 示例值 |
| --- | --- |
| 预览地址 | `https://preview.example.com/ai-valley/` |
| 服务 | `valley-preview.service`，以 `valley-preview` 运行 |
| 发布目录 | `/opt/valley-preview/releases/valley-preview-<提交短号>` |
| 后台版本指针 | `/opt/valley-preview/current` |
| 原存档 | `/var/lib/valley-preview/world.sqlite` |
| 凭据 | `/etc/valley-preview/valley.env`，由 systemd 的 `LoadCredential` 加载 |
| Caddy 路由 | `/etc/caddy/sites.d/valley-preview.caddy` |
| 发布备份 | `/var/backups/valley-preview/<提交短号>/` |

## 核对配置与临时停模

示例服务从 `current` 启动编译后的 `build/server/godot-mvp-persistent-main.js`。主服务单元可指定存档、端口和模型模式，`80-model-override.conf` 可将两项备用模型配置设为空。先查当前部署的覆盖文件，再按实际生效值核验。[配置生效顺序](configuration.md#线上配置的生效顺序)

需要立即停止发出新请求时，可由管理员停止 `valley-preview.service`。世界快照入口会随服务停止，已发出的请求用量以供应商记录为准。需要继续提供观察页面时，可在现有覆盖目录创建 `/etc/systemd/system/valley-preview.service.d/90-model-mode.conf`，写入下面两行。

```ini
[Service]
Environment=VALLEY_SELF_HOSTED=disabled
```

执行 `sudo systemctl daemon-reload` 和 `sudo systemctl restart valley-preview.service`，通过[状态检查](#核对公网页面与世界)确认 `mvp.driver=disabled`、`paused=true`、`requestCount=0`。间隔数秒再次读取，确认总请求数保持相同。恢复时撤下这次添加的覆盖文件、重新加载 systemd 并重启，确认 `driver=model`、实际主备型号与预期一致、时钟和成功次数继续增长。

## 准备发布包

在构建机用目标提交的新检出执行，将 `deploy_host` 换成部署者本地的 SSH 地址或别名。发布包包含编译产物、Web 导出和运行所需的包元数据。[构建环境与模板版本](godot-web-mvp.md#构建与本机演示)

```bash
set -euo pipefail
deploy_host=operator@preview.example.com
test -z "$(git status --porcelain)"
tag=$(git rev-parse --short=7 HEAD)
npm ci
npm run build
npm run build:godot:web
test -s output/godot-web/.ready
# 如对外提供 licenses.txt，此处将本版对应的素材署名放入 output/godot-web/。
bundle=$(mktemp -d)
COPYFILE_DISABLE=1 tar -czf "$bundle/release.tar.gz" build package.json output/godot-web
node -e '
 const fs=require("node:fs"),crypto=require("node:crypto");
 for(const [source,label] of [[process.argv[1],"release.tar.gz"],["output/godot-web/index.pck","index.pck"]]){
  console.log(crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex")+"  "+label);
 }
' "$bundle/release.tar.gz" > "$bundle/checksums.txt"
incoming=$(ssh "$deploy_host" 'umask 077; mktemp -d /tmp/ai-valley-release.XXXXXXXX')
scp "$bundle/release.tar.gz" "$bundle/checksums.txt" "$deploy_host:$incoming/"
printf 'tag=%s\nincoming=%s\n' "$tag" "$incoming"
```

## 在服务器上暂存

在服务器的同一个 Bash 会话中执行后续命令。将 `tag` 和 `incoming` 设为构建机打印的值，并核对各路径与本机部署记录一致。Caddy 主配置需已导入所用路由文件。新的发布目录由 root 所有。

```bash
set -euo pipefail
[[ "$tag" =~ ^[a-f0-9]{7,12}$ ]]
[[ "$incoming" =~ ^/tmp/ai-valley-release\.[[:alnum:]]+$ ]]
app=/opt/valley-preview
unit=valley-preview.service
route=/etc/caddy/sites.d/valley-preview.caddy
database=/var/lib/valley-preview/world.sqlite
release="$app/releases/valley-preview-$tag"
archive="$incoming/release.tar.gz"
saved="/var/backups/valley-preview/$tag"
previous=$(readlink -f "$app/current")
test ! -e "$release"
sudo test ! -e "$saved"
(cd "$incoming" && sed -n '1p' checksums.txt | sha256sum -c)
tar --no-same-owner -xzf "$archive" -C "$incoming"
(cd "$incoming/output/godot-web" && sed -n '2p' "$incoming/checksums.txt" | sha256sum -c)
node --input-type=module - "$incoming" <<'NODE'
import {pathToFileURL} from 'node:url';
const root=process.argv[2];
const {assertGodotWebExport}=await import(pathToFileURL(root+'/build/server/godot-web.js'));
assertGodotWebExport(root+'/output/godot-web');
NODE
sudo install -d -m 0755 "$release"
sudo cp -a --no-preserve=ownership "$incoming/build" "$incoming/output" "$incoming/package.json" "$release/"
sudo install -m 0644 "$incoming/checksums.txt" "$release/checksums.txt"
sudo -u valley-preview test -r "$release/build/server/godot-mvp-persistent-main.js"
sudo -u caddy test -r "$release/output/godot-web/index.pck"
```

如果本版改变存档格式，切换前先用 SQLite 备份副本和独立端口启动，显式设置 `VALLEY_SELF_HOSTED=disabled`。确认副本能载入，核对世界身份、时钟、居民、库存和已有行动。真实存档继续由线上服务持有。

## 备份、切换与启动

记录切换前的快照。在维护窗口正常停止后台，使用 SQLite 备份接口保存切换点并运行完整性检查。以下命令可用 Node.js 22.23 执行。备份记录同时保留旧程序目录和旧代理路由。

```bash
sudo install -d -m 0700 "$saved"
printf '%s\n' "$previous" | sudo tee "$saved/previous-release" >/dev/null
sudo install -m 0600 "$route" "$saved/previous-route.caddy"
sudo systemctl stop "$unit"
sudo /usr/bin/node --input-type=module - "$database" "$saved/world.sqlite" <<'NODE'
import assert from 'node:assert/strict';
import {chmodSync} from 'node:fs';
import {DatabaseSync,backup} from 'node:sqlite';
import {gunzipSync} from 'node:zlib';
const [source,target]=process.argv.slice(2);
const live=new DatabaseSync(source,{readOnly:true});
try{await backup(live,target);}finally{live.close();}
chmodSync(target,0o600);
const archive=new DatabaseSync(target,{readOnly:true});
try{
  assert.equal(archive.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  const {state}=archive.prepare('SELECT state FROM worlds ORDER BY rowid DESC LIMIT 1').get();
  const w=JSON.parse(typeof state==='string'?state:gunzipSync(state).toString());
  console.log(JSON.stringify({id:w.id,minute:w.minute,requests:w.metrics.requests,successes:w.metrics.successes}));
}finally{archive.close();}
NODE
```

用 `sudoedit "$route"` 把 `file_server` 的 `root` 换成此次 `$release/output/godot-web` 的绝对路径。沿用同源路径、固定资源白名单和 `127.0.0.1:3415` 代理。校验 Caddy 配置，再原子切换后台版本并启动。若校验、启动或状态检查失败，按下文回滚。

```bash
sudo /usr/bin/caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo ln -s "$release" "$app/.current-$tag-$$"
sudo mv -Tf "$app/.current-$tag-$$" "$app/current"
sudo systemctl start "$unit"
systemctl is-active "$unit"
pid=$(systemctl show -p MainPID --value "$unit")
test "$(sudo readlink -f "/proc/$pid/cwd")" = "$release"
curl -fsS --retry 10 --retry-connrefused --retry-delay 1 --retry-max-time 15 \
  --max-time 3 http://127.0.0.1:3415/ai-town/api/world >/dev/null
```

发布与回滚都需要重载代理。启用 Caddy 管理 API 的部署可用 `caddy reload`。下例适用于 Caddy 使用文件配置、管理 API 禁用且支持 `USR1` 重载的部署。通过校验后执行并检查新日志。

```bash
cursor=$(sudo journalctl -u caddy.service -n 1 --show-cursor --no-pager | sed -n 's/^-- cursor: //p')
test -n "$cursor"
caddy_pid=$(systemctl show -p MainPID --value caddy.service)
test "$caddy_pid" -gt 1
sudo kill -USR1 "$caddy_pid"
for attempt in {1..12}; do
  logs=$(sudo journalctl -u caddy.service --after-cursor="$cursor" --no-pager)
  if grep -Fq 'successfully reloaded config from file' <<<"$logs"; then break; fi
  sleep 1
done
printf '%s\n' "$logs"
grep -Fq 'successfully reloaded config from file' <<<"$logs"
```

## 核对公网页面与世界

先把 `preview_host` 换成实际域名，从外网确认页面可打开。示例在服务器本机通过 HTTPS 代理核对完整 PCK 哈希，该代理需监听本机的 443 端口。

```bash
preview_host=preview.example.com
base="https://$preview_host/ai-valley/"
curl -fsS --max-time 8 -o /dev/null "$base"
expected=$(sha256sum "$release/output/godot-web/index.pck" | cut -d' ' -f1)
actual=$(curl -fsS --noproxy '*' --resolve "$preview_host:443:127.0.0.1" \
  --max-time 15 "${base}index.pck" | sha256sum | cut -d' ' -f1)
test "$expected" = "$actual"
curl -fsS --max-time 8 "${base}ai-town/api/world" | node -e '
  let raw="";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data",c=>raw+=c);
  process.stdin.on("end",()=>{
    const s=JSON.parse(raw),w=s.world,m=w.metrics;
    console.log(JSON.stringify({id:w.id,minute:w.minute,paused:w.clock.paused,
      driver:s.mvp.driver,primary:s.mvp.primary,backup:s.mvp.backup,
      requests:m.requests,successes:m.successes,requestCount:s.observation.model.requestCount}));
  });
'
```

核对世界 ID 与备份相同，时钟从备份时间接续。启用模型时，复查时钟及成功次数增长。记录提交号、前端哈希、备份位置和实际观察范围，留作下一次发布依据。确认发布完成后可清理本次上传目录，保留版本与存档备份。

## 回滚程序与恢复数据

程序回滚使用该次发布的 `previous-release` 和 `previous-route.caddy`。涉及存档迁移时，先用当前存档的备份副本验证旧程序兼容性。将 `tag` 设为需要撤回的发布提交短号，再执行下面命令。程序回滚继续读取当前原存档，保留发布后已经推进的进度。

```bash
set -euo pipefail
[[ "$tag" =~ ^[a-f0-9]{7,12}$ ]]
app=/opt/valley-preview
unit=valley-preview.service
route=/etc/caddy/sites.d/valley-preview.caddy
saved="/var/backups/valley-preview/$tag"
previous=$(sudo cat "$saved/previous-release")
test -s "$previous/output/godot-web/.ready"
sudo test -s "$saved/previous-route.caddy"
sudo systemctl stop "$unit"
sudo ln -s "$previous" "$app/.current-rollback-$$"
sudo mv -Tf "$app/.current-rollback-$$" "$app/current"
sudo install -m 0644 "$saved/previous-route.caddy" "$route"
sudo /usr/bin/caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl start "$unit"
release="$previous"
systemctl is-active "$unit"
curl -fsS --retry 10 --retry-connrefused --retry-delay 1 --retry-max-time 15 \
  --max-time 3 http://127.0.0.1:3415/ai-town/api/world >/dev/null
```

在同一会话重载 Caddy，按旧发布目录核对公网页面、PCK 哈希和世界状态。[Caddy 重载](#备份切换与启动) · [公开状态检查](#核对公网页面与世界)

恢复备份属于单独的数据恢复操作，会回到备份时刻。确认目标恢复点后，先停止服务，保留故障现场完整数据库目录及其 WAL 等文件。检查备份完整性和世界身份，以服务账户的所有权与 `0600` 权限放入干净的目标位置，再启动匹配版本。核对游戏时间、住户、库存和模型计数。
