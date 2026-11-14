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

此入口用于小世界保存/恢复与显式模型接线的工程验证，不是 `npm start`，通过同一端口提供 Godot 页面和只读快照。它只支持 Linux 本地文件系统；浏览器本身不受这个存档锁的平台限制，但默认 loopback 地址仅能在服务所在主机访问，不能直接从另一台 Mac 访问。

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

此入口不自动读取 `.env`。用户可通过 Node 的 `--env-file=.env` 显式加载已有配置；如果启用模型，可能发生外部调用和费用。文档和开发验证不代替实际调用授权、精确型号价格及账户免费状态核实。项目原有仅免费使用约束不因配置字段存在而改变。

当前实现对主/备用组合有白名单，不能凭任意供应商字符串接入所有模型。配置、费用与协议边界见[自托管模型说明](implementation/self-hosted-models.md)；该文的其他历史启动入口不应作为当前浏览器交付步骤。

## 保存与故障恢复

正常关闭后可用同一持久入口重开专用世界，不自动补算离线时间。备份须在干净停止后复制完整专用目录，或使用经过验证的 SQLite 备份流程；不要随意复制运行中的单个数据库文件。

请求结果未知、异常退出或状态未决时会保留保护标记并阻止重启，避免重复请求。遇到 `godot_mvp_unresolved_session` 应先核对请求与存档，不删除标记、关闭锁或改为 disabled 旁路保护。配置本身不证明成功调用、免费额度或计量已经结清。

## 部署与验收边界

当前规则演示和独立持久 Web 服务均已提供页面与只读快照的同源入口，但只监听本机 loopback。公开 HTTPS 与访问控制尚未交付，不提供未经验证的代理配置作为可用方案。不要暴露仓库根目录、开放通配 CORS 或把密钥送进浏览器。

已有规则、HTTP、假模型及保存/恢复检查只覆盖各自范围，不能代替实际浏览器、真实模型或长期运行验收。此前已完成有限 Firefox 检查，新增界面与光照尚未实际复查。完整验证责任与阶段边界见[版本路线](godot-migration.md)。
