# Godot 浏览器客户端整理范围

## 唯一交付方向

当前客户端是 `godot-client/` 的 Web 导出。保留 Godot 编辑器和无界面测试只是开发工具，不构成原生桌面交付。浏览器只读观察；世界模拟、模型配置与存档属于服务端。

本轮移除旧 `src/client/` Phaser 客户端、Vite 配置、旧 HTML 入口、旧合成图集、旧美术构建工具及原生桌面启动器。npm 入口改为新的 Godot 同源 Web 服务。`npm run build` 检查并编译 TypeScript 服务；`npm run build:godot:web` 才导出浏览器产物。

旧 `preview-main.ts`（旧 dist 展示入口）和 `godot-mvp-main.ts`（独立只读 API 启动包装）也已退役，由 Godot 同源 Web 入口接替；共享 API、模拟、持久化实现不随包装删除。

## 仍需保留的代码

新小世界调用现有的真实模拟、动作核验、房间、存储和模型配置代码。它们不能因为早于 Godot 就删除。历史大世界模块仍有传递依赖，保留不代表这些功能已进入当前 MVP 或已完成浏览器验证。

用户的原绘本参考图与提示词保留为设计来源；旧等距/Phaser 专用实现文档已退役，Git 历史保留其完整版本。

## 旧测试的迁移

纯旧渲染、DOM、像素与客户端追踪测试随对应实现退役。混合测试保留真正的世界状态、权限、守恒、恢复与提交断言，不再导入旧客户端。

| 原测试/fixture | 保留后的后端回归 |
| --- | --- |
| `isometric-barn-route` | `barn-engine-route`，实际动物箱、畜舍与室内位置 |
| `isometric-clinic-route` | `clinic-engine-route`，真实共同医疗工作与结算 |
| `isometric-school-route` | `school-engine-route`，共同教学时间、材料与学费 |
| `isometric-store` / store review | `store-engine-route` / review，交易与资金守恒 |
| `isometric-lodge` | `lodge-engine-route`，厨房真实工作时间与产物 |
| `isometric-workshop` / review | `workshop-engine-route` / review，工作台、批次与真实输出 |
| barn/clinic/school review | 对应 `*-engine-route-review`，fixture 边界与附加结算断言 |
| interior review、residents 与 observer 的实际睡眠 | `home-sleep-engine-route`，进门、到床与实际休息，路径不冒充睡眠 |
| `work-feedback` | 同名测试直接核实 `workCompleted` 事实、成功失败与 memory 对应 |
| `resident-status` | 同名测试保留教学缺料恢复与施工授权到期的实际结算 |

这些都是合成、离线、有限回归，不是真实模型自主表现、浏览器 GPU 视觉验收或长期运行结论。

## 验证纪律

清理前后的全量检查必须如实记录失败；不因旧测试失败而直接删除后端断言。运行时停止现在需要持久化暂停状态，所以测试必须先停止运行时再关闭存储，并正确恢复故障注入；旧 revision 的停止不能覆盖新的存档。

Web 导出、同进程 HTTP、无界面场景与真实浏览器运行是不同验收层次。导出成功和资源返回 200 不代表 WebGL/中文/交互已经验收。
