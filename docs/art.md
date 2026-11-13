# 美术方向与素材许可

新版采用 **Godot 真 3D、手绘/绘本风格材质、浏览器观察**。旧像素或等距视图不再是交付目标；也不要求逐像素重现以前的概念图。

## 当前运行资源

- `godot-client/art/meadow-gouache-v1.png` 与 `plaster-gouache-v1.png`：项目内图像生成工具制作的草地/灰泥原图，实际用于场景材质。保留原始文件与元数据，不声称已验证来源签名或无缝效果。
- `painted_surfaces.gdshader` / `painted_surfaces.gd`：项目原创程序化屋顶、木材、水面、石材绘本质感，沿用仓库 MIT 许可。它们不是人工绘制的完整贴图包；静态水纹不代表模拟水流。
- `painterly_resident.gd`：原创低面数几何与顶点色，区分两位居民的轮廓，不是已完成的完整角色绑定/动画资产库。
- `godot-client/art/fonts/ValleyCJK-Regular.otf`：基于 Debian `fonts-noto-cjk` 的简体中文 face 制作的派生字体，使用 SIL Open Font License 1.1，**不是项目 MIT 美术**。来源、版权及完整许可见[字体说明](../godot-client/art/fonts/README.md)和同目录 `LICENSE.debian`。保留原 face 的全部 44,810 个 Unicode 码位，不按界面文字裁剪；移除多地区替换字形和部分可选排版功能，使用简体中文地区字形，约 11 MB。动态文字仍以原字体覆盖范围为限，不保证 emoji 或全部罕见字符。

更详细的生成、材质和几何说明见[素材记录](../godot-client/art/README.md)。最终分发必须保留第三方字体及其他实际使用依赖的许可，不因清理旧客户端而删除仍有效的 notices。

## 设计资料

[原绘本视觉提案](design/storybook-valley.md)与两张参考图保留在 `docs/design/assets/`，包括对应 prompt。这些是设计参考，不是运行截图，也不是当前 3D 结构、画面状态或功能完成的证据。新版允许在手绘风格下重新设计构图、模型和材质。

原先的像素/等距实验、合成图集和旧客户端渲染文档不代表新版资产，清理时按实际引用处理。用户参考资料与现有运行素材应区分，不以“旧视觉”一词一并删除。

## 仍需视觉验收

已导出 Web 产物，但真实浏览器 WebGL 画面尚未验收。必须实际检查屋瓦/木纹远景闪烁、光照与色彩、人物比例、选择遮挡、中文标签、室内外一致性及性能。字体加载和 headless 材质检查不能替代这些检查；也不能把概念图、合成测试图或规则动作说成最终游戏效果与真实 AI 表现。
