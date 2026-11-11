# 素材来源 / Art credits

栖谷的地图、建筑、角色、动物和室内道具由程序绘制。公开源码包中唯一独立的图形文件是项目的 SVG 图标。程序没有加载游戏贴图、字体包或音频。

画面设计参考了 ConcernedApe 的《星露谷物语》。部分季节、建筑和界面色值取样自公开参考图。以下是美术研究使用的图源。

- 地形与季节参考。[官方截图](https://www.stardewvalley.net/wp-content/uploads/2012/04/StardewValley_5.png) · [标准农场](https://stardewvalleywiki.com/File:Standard_Farm.png) · [农场示例](https://stardewvalleywiki.com/File:Taro_standard_farm.png) · [星露谷展览会](https://stardewvalleywiki.com/File:StardewValleyFair.png) · [冰雪节](https://stardewvalleywiki.com/File:Festival_of_Ice.png)
- 建筑、物品与界面色值参考。[木匠铺](https://stardewvalleywiki.com/File:Carpenter%27s_Shop.png) · [林间农舍室内](https://stardewvalleywiki.com/File:Forest_Farmhouse_Interior.png) · [库存界面](https://stardewvalleywiki.com/File:Inventory_Parts.png) · [美洲大树莓](https://stardewvalleywiki.com/File:Salmonberry.png) · [罗宾](https://stardewvalleywiki.com/File:Robin.png) · [石头](https://stardewvalleywiki.com/File:Stone.png) · [防风草](https://stardewvalleywiki.com/File:Parsnip.png)

参考图和 Wiki 研究材料不随本项目分发。项目的 MIT 许可证适用于原创源码与文档，第三方作品仍适用各自的权利与条款。[《星露谷物语》官网](https://www.stardewvalley.net/) · [Wiki 版权条款](https://stardewvalleywiki.com/Stardew_Valley_Wiki:Copyrights)

现场劳作现使用原创的四相位、四方向程序像素姿态，沿用现有材料与人物色板。[动作范围与离线验证](implementation/visible-work-actions.md)；静态绘制表不代表浏览器运行画面已视觉验收。

另有[固定斜俯视等距小样板](implementation/isometric-study.md)，将同一套程序像素色板用于菱形地表、房屋双面、树木与现场劳动。它是独立合成审视图，没有替换正式视图；源码原生静态图不代表浏览器运行画面已验收。

可选连续等距视图另接通[生灵与墓位程序美术](implementation/isometric-living-observer.md)：六种野兽、五种家畜、七种已登记鱼种的群体示意及空/预留/已葬墓位。图形保留真实记录ID与位置；物种通用色板不代表个体未记录的花色。昼夜与相位PNG来自合成夹具的源码原生像素，不是浏览器截图。

[共屋室内与普通烹饪](implementation/isometric-lodge-cooking.md)复用真实房间及家具槽位，在普通 `cook` 真正到厨房且仍有工时时显示原创手臂相位，不添加未经记录的火、锅具、原料或产出。可复现的房间与四相位近景PNG来自普通引擎合成快照，不是浏览器、触屏或GPU验收。
