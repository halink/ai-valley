> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 合成短测时限独立审查

日期：2026-11-09。范围仅为离线合成测试时限修复，不是实际模型调用或十五日验收。

## 结论

对照修复前快照，审查 `scripts/acceptance-live-guardian.mjs`、`tests/acceptance-live-probe-review.test.ts` 与对应实施说明，未发现阻断本次修复的问题。guardian 的唯一行为变更是合成情景预算由 3000/200/500 毫秒调整为 30000/1500/1500 毫秒。真实调用仍使用原协议的 195 秒外部、180 秒内部及最多 9 请求限制，worker、模型、请求发送与凭据路径未变。

原预算包含动态导入、完整 runtime 初始化、源码指纹、决定处理、同步证据落盘及重载关闭，不仅是模拟 HTTP 的耗时。已检查的修复前合成诊断显示：9 次决定已被接受，但 guardian 在 3 秒触发 TERM，并于 200 毫秒后 KILL，关闭报告缺失。修复后提供的独立合成诊断显示 supervisor 耗时约 3243 毫秒，正常零退出、无 TERM/KILL、关闭与重载核对完成、接受 9 次决定、网络尝试为 0。该对照支持原预算不足，而非把失败模型调用当成成功。

固定 30 秒预算继续在 spawn 前开始，ready 不重置时限；它也短于 transport 的 45 秒单请求超时，故 stall_headers 仍能验证外部监督器。新增测试要求运行时 ready，并区分正常 child_exit、wall_limit、SIGTERM 与同步阻塞后的 SIGKILL，避免在初始化阶段死亡却声称覆盖 HTTP 或同步阻塞。

## 独立执行

Linux，Node v24.22.1；空继承环境，预加载 offline guard。执行：

```sh
NODE=$(command -v node)
env -i "$NODE" --import ./scripts/acceptance-offline-guard.mjs \
  --import ./node_modules/tsx/dist/loader.mjs --test \
  tests/acceptance-process-supervisor*.test.ts \
  tests/acceptance-live-probe.test.ts
```

结果：55 项通过，0 失败、0 取消、0 跳过，约 15.46 秒。覆盖监督器计时/信号/清理、真实合成子进程、父进程中断和死亡、孤儿进程、离线路径保护与 live 协议单元测试。未读取 `.env`、密钥、真实存档或真实 live 输出，未调用网络、真实提供商或浏览器；未提交或推送。

本次独立执行不包含新增 17 项 `acceptance-live-probe-review.test.ts` 生命周期测试，其执行由修复作者另行报告；也不代表全量测试、build 或类型检查通过。

## 既有边界与后续建议

- 测试助手的 45 秒 watchdog 仍只是向 guardian 发 TERM，然后等待 close。若 guardian 自身事件循环永久阻塞，仍可能无界等待。该缺口在修复前已存在；本次不引入直接 KILL guardian 后可能遗留 detached worker 的新清理协议，不能把它宣传为进程树级硬停止保证。
- init_block 的 ready=false 与 SIGTERM 证明未进入 ready 状态并已清理，但没有专门的“已进入初始化阻塞循环”里程碑。极端启动变慢仍可能覆盖不到循环本身。stall_headers 与 sync_block 已有正向 ready 断言。
- 30 秒为固定工程余量，不是任意高负载机器的完成保证；超过预算仍应失败并报告。三个硬超时情景会使该文件执行时间增加约 90 秒，应接受这一明确成本，不能以删除断言或把跳过当通过来缩短。
- 合成成功不证明真实免费可用性、实际账单为零、远端取消、长期生存或完整十五日验收。费用与验收结论继续保持未知。
