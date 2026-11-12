# PNG 来源保留导入审查

范围：离线绘本源素材 `caBX` 容器兼容；不涉及生产图替换、模型调用或真实存档。

- 只新增显式源导入模式，默认 decoder 仍拒绝 caBX。
- PNG 签名、头、CRC、长度、RGBA8、连续 IDAT、inflate 消耗与输出上限、IEND 尾部约束继续生效。
- caBX 单块、1–8,000,000 字节，原文不执行、不解析内层、不联网；未知块并未一起放行。
- 原图以完整 SHA256 命名保留，报告含原始源声明及块哈希；atlas 不复制旧的内容签名。
- 无 caBX 的历史输出保持不变。图像格式合格不代表美术合格。

独立审查补充 `tests/storybook-provenance-review.test.ts`：IDAT 分割、大小写、CRC、IHDR 顺序；实际 CLI build/verify；原图篡改/缺失；原图未修改；衍生图无 caBX。未发现阻断问题。

验证：PNG/资产管线/密度/来源保留聚焦回归 71/71；TypeScript 检查通过。
C2PA/JUMBF 签名、信任链、生成厂商身份未验证，不应将 `opaque-unverified` 描述成来源认证。
真实候选导入不构成视觉或长期运行验收。

全量验证边界：本次 `output/provenance-full-tests.log` 已结束，共 6514 项，6509 通过、3 失败、2 取消，不能描述为全量通过。3 项失败涉及合成模型连续运行进程身份检查（`synthetic_process_identity_mismatch`）；2 项取消为连续运行回滚及进程 loader 测试超时。根因尚未完成隔离，不能归因为环境或忽略，也不是实际模型验收。
