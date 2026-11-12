# 正式绘本UI与开发渲染入口隔离：CI 修复

日期：2026-11-12。

## 失败原因与修复范围

正式绘本UI接入后，远端完整 CI 的四个既有源码隔离断言仍以 `storybook-` 一概禁止，误拒已正式启用的 `storybook-ui-shell`。涉及 `storybook-animation-wiring`、`storybook-development-preview`、`storybook-geometry`、`storybook-prototype`；此前 UI/等距定向集未覆盖这四项，本次明确补跑全部 `storybook*.test.ts`，不以定向通过替代远端完整CI。

四处断言改用统一 TypeScript AST 边界检查，而非删除隔离或排除失败文件：

- 只有 `main.ts` 可引用精确的 `./storybook-ui-shell.js` 和 `./storybook-ui-shell.css`；其他原入口仍无该白名单。不同目录、查询后缀、伪相似名、`.ts` 源入口均不放行。
- 开发预览、动画、合成资产、Phaser 样板及未知未来 `storybook-*` 默认拒绝。检查静态/动态import、re-export、require、类型引用、URL/Worker资产字符串路径与插值模板；无法静态核验的动态模块引用或URL参数拒绝。
- 纯注释不算依赖。转义路径、动态拼接、死分支、type-only及伪白名单都有防退化反例。
- 实际生产构建核对**全部chunk**中的模块，包括延迟加载，只允许本仓库 `src/client/storybook-ui-shell.ts` / `.css` 两个精确绝对路径；另检查发出的资产名，防止URL/worker开发资产漏入。
- 原有世界 GET/SSE/Game 数量、模型/存档/写世界/计时器禁项断言原样保留。

## 可复现验证

```sh
node --import tsx --test --test-concurrency=2 --test-timeout=120000 tests/storybook*.test.ts tests/client-bundle.test.ts
npm run check
git diff --check
```

完整绘本相关集与隔离 Vite 生产构建 **364/364 通过**（37秒），失败/取消/跳过均0。构建显式设置 `configFile:false, envFile:false`，未读取 `.env`。日志 `output/ui-boundary-all-storybook.log`。单独 `npm run check` 返回0（`output/ui-boundary-typecheck.log`），`git diff --check` 通过。

独立审查复跑四个原失败文件、新边界测试与生产构建 **49/49 通过**，并独立验证URL/Worker、ImportType、查询后缀等绕过反例被拒，正式精确shell入口仍可用。没有发现隔离弱化。

本次仅修改测试边界及文档，不改变游戏运行代码、地图、模型或存档。不代表真实浏览器/触控验收；新的远端CI结果应在修复同步后另行核实。
