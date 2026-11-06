# 运行与配置

## 本机启动

服务默认监听 `127.0.0.1:3412`，观察入口为 `/ai-town/`。先运行 `npm ci` 和 `npm run build`，再运行 `npm start`。服务在首次打开时创建 SQLite 存档，网页会显示是否已连接居民模型。

`npm start` 从进程环境读取变量。若使用根目录的 `.env`，通过 Node 显式加载。

```sh
cp .env.example .env
node --env-file=.env build/server/main.js
```

开发时可用 `node --env-file=.env --import tsx --watch src/server/main.ts` 启动带环境文件的后端。Vite 的开发代理默认连接 `127.0.0.1:3412`。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `PORT` | 本机端口，默认 `3412`。 |
| `VALLEY_DB` | SQLite 存档路径，默认 `runtime/formal.sqlite`。相对路径以启动目录为基准。 |
| `VALLEY_DAY_MINUTES` | 每游戏日对应的现实分钟数，默认 `20`，允许 `20–1440`。 |
| `DASHSCOPE_API_KEY` | 百炼 Token Plan 的密钥，驱动主模型 `qwen3.8-flash`。 |
| `SILICONFLOW_API_KEY` | 硅基流动的密钥，驱动 `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B`。主模型不可用时可以切换。 |
| `VALLEY_DASHSCOPE_KEY_FILE` | 主模型密钥的文件路径，文件内容为密钥文本。 |
| `VALLEY_KEY_FILE` | 硅基流动凭据的 JSON 文件路径，格式为 `{"siliconflow":"你的密钥"}`。 |

环境变量中的密钥优先于文件。只配置一个提供商也可以运行，需保证该账户具备对应模型的调用权限。模型调用使用提供商账户的额度。

界面关闭后服务仍继续模拟。缺少模型配置或开局仍在等首份镇内决定时，时钟会暂停。每游戏日为 30 分钟或更短时，如果连续三分钟未收到可接受的镇内决定，且有居民已等候至少三分钟，也会保护性停表。较慢的时钟会在严重需要或临近期限时等待当事人作决定。时钟恢复后从暂停处继续。

## 自托管

以普通服务用户运行 Node，给存档目录写权限，并保留 `/ai-town/` 路径。反向代理需要支持流式传输，否则地图更新会被缓冲。例如在同一台机器上的 Caddy 配置中使用以下路由。

```caddy
your-domain.example {
    @valley path /ai-town /ai-town/*
    reverse_proxy @valley 127.0.0.1:3412 {
        flush_interval -1
    }
}
```

观察接口可以读取模拟人物的活动、意图和对话。希望仅供自己或团队观看时，在反向代理配置访问控制。新实例可指定新的存档路径。备份运行中的存档时使用 SQLite 在线备份，或停止服务后复制已完成检查点的数据库文件。升级时保留同一份存档，历史回执用于阻止交易重复结算。
