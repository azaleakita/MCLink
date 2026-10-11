# Third-party components

MCLink uses Microsoft WinUI 3 / Windows App SDK and .NET, Node.js, Mineflayer,
mineflayer-pathfinder, prismarine-provider-anvil, vec3, and their dependencies. Their licenses remain
applicable to the distributed components.

The portable build includes official runtime license texts in `LICENSES/`.
JavaScript dependencies retain their own license files under
`bridge/node_modules/`. Package versions are fixed in `bridge/package-lock.json`.

- [Node.js license and bundled third-party notices](https://github.com/nodejs/node/blob/v24.15.0/LICENSE)
- [.NET runtime license](https://github.com/dotnet/runtime/blob/main/LICENSE.TXT)
- [Windows App SDK license](https://github.com/microsoft/WindowsAppSDK/blob/main/LICENSE)
- [Mineflayer](https://github.com/PrismarineJS/mineflayer)
- [Pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder)
- [Prismarine Anvil provider](https://github.com/PrismarineJS/prismarine-provider-anvil)
- [CC Leaf / CC Vaults icon source](https://mcicons.ccleaf.com/) — see `ASSET-SOURCES.md` and `Assets/icon-manifest.json`; artwork retains its original ownership and terms.

If rebuilding with another Node.js version, retain that version's official
license and third-party notices when distributing its executable.

# 可选 Minecraft 客户端模组

`client-mod/fabric-api-0.141.6+1.21.11.jar` 是 [Fabric API](https://github.com/FabricMC/fabric) 官方构建，使用 Apache License 2.0，许可与版权信息保存在该 JAR 及其内嵌模块中。MCLink 游戏聊天模组通过 Fabric 提供的客户端消息事件转发玩家指令。Fabric Loader 由用户通过启动器另行安装，没有嵌入 MCLink 应用。
