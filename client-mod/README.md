# MCLink 游戏聊天模组（Java 1.21.11）

此模组装在你操作的 Minecraft 客户端中，把 `/AI指令` 转发成 `/msg 机器人名 /AI指令`。服务器无需额外插件，单人世界对局域网开放即可使用。

## 安装

1. 在启动器中新建 **Minecraft 1.21.11 + Fabric** 实例（Fabric Loader 0.18.0 或更高），使用 Java 21。PCL 等启动器可在版本安装页面选择 Fabric；官方启动器使用 [Fabric 官方安装器](https://fabricmc.net/use/installer/)。保留原来的原版实例即可。
2. 将新版 MCLink 文件夹中 `client-mod` 目录下的两个 JAR：`mclink-chat-1.21.11-0.4.0.jar` 和 `fabric-api-0.141.6+1.21.11.jar`，复制到该实例的 `mods` 文件夹。开启版本隔离的启动器必须使用该实例的 `mods`，而不是共用目录。
3. 用此 Fabric 实例打开你的世界，照常对局域网开放，再用 MCLink 连接。工作台选择已保存的模型 API，并在运行设置中开启「自动回应玩家聊天」。
4. 机器人名默认 `MCLinkBot`。如果 MCLink 的游戏连接使用其他名字，在游戏中输入 `/mclink bot 实际机器人名`。设置会保存在该实例的 `config/mclink-chat.json`。

## 使用

| 输入 | 行为 |
| --- | --- |
| `你好，你背包里有什么？` | 普通聊天；AI 根据当前世界数据回复，空闲时也可聊天 |
| `/采集4个橡木，然后做工作台` | AI 任务；替换当前任务 |
| `/跟着我` | AI 任务 |
| `/停止` 或 `/stop` | 立即取消 AI 任务和操作，无需等待模型 |
| `/mclink` | 查看转发状态与机器人名 |
| `/mclink bot OtherBot` | 修改接收指令的机器人名 |
| `/mclink off` / `/mclink on` | 关闭 / 开启转发；关闭后 `/` 恢复原版命令 |
| `/mc time set day` | 发送原版 `/time set day`，仍需原来的游戏权限 |

转发开启时，除 `/mclink` 设置和 `/mc` 原版命令入口外，所有以 `/` 开头的输入都作为 AI 指令。普通聊天不会启动采集、移动等动作。AI 的回复以机器人玩家身份发到公共聊天栏。

机器人必须已经出现在玩家列表中，否则模组会在本地聊天栏提示先连接机器人。长指令会提示缩短，不会拆成多条任务。模组不访问 AI API，不保存或读取 API Key。

如果继续使用完全原版的 Minecraft，也可普通聊天；AI 指令请用 `/msg MCLinkBot /采集4个橡木`，停止用 `/msg MCLinkBot /停止`。原版 `/采集4个橡木` 会被当作服务器命令，无法交给机器人。

## 重新构建

在 MCLink 源码根目录运行 `./build-client-mod.ps1`。需要 Java 21 JDK；脚本优先使用 `JAVA_HOME`、PATH 中的 `javac`，或本机 Minecraft runtime 下的 JDK 21。脚本下载并验证 Gradle 9.2.1，构建模组，将两个 JAR 和此说明复制到 `dist/MCLink/client-mod`。

依据：[Fabric 1.21.11 开发说明](https://fabricmc.net/2025/12/05/12111.html)、[Fabric 客户端消息事件](https://github.com/FabricMC/fabric/blob/1.21.11/fabric-message-api-v1/src/client/java/net/fabricmc/fabric/api/client/message/v1/ClientSendMessageEvents.java)。Fabric API 使用 Apache-2.0 许可证，许可信息保存在其 JAR 中。
