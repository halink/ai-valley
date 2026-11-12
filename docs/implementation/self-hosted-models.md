# 用户自托管模型入口

这是由部署者自己启动、观察与进行长期验证的独立入口。它不是受监督验收 runner，也没有经过真实模型或长期稳定性验收。原 `main.js` 仍禁用模型；隔离开发预览不变。

## 启动

```sh
npm run build
cp .env.example .env
# 编辑 .env，然后：
node --env-file=.env build/server/self-hosted-main.js
```

必须显式设置 `VALLEY_SELF_HOSTED=enabled`、`VALLEY_PRIMARY_PROVIDER`、`VALLEY_PRIMARY_MODEL` 和对应密钥。备用供应商与模型须成对填写 `VALLEY_BACKUP_PROVIDER`、`VALLEY_BACKUP_MODEL`；两个都留空则不使用备用，只填一个会拒绝启动。存在另一家的 key 不意味着允许使用它。配置错误在打开存档前拒绝，错误不打印配置值。

供应商只能是 `siliconflow`（中国区固定端点）或 `dashscope`（固定 Qwen 端点）。不接受自定义地址或供应商与型号错配，也不会改用另一供应商的 key。

支持的固定型号与端点：

| 型号 | 供应商 | 密钥 | 端点 |
| --- | --- | --- | --- |
| `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B` | `siliconflow` | `SILICONFLOW_API_KEY` | SiliconFlow CN `/v1/chat/completions` |
| `THUDM/GLM-Z1-9B-0414` | `siliconflow` | `SILICONFLOW_API_KEY` | 同上 |
| `qwen3.8-flash` | `dashscope` | `DASHSCOPE_API_KEY` | `https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1/chat/completions` |

Qwen 另需 `VALLEY_ALLOW_PAID_MODELS=yes`，不能默认为免费。**SiliconFlow 型号名称、空余额、配置中的声明都不能证明当前免费。** 启动前自行检查官方当日价格、账号免费资格及历史未决用量。服务没有供应商侧零费用保证或自动价格认证，不把 token 上限当费用上限。若只能接受零费用，请仅配置当日已核实免费的型号；免费资格或价格变化时停止服务。不会自动选择未配置的付费替代。

`.env` 由 Node 显式加载；程序不扫描密钥文件。不要提交 `.env`、密钥或运行存档。默认数据库为 `runtime/self-hosted.sqlite`，但模板的 `VALLEY_DB` 会覆盖该默认值，部署时请明确选择路径并备份旧档。

## 运行与错误

每次最多一个在途请求。单次 HTTP 超时沿用型号限制（Qwen 25 秒，其余 150 秒）；HTTP 重定向被拒绝，避免转发凭据到其他地址。没有 30 秒总运行上限。429 会按现有配额退避，可使用明确配置的备用。各型号的发生时间、截止时间和连续限流次数写入存档，同一型号跨正常重启维持 30 秒起、逐次翻倍、最长 15 分钟的退避，到期才允许再次请求；成功响应会清除该型号的连续限流状态，备用成功不会清除主模型冷却。其他错误（包括 401、402、5xx、超时或无法解析的结果）停表，不盲重试或自动切换。

`/ai-town/api/health` 的 `selfHosted` 明示未受监督、价格未认证、实际费用未知、主备型号及未知请求状态。它不返回密钥。世界 metrics 提供请求/成功/失败、当前型号及用量估计；这些不是供应商账单。

## 重启与未决请求

每次会话在存档旁写入 `.self-hosted-session` 标记，在首次请求前同步持久化。只有正常关闭且无在途/未知请求，才清除标记。进程崩溃、请求中退出、未知结果留下标记，下次启动拒绝。该机制是同一存档的保守防重发，不是跨主机/账号全局锁，也不是每条请求的可审计日志。

遇到 `self_hosted_unresolved_session`：停止相关进程，保留并备份存档及标记，核对供应商请求与账单后，由部署者决定是否将标记移至备份。不要未经核对直接删除它或反复换数据库绕过阻塞。若存档本身还有 `metrics.inFlight`，仍会拒绝启动；这类恢复需明确审查存档，程序不自动抹除。崩溃可能发生在确定完成后，仍保守阻塞，不宣称一定产生了费用。

与受监督候选不同，本入口没有独立 watchdog、跨进程账号 registry、逐请求 journal 或价格时效停表。不要把本入口的成功启动视为这些能力已验收。长期运行结果由部署者验证和记录。

## 持久冷却与时钟边界

冷却记录与请求失败结果在同一 SQLite 事务中提交，存档使用 WAL 与 `synchronous=FULL`。正常关闭和重启不能清除未到期冷却；断电/异常终止仍由保守会话标记阻塞，不能通过换进程自动重试。实际 SIGKILL 已合成验证，未做真实断电/硬件故障验证。

启动时发现冷却记录畸形、时间早于已记录的限流时刻会拒绝；运行中检测墙钟倒退会停表并保留标记。跨进程到期恢复依赖部署机器正确的墙钟，不能认证 NTP 或识别停机期间向前跳时；请维持系统时间准确，不通过修改时间绕过供应商限流。冷却状态是本存档/型号级，不是跨数据库或跨机器账号配额。

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

需要备用时，明确填写供应商与其支持的另一个型号。仅允许免费调用时，不启用付费开关，并在运行前核实所选 SiliconFlow 型号当前免费资格；`VALLEY_ALLOW_PAID_MODELS=no` 仅禁止已知需另行启用的 Qwen 路径，不是供应商零费用硬上限。
