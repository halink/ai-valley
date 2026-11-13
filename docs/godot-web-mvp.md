# Godot 浏览器 MVP 最小入口

新版唯一交付目标是浏览器观察，不要求玩家安装 Godot。Godot 编辑器只是开发和导出工具；旧 Phaser/Vite 入口和原生桌面启动器已移除，不再作为替代运行方式。

## 架构

- Godot Web/ WebAssembly 显示 3D 世界；Node 服务维护世界和提供只读快照。
- Web 客户端固定连接页面同源的 `/ai-town/api/world`。浏览器版隐藏 localhost 预设，不会连接访问者电脑上的另一个后台。
- 当前最小入口是**规则驱动、临时内存世界**，不读取 `.env`、不保存世界、不调用任何模型。刷新页面不重置服务端世界，重启服务则重置。
- 持久化由单独的同源服务承担。服务器运行 Linux 时，不要求访问者 Mac 解决 Linux 存档锁问题。

## 构建与本机演示

需要 Node >=22.13、Godot **4.6.3 stable** 和该版本的官方 export templates。模板使用 Godot 正常安装位置，或通过 `XDG_DATA_HOME` 指定安装它的目录；不得将机器专属绝对路径提交入库。

```sh
npm ci
npm run build:godot:web
npm run demo:godot:web
# 在浏览器打开 http://127.0.0.1:3414
# 页面自动读取同源世界快照；“连接／重连”仅用于手动重试
```

`npm run dev`、`npm run dev:web` 与 `npm run demo:godot:web` 是同一规则 Web 入口，只需运行一个。`npm run build` 仅检查 TypeScript 并编译后台，`npm start` 启动编译后的同一服务；Web 导出仍须独立执行。

`build:godot:web` 执行资源导入和 Web release 导出到 `output/godot-web/`；该目录被 Git 忽略。Web preset 使用 Compatibility、关闭多线程和 PWA，不依赖 SharedArrayBuffer/跨域隔离响应头。WebGL 2、WebAssembly 支持仍需浏览器验证。

演示服务只监听 loopback，只提供导出文件白名单和只读快照，不能把仓库根目录作为静态目录。没有通配 CORS，也没有动作控制 API。不要把模型密钥、`.env`、SQLite、运行日志加入 Web 导出目录或包。

## 验证边界

2026-11-13 最小改造：实际 Web release 导出通过，静态 HTTP/同源快照合成测试通过。构建成功不等于浏览器渲染通过；真实 WebGL 材质、中文字体、鼠标选择/缩放/室内观察、刷新/断连和长期稳定性须单独记录结果。

尚未完成：持久 Web 的真实浏览器验收、公开 HTTPS 部署及访问控制、真实模型验收。这个本机规则入口不是已发布游戏，不是可长期运行版本。不提供原生桌面游戏的交付或启动流程。

2026-11-13 后续浏览器实测：重新校验官方 4.6.3 模板 SHA512，后台编译与 Web release 导出通过。命令执行工具中启动的长期服务虽然报告监听成功，但另一个命令会话与浏览器连接被拒绝；在云桌面终端中启动同一编译后的规则服务后，浏览器成功加载 `http://127.0.0.1:3414/`。这解决了本次连接入口问题，不需要开放外部监听或修改 CORS。

浏览器页面随后明确报告：`The following features required to run Godot projects on the Web are missing: WebGL2`。当前阻碍是该云浏览器未提供 WebGL2，**不是已经完成 3D 画面或交互验收**。未修改浏览器安全设置、启用不安全渲染参数或调用模型。应在提供 WebGL2 的浏览器中继续验收，不能用 headless 导出或 HTTP 成功代替。

随后按项目所有者要求，从 Google 官方下载源安装独立 **Google Chrome 157.0.8103.78**，使用单独用户目录启动并打开同一规则页面。Chrome 窗口同样显示缺少 WebGL2；因此更换这一浏览器未解决当前云环境的图形能力问题。安装包、程序与配置只放在被 Git 忽略的 `output/`，未关闭沙箱、未修改安全设置，也未启用不安全 SwiftShader 回退。此结果不代表其他电脑上的 Chrome 无法运行。

### Firefox 首轮实际交互（2026-11-13）

随后在同一云电脑安装 Mozilla 官方 **Firefox 160.0**，默认图形设置成功加载 Godot 3D 场景。已实际观察室外房屋、河道、居民和中文文字，点击连接取得持续更新的规则快照，验证下一位居民、住宅内部切换、滚轮缩放。没有降低浏览器安全设置，没有调用真实模型。此前 Chromium/Chrome 缺少 WebGL2 的记录仍成立，但不再是整个云电脑无法显示游戏。

根据画面检查，观察面板收窄为 330 个逻辑像素，提供收起/展开；按钮使用两列，需求与库存数值最多显示一位小数，居民详情不再重复完整模型诊断。完整模型状态仍可通过“模型诊断”展开，断连时仍清为未知。重导出后在 Firefox 实际确认按钮不溢出、居民数值无长尾、折叠后仅保留标题条且可重新展开。后台编译与 Web 导出通过，进行了只读代码 review；未新增或运行自动化测试。

这只是规则 MVP 的有限浏览器检查，不代表完整视觉质量、长期稳定性或真实模型验收通过。

### 启动后仍然连接被拒绝

保留服务终端打开，让浏览器与服务在同一台电脑的可互通会话中运行。先完成两次构建，再在该电脑的普通终端执行：

```sh
npm start
# 等待 Godot browser RULE demo 启动消息，保持终端打开
```

若桌面终端提示 `npm: command not found`，是该终端的 Node.js PATH 未配置，不是游戏服务已启动。使用已安装 Node.js 的终端，或通过该安装的 `node` 启动 `build/server/godot-web-main.js`；不要把其他机器的 localhost 当作本机地址。浏览器若已显示 Godot 的 WebGL2 错误，则 HTTP 连接已经成功，重试端口或放宽网络访问不能解决图形能力缺失。

已捆绑有 OFL 许可的基于 Noto CJK 的 Valley CJK 派生字体（保留原简体中文 face 的全部码位，地区字形采用 SC）供界面和 3D 标签使用，避免浏览器依赖宿主系统字体。构建使用 `.ready` 标记，失败重建会撤销标记并拒绝继续提供静态产物；请仍停服后重建，避免客户端加载混合版本。

## 独立持久 Web 入口（Linux 后台）

先导出页面，再显式启动保存世界的服务：

```sh
npm run build:godot:web
VALLEY_SELF_HOSTED=disabled npm run dev:web:persistent
# 浏览器打开 http://127.0.0.1:3415
```

编译部署时先运行 `npm run build`，再用 `VALLEY_SELF_HOSTED=disabled npm run start:web:persistent`。默认演示命令不变。持久入口使用专用 SQLite，并在重启后恢复世界；模型未启用时停表，没有规则回退。不自动读取 `.env`。模型启用必须由运行者显式配置，详见[配置说明](configuration.md)。不要用真实存档做开发测试。

启动先核验导出标记和 HTML/JS/WASM/PCK 文件，再取得存档锁、恢复数据库或启动模型。页面与 API 共用 loopback 端口，没有新增跨域许可、外部监听或写操作 API。此整合不改变既有 Linux 锁、未决请求阻断和失败关闭行为。若运行时导出标记丢失，静态页面返回404；后台世界继续保存/模拟，不因页面缺失自动切换或清空存档。重建前应先干净停服。

合成 HTTP 和存档/重启测试不是 WebGL 或真实模型验证；公开远程访问需要另行设计 HTTPS、访问控制与部署，不应直接扩大监听地址。
