# 绘本资产管线独立审查

基线 `8bf65bf`。审查对象为新增离线 PNG codec、recipe/atlas 管线、仓库内文件 CLI 与明确标识的合成输入。审查者没有修改实现，只新增 `tests/storybook-asset-pipeline-review.test.ts`。

独立审查先检查原 v1/动画契约，再审阅实现并编写 9 项反例；未发现阻断缺陷，9/9 通过，全项目 TypeScript 检查退出 0。不是生产图片、许可证法律有效性或浏览器视觉审查。

## 独立覆盖

1. 所有五种 PNG filter 逐字节还原，包括完全透明像素内部 RGB；codec 往返不改变像素。
2. 有效 CRC 不得掩盖追加 zlib 流、额外/不足 scanline、非法 filter；IEND 后附加数据和 CRC 损坏拒绝。
3. 所有 84 个合成图块的源裁切与输出 RGBA 完全相等；80 个方向格正确映射世界方向，重建确定且返回结果不依赖后来修改的输入。
4. 实际源 hash、PNG 宽高、精确 source map 覆盖不可由元数据自证；错误 map 或改变的 PNG 拒绝。
5. 严格形状解析在执行访问器前拒绝；数组隐藏额外字段拒绝。
6. 人物不能借用另一人物的 cel、丢失 pick 冒称首批，脚点与建筑地面锚点漂移拒绝。
7. 现成 atlas 验证需真实字节 hash、尺寸与非重叠矩形，不能只看 JSON。
8. CLI 在源文件读取之前核对授权 recipe hash；源 symlink 拒绝，失败不创建候选目录。
9. CLI 重建核对报告，已有目录不覆盖，输出 symlink 与受保护设计路径拒绝。

独立命令：

```sh
env -i PATH="$PATH" "$(command -v node)" --import tsx --test tests/storybook-asset-pipeline-review.test.ts
env -i PATH="$PATH" "$(command -v node)" node_modules/typescript/bin/tsc --noEmit
```

## 范围说明

源角色声明与 hash 需要明确授权，不能代替法律权利验证，也不能识别被恶意冒称为 production-export 的概念图；工具不作为恶意本地进程或 Proxy 的沙箱。透明像素和脚点数值一致不证明真实脚底稳定或四向美术正确。所有测试均为程序合成箭头/标记，没有读取用户参考 PNG、key 或真实存档，没有联网、暂存、提交或推送。

此审查只支持离线工具与声明范围内的契约结论，不表示首批 80 帧已绘制、共屋美术已完成、生产接线或视觉/性能验收。
