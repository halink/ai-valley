# 浏览器版运行与配置

## 默认入口：临时规则 Web 演示

需要 Node.js 22.13+、Godot 4.6.3 stable 和匹配的官方 Web 导出模板。仓库根目录执行：

```sh
npm ci
npm run build:godot:web
npm run demo:godot:web
```

在服务所在电脑的浏览器打开 <http://127.0.0.1:3414>，页面自动连接；连接失败时可点击“连接／重连”。服务提供导出文件与同源只读快照。`npm run dev` / `npm run dev:web` 是同一入口的别名，只需一个进程，不再是旧 Vite 前后端双终端流程。

`npm run build` 仅检查 TypeScript 并编译后台；`npm start` 启动编译后的同一规则 Web 服务。Web 产物须另行导出。默认服务不读取 `.env`、不调用模型、不读写世界存档。端口固定为 3414，监听 loopback，重启会重建内存世界。已有密钥、`PORT` 或 `VALLEY_DB` 不会把它变成模型/持久入口。

导出输出在 `output/godot-web/`，不提交 Git。构建检查资源导入、日志与非空产物；失败撤销 `.ready` 标记，服务拒绝未确认的产物。应停服后重新构建，避免已加载浏览器混用新旧文件。[完整 Web 说明](godot-web-mvp.md)。

## 独立持久 Web 服务

此入口用于保存和恢复小世界，并可显式启用模型。它在同一 loopback 端口提供 Godot 页面和只读快照。存档锁要求后台使用 Linux 本地文件系统，远程浏览器可通过预览的 HTTPS 代理访问。

显式禁用模型的安全启动方式：

```sh
npm run build:godot:web
VALLEY_SELF_HOSTED=disabled npm run dev:web:persistent
```

它默认监听 `127.0.0.1:3415`，使用独立的 `runtime/godot-mvp/world.sqlite`。这是会创建或打开专用数据库的持久入口，不是无副作用的规则演示。不要把保存路径指向旧世界或真实存档做开发测试；不支持的世界会被拒绝，不能靠重置数据解决。

| 变量 | 持久小世界服务的用途 |
| --- | --- |
| `VALLEY_MVP_DB` | 专用 SQLite 路径，默认 `runtime/godot-mvp/world.sqlite`。 |
| `VALLEY_MVP_PORT` | loopback 端口，默认 `3415`。 |
| `VALLEY_DAY_MINUTES` | 每世界日现实分钟数，默认 20，允许 20–1440。 |
| `VALLEY_SELF_HOSTED` | 默认或 `disabled` 禁用模型并停表；`enabled` 才解析并启用显式配置。 |
| `VALLEY_PRIMARY_PROVIDER` / `VALLEY_PRIMARY_MODEL` | 主供应商与型号必须显式匹配当前解析器支持范围。 |
| `VALLEY_BACKUP_PROVIDER` / `VALLEY_BACKUP_MODEL` | 可选但须成对；不配置不隐式增加备用。 |
| `SILICONFLOW_API_KEY` / `DASHSCOPE_API_KEY` | 仅持久后台按供应商读取；不得进入 Web 资源、快照或日志。 |
| `VALLEY_ALLOW_PAID_MODELS` | 当前解析器对指定付费型号要求显式 `yes`；不是费用上限，也不证明任何型号免费。 |

手工启动时，可用 Node 的 `--env-file=.env` 显式加载配置。进程环境中的同名变量优先于该文件。线上模型按获授权的供应商、型号及费用配置运行。开发验收使用规则模式。[型号、凭据与费用设置](implementation/self-hosted-models.md)

## 线上配置的生效顺序

在 systemd 部署中，可以用 `LoadCredential` 提供凭据，再由 Node 的 `--env-file` 读取。服务单元与其覆盖文件中的 `Environment=` 先进入进程环境，优先于凭据文件中的同名值，空字符串也是有效覆盖。部署者应以本机的服务单元和覆盖文件为准。

| 配置 | 示例来源 |
| --- | --- |
| 模型运行模式 `VALLEY_SELF_HOSTED` | 如果服务单元显式设置 `enabled`，即使凭据文件写着 `disabled`，进程仍会使用 `enabled`。 |
| 主供应商、型号及密钥 | 由服务单元的 `LoadCredential` 指向部署者管理的凭据文件。修改后重启服务以加载新值。 |
| 备用供应商及型号 | 如果覆盖文件把 `VALLEY_BACKUP_PROVIDER` 与 `VALLEY_BACKUP_MODEL` 设为空，文件中的备用配置会被覆盖。 |
| 数据库与监听端口 | 可由服务单元显式设置 `VALLEY_MVP_DB` 与 `VALLEY_MVP_PORT`。 |

修改服务单元或覆盖文件后执行 `systemctl daemon-reload`，再重启并验证生效。通过世界快照的 `mvp.driver`、`mvp.primary`、`mvp.backup` 和 `observation.model.requestCount` 核对运行模式及路由。凭据文件可用 `0600` 权限保存，日常核对只需查看配置来源和状态字段。[停模与恢复步骤](deployment.md#核对配置与临时停模)

## 保存与故障恢复

正常关闭后可用同一持久入口重开专用世界，不自动补算离线时间。备份须在干净停止后复制完整专用目录，或使用经过验证的 SQLite 备份流程；不要随意复制运行中的单个数据库文件。

模型请求失败时，居民会自动再次请求，HTTP 429 按供应商和型号冷却。世界时间与正在执行的动作持续推进。重启会把存档里遗留的在途调用记为失败且用量未知，再从原游戏时间恢复。旧版的 `.self-hosted-session` 文件保留作历史记录，存档的独占锁继续约束写入。详见[自托管模型的运行与恢复](implementation/self-hosted-models.md#运行与错误)。

## 部署与验收边界

两种后台入口均监听 loopback。线上由同源 HTTPS 代理提供 Godot 导出文件和只读世界快照。发布和回滚见[线上预览运维手册](deployment.md)，实测状态与后续验收范围见[Godot 路线图](godot-migration.md#当前版本与证据)。
