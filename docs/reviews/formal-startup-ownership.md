# 正式启动所有权独立审查

日期：2026-11-10。范围：`runtime-lock.ts`、`formal-startup.ts`、`main.ts` 与 `http.ts` 的已绑定 server 接入。仅使用仓库 `output/test-tmp/` 下新建随机夹具、合成 SQLite 与本机进程；未读取 `.env`、密钥或真实存档，未运行真实模型/浏览器，未提交或推送。

## 结论与修复项

原故障是端口冲突之前已构造 runtime、提交 revision，失败的第二实例能让第一实例持有过期 revision。现在先保留真实 HTTP socket，再持有存档 sidecar 的 SQLite 内核锁，最后才打开 WorldStore/构造 runtime；没有校验端口后释放重绑的窗口。正常重复启动、不同端口/工作目录、同时争抢、SIGKILL 恢复已通过专项和独立实测。

审查中发现一个真实的目标误选缺陷：虽然 `.runtime-lock` 自身被禁作数据库，但 `world.sqlite-journal`、`world.sqlite-wal`、`world.sqlite-shm` 未被同样排除。持有 `world.sqlite` 的 owner 后，创建空 `world.sqlite-journal` 并将它交给 `startFormalServer`，启动竟成功，把另一个世界写入原世界的 sidecar 名称。独立第八项回归已先红，错误为 `Missing expected rejection`。应在打开目录和任何文件之前保守拒绝上述 SQLite sidecar 后缀，而不是依赖已有非空文件的 SQLite header 恰好无效。父实现随后在 basename guard 中以 `/(?:\.runtime-lock|-(?:journal|wal|shm))$/i` 拒绝这些名称；独立复测已转绿，覆盖小写与混合大小写后缀。

## 独立覆盖

新增 `tests/formal-startup-review.test.ts`，不改共享实现：

1. 连续八次同进程重复申请均在额外 lock fd 打开前被拒；之后独立进程仍无法取得所有权。
2. 真实锁持有子进程被 SIGKILL 后，下一进程可取得同一个零字节 inode；没有删除锁文件、PID 判断或超时接管。
3. 对已持有锁创建合成硬链接/符号链接，拒绝路径不会释放原锁或改写目标。
4. 已运行合成正式世界遭重复启动，主数据库、WAL、SHM 字节哈希和 runtime revision 均不变；原 owner 仍阻止其他进程。
5. 损坏合成数据库启动失败两次，原字节保持，端口可重新绑定，所有权可重新取得。
6. 明确演示下述 POSIX fd 关闭边界。此项是限制的特征测试，不是“防御通过”。
7. 伪造包含零 PID、当前真实 PID 或大 PID 的旧元数据仍全部拒绝，字节与 inode 不变；不会靠 PID 信息删锁。
8. 普通 SQLite sidecar 文件名不得被当作独立 world；使用真实正式启动 API、空合成 sidecar，失败时也关闭已经启动的实例。

所有子进程用显式清空环境，只传入仓库随机目录中的 HOME/TMPDIR/TMP/TEMP。没有继承模型配置、代理、NODE_OPTIONS 或真实存档路径。夹具正常结束后仅删除自己创建的目录。

## 必须保留的边界

- **这是 Linux 本地文件系统的协作协议。** 依赖 `/proc/self/fd`、O_NOFOLLOW、目录描述符以及 SQLite/POSIX 文件锁；macOS 与原生 Windows 正式入口失败关闭。此轮未实现跨平台等价保护，不可称为跨平台发布完成。未知/网络文件系统拒绝，不允许为兼容取消保护。
- **所有写入者必须使用协议。** 旧版入口、直接 WorldStore 调用、外部 SQLite 工具不会自动取得这把锁。升级必须先停止旧实例。此修复不能证明与未改造的旧程序并行安全。
- **不能在持锁进程中随意打开后关闭 sidecar inode。** 独立实测：持有 owner 时 `openSync(owner.lockPath,'r')` 后 `closeSync(fd)`，会释放该进程的 POSIX 锁；路径与 inode 完全不变，`assertOwned()` 仍通过，而另一进程可取得锁。正常正式入口没有这类额外读取，同进程 `held` 检查也防止重复申请走到此处；但将来不得加入 `readFileSync(lockPath)` 诊断、另一个锁模块副本或其他不受控 fd 操作并仍声称锁可靠。`assertOwned()` 是路径完整性校验，不是内核持锁查询。
- **不是同 UID 恶意代码的 OS 沙箱。** 最终目录权限排除其他普通用户，祖先使用目录 fd 锚定；但持有同一 UID/目录写权限的代码仍可在校验与 WorldStore 打开之间替换最终文件，也可删除/替换锁。不得把当前 TOCTOU 限定宣称为防御任意同用户写入。正常无协作破坏的正式启动争抢不依赖这类替换。
- 零字节永久锁文件本身不表示进程活着或已死。不要清扫“过期锁”，不要按 PID 复用或经过时间作回收决定。SIGKILL 后内核自然释放，文件保留。
- 当前正式入口没有真实模型派发，专项健康检查证明 no-model/paused；这不是长期真实模型验收。

## 验证记录

初始独立七项与既有十项共同执行：17/17 通过，无跳过。随后 sidecar 误选回归单独执行：1 项按预期失败，证明此前保护缺口。最终 guard 修复后，独立重新执行上述三个测试文件：**18/18 通过，0 失败、0 跳过**（其中独立新增 8 项）。第八项由红转绿，包含 `-journal/-wal/-shm/-JOURNAL/-Wal/-ShM`，原空文件保持不变。

运行方式为清空环境、使用当前 Node 绝对路径和仓库 tsx loader，执行：

```sh
node --import ./node_modules/tsx/dist/loader.mjs --test \
  tests/formal-startup-review.test.ts \
  tests/runtime-lock.test.ts tests/formal-startup.test.ts
```

上面为测试参数示意；实际调用另外将 HOME/TMPDIR/TMP/TEMP 指向仓库本次随机工具目录。此独立审查未运行完整 `npm test`、build 或类型检查，避免并行构建窗口冲突；父任务应另报其最终结果，不可把专项通过写为全量通过。
