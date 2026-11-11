# 有伤幼儿再次干地撤险：独立复核

## 结论

本次修复通过独立复核，审查范围内没有发现新增阻断问题。新增独立测试 **58/58 通过**；与有伤幼儿主测试、原干地撤险、成人紧急撤险及室内外监护撤险的主测试和审查测试联合运行，**208/208 通过**，零失败、零取消、零跳过。

实际执行了完整复现链：首次从真实位置接出并送达干地；新的洪水覆盖该落脚点；等待 24 分钟，幼儿实际损失 1 健康并生成 severity 约 2.15 的病例；从真实最终菜单再次选择，完成第二次接出、步行和送达。第二次运输有独立记录，各耗一次监护人的布料与清水，没有使用药剂、增加治疗量、安排预约、床位或住所，也没有恢复幼儿的一般决定能力。

## 范围与隔离

阅读 `guardian-evacuation.ts`、`medical-transport.ts`、`health-opportunities.ts`，并检查医疗病例定义、真实动作执行顺序、房间/户外移动及既有干地测试。仓库与已检查的上级没有 `AGENTS.md` 或仓库技能文件；遵守贡献指南和本次明确约束。

只创建隔离测试世界，天气显式关闭，数据库仅使用 `WorldStore(':memory:')`。没有读取密钥、环境文件、真实存档或私人运行日志，没有调用真实模型、浏览器、npm，没有安装依赖或提交、推送。联合测试中的运行时测试使用已有离线请求桩。

本审查仅新增：

- `tests/injured-child-evacuation-review.test.ts`
- `docs/reviews/injured-child-evacuation.md`

未修改实现或主测试，也未改动既有工作区变更。

## 已验证的边界

### 伤情与健康

- injury、illness 的 severity 2.15、19.999、20、49.999 保留有限干地选择，health 45 为包含的最低边界。
- health 44.999、severity 50/85、低 severity 的 critical stage、任一额外严重病例均拒绝。
- 使用病例自己的 severeSeverity、criticalSeverity 和 criticalHealth；较严格的病例规则不会被默认阈值覆盖。
- 较高的自定义 severeSeverity 不放宽默认 50 上限；旧病例缺少 rules 时按其绑定 definition 回退，不随当前 active definition 改变。
- 已 resolved 的严重历史不阻碍另一轻症病例；非有限健康/伤情、负 severity、NaN 规则安全拒绝。

### 全程重验

- 从菜单选择后、正式接出前恶化，在室内和室外都不扣接出资源、不移动幼儿。
- 已接出后健康下降、伤情跨阈值、出现 critical stage、新增严重病例或病例阈值变化，停止在最后真实位置。
- 已经步行到目标干地但尚未记录送达时，仍重验伤情；出现 critical stage 不会被登记为已完成撤险。
- 新危险覆盖绑定目标时停止，不自动换目的地。接出后原危险消退仍可完成原有的有限幼儿护送，这是既有幼儿撤险语义，没有套用成人分支的不同终止规则。

### 权限、拒绝和资源

- 现任监护、幼儿拒绝、护送人决定/表达能力及体力限制继续有效，失效时不再移动。
- 有表达能力但无一般决定能力的受伤幼儿，仍从真实有限菜单立即停止自己的运输，不增加一般决定权限。
- 轻伤没有增加普通医疗或已知地址床位菜单；severity 25 原本已有的稳定处理入口仍由原规则控制，没有通过干地选择新增权限。
- 混合建筑、同意提议、稳定治疗、伪装成人权限或远程目标的动作被拒绝。
- 同时篡改持久运输记录与动作中的接收建筑，也不能把无床干地运输变为床位接收。
- 历次成功送达不是后续常设权限；没有新危险或新决定时不会自行重新搬运。

### 持久化

- 等待接出、正在室内退出和已走一个户外边的阶段经过内存 SQLite 重载后，病例、真实位置及原移动预算保留，最终送达且只扣一次接出资源。
- 重载后的待接出幼儿新增严重疾病，会在实际位置停止且不耗接出资源。
- 已取消的运输重载后保持终止，没有自动恢复运输或重复收费。

## 验证命令和结果

首轮独立测试：50/50 通过，2.82 秒。补足边界后的联合运行：208/208 通过，3.37 秒，其中独立新增 58 项。

```sh
node --import tsx --test \
  tests/injured-child-evacuation-review.test.ts \
  tests/injured-child-evacuation.test.ts \
  tests/safe-ground-evacuation.test.ts \
  tests/safe-ground-evacuation-review.test.ts \
  tests/adult-emergency-evacuation.test.ts \
  tests/adult-emergency-evacuation-review.test.ts \
  tests/guardian-evacuation.test.ts \
  tests/guardian-evacuation-review.test.ts \
  tests/indoor-guardian-evacuation.test.ts \
  tests/indoor-guardian-evacuation-review.test.ts
node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

完整 TypeScript 无输出通过，`git diff --check` 通过。这里的联合专项与类型检查不替代全仓测试、生产构建、浏览器或真实模型验收；这些不是本独立审查的完成声明。
