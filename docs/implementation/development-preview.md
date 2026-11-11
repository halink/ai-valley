# 隔离开发预览与贡献者入门

## 入口

- `npm run dev`：通过 `scripts/dev-preview.mjs` 启动 `src/server/preview-main.ts`，只监听 `127.0.0.1:3413`。
- `npm run dev:web`：同一启动器启动独立 Vite 配置，只监听 `127.0.0.1:5173`，只将 API 代理到 3413。前端热更新可用；后端不自动重载，改动后需手动重启。
- 不需构建即可使用两个入口。若已有构建产物，也可直接在 3413 查看 `dist`；它可能是旧构建，不能替代当前源码验证。
- `npm run dev:formal` 保留原正式热重载入口。`npm start`、`src/server/main.ts` 及原始 Vite 配置仍是正式配置，默认存档是 `runtime/formal.sqlite`，可能使用已有模型额度。

## 隔离措施

启动器以绝对 Node 路径、不使用 shell、固定脚本参数创建子进程，只保留 Windows 启动所需的 `SystemRoot`/`WINDIR`。模型密钥、凭据文件路径、`VALLEY_*`、`VITE_*`、`NODE_OPTIONS`、`NODE_PATH`、代理与 npm 配置均不传入。额外参数（数据库、端口、环境文件等）报错，不接受自选现有存档。

预览运行时不导入正式 `main.ts`，不解析环境文件或凭据。每次在仓库固定的 `runtime/dev-preview/` 下以 `mkdtemp` 新建临时目录（不受 cwd 或 TMPDIR/TMP/TEMP 影响，并拒绝路径中的符号链接），再以 `wx` 独占创建 `preview.sqlite`；没有打开或恢复已有数据库的接口。目录与文件在 POSIX 上分别以 0700 与 0600 创建。使用代码内的九人合成开局、空提供商列表和必定拒绝的模型函数，不启动运行时调度或时钟。正式种子结构不等于读取正式存档，也不代表真实居民决策已验收。

前端以 `configFile:false`、`envFile:false` 启动，不执行仓库 Vite 配置或读取 `.env*`；端口严格固定，不能意外退回正式服务默认端口。Vite 文件服务限定在仓库目录，并显式拒绝环境/密钥、Git、runtime/output、SQLite/数据库和日志路径；这不是对任意命名私密文件的内容级识别。禁用绕过文件策略的 `publicDir` 中间件；仅 favicon 和第三方声明的固定地址重写到普通静态文件路径，仍受文件策略检查。代理目标只按本机端口识别，不认证该端口的进程身份；后端若提示端口占用，应先解决冲突，不要继续把该地址当作本次预览。

正常 SIGINT/SIGTERM 关闭监听和连接后，关闭数据库并删除本次新建目录。启动监听失败也清理新目录。SIGKILL、崩溃或断电可能留下临时目录；它不会在下次启动时重用，可在确认预览进程已经停止后人工删除启动日志所示的 `ai-valley-preview-*` 目录。没有自动清扫其他目录的功能。

## 保证的边界

这是防止误用正式存档与模型的开发入口，不是操作系统沙箱、恶意代码隔离或生产级进程监督。它不防御同一账户主动修改脚本/进程/临时文件，也不能撤销 npm 或启动器运行前已由父 Node 的 `NODE_OPTIONS`、显式 `--env-file` 或 shell 预加载的行为。不要给父命令附加此类加载选项；子进程会丢弃继承的选项。直接启动其他入口、普通 `npm run build` 或自定义 Vite 命令不属于这些保证。

Vite 本身仍有开发工具的文件访问能力；不要把开发端口暴露到外网。后端只绑定本机，复用只读观察 HTTP 层。此改动没有修改 writer 的路径安全、监督器、模型计费或正式服务逻辑。

## 平台与验证

最低 Node.js 版本为 22.13.0。完整 `npm test` 依赖 Linux：证据 writer 使用 `/proc/self/fd` 与 `O_NOFOLLOW`，合成监督进程使用 `/proc` 与 POSIX 进程组。许多食物与照护集成测试也依赖 writer。macOS/原生 Windows 应将完整套件放在 Linux 或 WSL2 的 Linux 文件系统执行；没有新增跳过或放宽安全检查。

`tests/dev-preview.test.ts` 验证环境白名单、参数拒绝、前端隔离配置、新建数据库、静止世界、禁止模型与独立清理。`tests/dev-preview-review.test.ts` 为独立反例审查。仅运行这些文件属于部分离线测试，不是全仓通过，也不证明 macOS/Windows 已实测。验证不得读取真实 `.env`、密钥或存档；本次不启动正式服务、预览后端或 Vite 开发服务器，不调用外部模型或浏览器。全仓既有测试中的临时回环 HTTP 夹具不等于真实服务验收。独立审查结果见[审查记录](../reviews/development-preview.md)。

### 本次最终离线结果（2026-11-07）

- Linux、Node v24.22.1：全仓 **3546/3546** 测试通过，0 失败、0 跳过、0 取消；其中预览实现 5 项、独立审查 15 项。
- 全项目 TypeScript 检查与服务端编译通过。Vite 显式使用 `configFile:false`、`envFile:false`，构建到新临时目录，通过；仍有既有的体积较大 chunk 提示。预览 Vite 配置经 `resolveConfig` 离线解析核对，无监听启动。
- package/lock 元数据一致；209 份 Markdown 的 795 个本地文件链接目标存在，未验证标题锚点或外链；`git diff --check` 通过。
- Node 22.13 基线、macOS、Windows、浏览器视觉、真实预览监听/关闭及模型自主运行未实测。以上不替代这些验收，也没有修改其状态。
