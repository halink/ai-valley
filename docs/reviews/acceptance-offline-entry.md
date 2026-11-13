> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 九人安全隔离离线入口审查

独立审查只读取源码及本批合成输出，没有读取 `.env`、密钥或真实存档，没有真实模型、网络请求、浏览器、提交或推送。

## 独立反例

新增 `tests/acceptance-offline-review.test.ts`，初次独立执行6/6通过：

1. 已占用目录/文件、符号链接祖先、受限存档路径拒绝，哨兵字节不变。
2. 目录能力拒绝路径穿越、重复数据库创建、关闭后写入。
3. TLS、HTTP2、DNS promises 和 fs promises 的网络/环境文件探针均在执行前拒绝。
4. 公开 CLI 不接受 `--run` / `--resume`，且不创建输出。
5. 实际 runtime 子进程的假模型终点、外层与通用报告语义分开、SQLite 重载482.5。
6. 实际 SIGKILL 子进程后保留未封口证据，不伪造终态或 worker-close。

审查指出初版只记录重载分钟而未把一致性作为成功条件。修正后已只读复核：worker 对重新加载和当前 runtime 的完整可序列化 World 分别计算键序无关 SHA-256，失败令 worker 非零退出；guardian 通过原目录能力读回有大小、普通文件、单链接及严格 schema 检查的 worker-close，并把重载成功、分钟/revision/指纹一致及真实零退出纳入终点判定。该缺口在代码层面已修正；此比较针对 JSON 持久表示，不是签名或任意同用户恶意进程的防篡改证明。

独立测试进一步增加正常路径的重载布尔值、revision 与完整指纹一致性断言，以及 `reload_mismatch` 反例：即使证据封口并到达精确终点，重载副本不一致仍须子进程非零退出，重载与终点判定保持失败。修订后的独立文件共7项；新增断言和第7项未由审查者另行执行，交由主实施者在串行最终回归中核验，不能沿用初次6/6结果当作修订后通过。

## 源码导入前检查复核

最后补入的 `acceptance-offline-preflight.mjs` 已只读复核。公开 launcher 在派生 guardian 前调用检查，guardian/worker 的 guard 在 tsx 与应用模块导入前再次调用。检查只遍历固定源码和配置范围，以目录描述符锚定路径、`O_NOFOLLOW` 拒绝符号链接，用 `fstat` 拒绝硬链接、非常规文件与超限文件；不读取源码文件内容。后续逐文件指纹仍独立采用安全读取，不用这次元数据检查替代哈希核对。该顺序修正了普通应用源码符号链接可能先被加载、后被指纹检查拒绝的缺口。

边界仍是受信任且运行中不被恶意替换的本地代码：启动器及预检自身、已安装的 tsx/Node 是引导信任基础；元数据检查和随后模块导入并非原子操作，不宣称防御同用户进程并发改写源码。新增合成源码符号链接用例由主实施者运行；本次审查未额外执行测试，也未读取链接目标内容。

## 本批主测试

`tests/acceptance-offline.test.ts` 补充原拟议协议不变、全环境清空、精确短终点、源指纹前后、0700/0600、全新DB、目录替换后锚定、受限开关、信号正常关闭、同步阻塞TERM→KILL、owner管道EOF、启动阻塞的真实墙钟限制、只读崩溃恢复、writer失败、费用未知和停止后晚到回复。

## 最终验证

2026-11-07，Linux / Node v24.22.1，使用现有本地依赖，未使用npm、浏览器、真实模型或真实存档：

- 最终类型检查 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- 最终入口两组 `node --import tsx --test --test-concurrency=1 tests/acceptance-offline*.test.ts` **23/23** 通过，主测试16项、独立测试7项，包含最后重载反例与导入前符号链接反例。
- 相关writer/集成/停止/监督/入口组的中间回归 **153/153** 通过；后加两项由上述最终23项与下述全量覆盖，不把中间153项当作最终全集。
- 完整 `tests/*.test.ts` 以 `--test-concurrency=1` 串行执行，**4,671/4,671**，0 failed、0 skipped、0 cancelled，耗时869,158ms。测试子进程使用空环境。此后未再修改源码。
- 服务端 `node node_modules/typescript/bin/tsc -p tsconfig.server.json` 通过。
- Vite API `build({envFile:false})` 在空环境与同一离线guard下通过，196模块，5.39秒。首次尝试因guard未保留 `fs.realpathSync.native` 别名失败；最终只在构建进程内将该别名指向同一个带检查的 `fs.realpathSync`，再动态导入Vite，未取消任何路径/网络拦截，也未修改已全量验证的源码。既有 **500 kB以上chunk警告仍在**，主bundle约1,424.95 kB，未宣称解决。
- 原 `prepare-nine-resident-acceptance.mjs --prepare` 再次成功。`git diff --check` 通过；新增文件另查行尾空白。
- 最终公开CLI另在全新目录独立运行一次，3次本地假模型调用，精确到482.5，完整World重载一致、证据封口读回和实际进程退出/组清理均确认；外层 `realModelExecuted=false`、`acceptancePassed=null`。

构建兼容别名的检查代码为：

```js
// 在预载 acceptance-offline-guard.mjs 的空环境构建子进程内执行。
import fs from 'node:fs';
fs.realpathSync.native = fs.realpathSync;
const { build } = await import('vite');
await build({ envFile: false });
```

所有上述证据只证明离线接线，不证明真实模型可用、远端请求取消、零费用、九人十五日生存或四季通过。
