# 图标来源

- 用户指定入口：[MC Icons / CC Leaf](https://mcicons.ccleaf.com/)。导入时跳转至 [CC Vaults](https://ccvaults.com/)。
- 获取时间：2026-10-07。
- 公共目录共有 3,825 项素材。仅选用公开的 Items、Blocks、Weapons 和部分 Interface 素材；未获取付费分类。
- 内置 1,448 个物品 / 方块 SVG、16 个界面 SVG。物品注册名按 minecraft-data 的 1.16.5、1.20.1、1.21.11 名称集合匹配；60 个未匹配名称使用通用图标。
- 网站原始文件为 PNG；`scripts/pixel-svg.mjs` 将同色像素段合并成路径，不嵌入位图。复杂高清素材超过 256 KB 时按 64 像素显示网格采样，保留像素风格与透明度，减少界面开销。
- `src/MCLink.App/Assets/icon-manifest.json` 逐项记录原始文件名、分类、来源 URL 和转换后名称；便携版中位于 `Assets/icon-manifest.json`。
- `unknown.svg` 是本项目绘制的通用占位图标，`MCLink.ico` 是本项目标识。

Minecraft 相关美术的权利归原权利人，网站素材适用原作者 / 网站的使用条款；转换为 SVG 不改变其权利归属。MCLink 不是 Mojang / Microsoft 官方产品。第三方素材不因随本项目分发而改用代码依赖的许可证。

自定义素材可通过运行设置中的目录导入替换；项目不上传用户素材，也不在运行时联网获取图标。
