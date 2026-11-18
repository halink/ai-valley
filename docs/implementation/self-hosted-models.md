# 用户自托管模型入口

Godot 持久服务由部署者显式配置和启动。已有原存档续跑及真实模型成功决策的观察记录，长期稳定性仍待验证。开发入口 `npm run dev` / `npm start` 使用临时规则世界。独立部署可使用下文的命令，systemd 部署可参考运维示例。[部署手册](../deployment.md) · [当前版本与证据](../godot-migration.md#当前版本与证据)

## 启动

```sh
npm run build
npm run build:godot:web
# 仅首次没有 .env 时复制模板，不覆盖已有密钥：
cp -n .env.example .env
# 编辑 .env，然后：
node --env-file=.env build/server/godot-mvp-persistent-main.js
```

必须显式设置 `VALLEY_SELF_HOSTED=enabled`、`VALLEY_PRIMARY_PROVIDER`、`VALLEY_PRIMARY_MODEL` 和对应密钥。备用供应商与模型须成对填写 `VALLEY_BACKUP_PROVIDER`、`VALLEY_BACKUP_MODEL`；两个都留空则不使用备用，只填一个会拒绝启动。存在另一家的 key 不意味着允许使用它。配置错误在打开存档前拒绝，错误不打印配置值。

供应商只能是 `siliconflow`（中国区固定端点）或 `dashscope`（固定 Qwen 端点）。不接受自定义地址或供应商与型号错配，也不会改用另一供应商的 key。

支持的固定型号与端点：

| 型号 | 供应商 | 密钥 | 端点 |
| --- | --- | --- | --- |
| `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B` | `siliconflow` | `SILICONFLOW_API_KEY` | SiliconFlow CN `/v1/chat/completions` |
| `THUDM/GLM-Z1-9B-0414` | `siliconflow` | `SILICONFLOW_API_KEY` | 同上 |
| `zai-org/GLM-5.3-Flash` | `siliconflow` | `SILICONFLOW_API_KEY` | 同上 |
| `qwen3.8-flash` | `dashscope` | `DASHSCOPE_API_KEY` | `https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1/chat/completions` |

`qwen3.8-flash` 与 `zai-org/GLM-5.3-Flash` 另需 `VALLEY_ALLOW_PAID_MODELS=yes`。GLM-5.3-Flash 通过 SiliconFlow 的非流式文本接口获取决策，并关闭思考模式。[SiliconFlow 型号公告](https://www.siliconflow.cn/news/ok5ja7brf921kgf1644yyedz) · [接口参数](https://docs.siliconflow.cn/docs/api/chat-completions-post)

**SiliconFlow 型号名称、空余额、配置中的声明都不能证明当前免费。** 启动前自行检查官方当日价格、账号免费资格及历史未决用量。服务没有供应商侧零费用保证或自动价格认证，不把 token 上限当费用上限。若只能接受零费用，请仅配置当日已核实免费的型号；免费资格或价格变化时停止服务。不会自动选择未配置的付费替代。

`.env` 由 Node 显式加载。默认数据库为 `runtime/godot-mvp/world.sqlite`，用 `VALLEY_MVP_DB` 选择专用小世界存档，用 `VALLEY_MVP_PORT` 选择 loopback 端口（默认 3415）。保存要求后台使用 Linux 本地文件系统。线上由 Caddy 为远程浏览器提供同源页面和只读快照；凭据和存档保存在服务端。[线上配置的生效顺序](../configuration.md#线上配置的生效顺序)

## 运行与错误

持久小世界最多同时发出四条模型请求，每位居民最多一条在途请求。调度同时遵守所选型号的并发上限和配额。单次 HTTP 超时沿用型号限制（Qwen 25 秒，其余 150 秒）；HTTP 重定向被拒绝，避免转发凭据到其他地址。429 会按现有配额退避，可使用明确配置的备用。各型号的发生时间、截止时间和连续限流次数写入存档，同一型号重启后遵守原冷却截止时间。等待从 30 秒起逐次翻倍，最长 15 分钟。同一批在途请求收到的多个 429 只提高一次冷却等级。该型号冷却后成功响应会清除连续限流状态。

网络超时、回复中断、其他 HTTP 错误及决定未通过校验，都会结束本次请求并让该居民在至少一秒后回到调度队列。重试使用最新世界状态，`invalid_decision` 会附上纠错反馈。世界时间和已经开始的动作照常推进，429 冷却期间也一样。用量缺失的失败会计入未知用量，已有的用量估算继续占用本地预算窗口。

`/ai-town/api/world` 的 `mvp` 与 `observation` 明示驱动模式、停表状态、主备型号及故障状态，不返回密钥。世界 metrics 提供请求/成功/失败及用量估计；这些不是供应商账单。

## 重启与未决请求

Godot 持久入口持有存档独占锁。重启时，存档中遗留的在途调用会在发出新请求前记为失败且用量未知，由居民按当前情况重新选择。已记过的失败沿用存档计数，游戏时间从保存位置继续。

旧版 `.self-hosted-session` 标记可随备份保留。新版启动以存档和当前模型配置为准，旧版已停表的存档也可以从原进度恢复。

与受监督候选不同，本入口没有独立 watchdog、跨进程账号 registry、逐请求 journal 或价格时效停表。不要把本入口的成功启动视为这些能力已验收。长期运行结果由部署者验证和记录。

## 持久冷却与时钟边界

冷却记录与请求失败结果在同一 SQLite 事务中提交，存档使用 WAL 与 `synchronous=FULL`。重启后继续遵守存档中已记录的冷却截止时间。

启动时会校验冷却记录及其时间。运行中检测到系统时间倒退会停止模拟，已保存的冷却截止时间继续生效。冷却以本存档内的模型为单位，到期时间以部署机器的系统时间为准。

## 验证

使用合成回复核对超时、断流、不完整回复、无效决定和 HTTP 错误后的重试。HTTP 429 的冷却在重启后继续生效，已配置的备用可在主模型冷却期间给出决定。Linux 临时存档检查覆盖旧停表档、在途请求计量、忽略关闭后到达的回复和同一存档的独占写入。浏览器临时预览中，合成故障序列下的时钟从第 1 天 08:38 推进到 09:07，人物继续执行行动。

并行调度用 Linux 临时存档及合成回复验证。四位居民同时派发，三次成功乱序提交，超时的居民单独重试后成功，总计五次请求、四次成功和一次失败。同批两个 HTTP 429 只记一次冷却，其他在途请求完成后，重启仍遵守该冷却。

规则模式于 2026-11-18 02:10:54.962–02:40:55.094 UTC 连续运行 1,800.123 秒，按每 500 毫秒推进 1 个游戏分钟的速度完成 3,591 步。四位居民均存活，记录 171 条事件，覆盖行走、采集、进食、饮水、休息、耕作与交谈。运行期间时钟持续推进，未出现异常库存或非有限的身体数值。本轮使用规则与合成回复验证，实际模型调用为零。

## 从旧配置迁移到显式供应商

旧的已启用配置不会自动猜测供应商。缺少声明将报 `self_hosted_primary_provider_required` 或 `self_hosted_backup_provider_required`，在打开存档和调用模型前拒绝。直接编辑现有 `.env` 增加字段，不要用模板覆盖已保存密钥。例如只配置 SiliconFlow 主模型：

```dotenv
VALLEY_SELF_HOSTED=enabled
VALLEY_PRIMARY_PROVIDER=siliconflow
VALLEY_PRIMARY_MODEL=deepseek-ai/DeepSeek-R1-0528-Qwen3-8B
VALLEY_BACKUP_PROVIDER=
VALLEY_BACKUP_MODEL=
VALLEY_ALLOW_PAID_MODELS=no
```

需要备用时，明确填写供应商与其支持的另一个型号。仅允许免费调用时，保留 `VALLEY_ALLOW_PAID_MODELS=no`，并核实所选 SiliconFlow 型号的当前免费资格。此开关只约束上文两款需显式启用的付费型号。
