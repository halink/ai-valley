# 参与开发

## 唯一交付方向

Godot 3D 浏览器版，手绘风格，小世界先行。不交付原生桌面游戏，不做移动端；Godot 编辑器及 headless 仅用于开发、导出和测试。新功能按[小版本路线](docs/godot-migration.md)递增，不以完整迁移旧系统为 MVP 前置条件。

## 开发环境与入口

需要 Node.js 22.13+、Godot 4.6.3 stable 和版本匹配的官方 Web 导出模板。使用锁定依赖：

```sh
npm ci
npm run check
npm run build:godot:web
npm run demo:godot:web
```

浏览器访问同机 `http://127.0.0.1:3414`，点击连接。此入口只运行临时规则世界，不读取 `.env`、真实存档或调用模型。它不是持久模型服务，也不是公共部署。[导出与访问说明](docs/godot-web-mvp.md)给出具体限制。

`npm run dev`、`npm run dev:web` 与 `npm run demo:godot:web` 是同一个入口的别名，只需启动一个。`npm run build` 只检查 TypeScript 并编译后台；`npm start` 启动编译后的同一规则 Web 服务。Web 导出须显式执行 `npm run build:godot:web`，不可把后台编译成功当成浏览器产物已生成。

## 测试与审查

```sh
npm run check
npm test
npm run test:godot
npm run build:godot:web
```

完整 TypeScript 测试目前要求 Linux：存档锁及部分隔离证据测试使用 `/proc/self/fd`、POSIX 进程组和安全目录文件描述符。不能删除保护、默默跳过测试或把部分套件成功写成跨平台通过。`test:godot` 检查导入和离线合成契约，不证明 WebGL 画面正确；Web 导出成功也不证明浏览器可玩。

每次交付分别记录：执行的测试、失败与未执行项、独立 review、浏览器实际画面/交互、真实模型验证。浏览器验收至少包含中文标签、材质、选择/缩放、室内外切换、刷新/断连以及与后台事实一致。不得把规则决策、假模型 transport 或合成 HTTP 回答称为真实 AI 验收。

## 文件与运行数据

所有开发、测试留在本仓库。测试使用独立合成世界和临时目录，不读取用户密钥或正式存档。`scripts/test.mjs` 与 `repository-temporary` 工具负责现有测试路径；强制停止可能留下临时输出，确认进程停止和内容可恢复后再清理，不扫除其他任务的数据。

`.env`、密钥、SQLite、运行日志、`output/`、Godot `.godot/` 缓存和导出结果不得提交。字体与其他第三方素材必须附完整来源和许可；编辑器生成的 UID 是否属于源资源应逐一审查，不能当缓存一概删去。

清理旧实现时先查依赖，再删除代码、脚本、测试和文档引用。保留当前 Godot 使用的模拟、存档和模型契约；保护用户设计资料和实际存档。不要把仓库根目录作为静态文件目录，也不要为联调开放通配 CORS 或向浏览器传递密钥。

## 交付纪律

小提交、可回退、文档同步。发布前检查敏感文件与第三方许可，核实远程分支确实更新后再报告 push 成功。阶段 tag 对应已验证的范围，不把工程原型标为完整 MVP 或 1.0。长期运行由项目所有者验证，不免除开发侧的短程回归和故障恢复检查。
