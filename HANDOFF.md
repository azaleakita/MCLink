# MCLink 项目交接文档

交接整理日期：2026-10-11，Asia/Hong_Kong；0.5.0 功能基线验证日期：2026-10-10。交接基线：桌面应用 **0.5.0.0**、Node 桥接 **0.5.0**、Fabric 客户端模组 **0.4.0**。

当前状态：针对“模型每隔几个步骤停止、频繁 API 调用容易触发 DeepSeek 风控”的优化已实现并验证。2026-10-11 用户进一步授权将项目上传 GitHub、发行 Release，并明确选择**公开仓库，所有人可下载**。已补充自动测试、Windows 构建、版本标签发布和本地便携包校验流程。**尚未部署远程机器人服务，也未进行用户实际 API 的长时间验证。** GitHub 发布结果以本文 2.1 节和实际仓库为准。

本文中的相对路径均以项目根目录为基准。旧本地根目录为 `C:\Users\lin26\OneDrive\文档\ChatGPT\MCLink`；新会话应使用实际工作目录，不要把这个绝对路径写入代码。

## 1. 项目目标与用户需求

MCLink 是 Windows 11 x64 的原生 WinUI 3 桌面应用，让普通文本模型作为独立 Minecraft Java 玩家自主执行用户任务。世界信息来自 Minecraft 协议，以结构化文字观察发送给模型；寻路、挖掘、合成等由代码执行，不通过游戏截图或键盘模拟控制机器人。

已有功能包括 API 配置与模型列表、游戏连接、任务执行、背包与地图、世界地图缓存及存档导入、玩家聊天与指令、自动复活、持久化日志、自定义提示词和图标。

最近用户请求：

1. “现在大模型在进行操作的时候，每隔几个步骤都会停止，你优化一下，还有，现在因为高频调用 api，很容易被 deepseek 风控，你看看怎么优化。”
2. 整理完整 `HANDOFF.md`，使新 Codex 会话可以接手，并准备把本地项目移入云端任务。
3. 上传当前项目至 GitHub，继续自主维护软件并发布 Release；用户指定仓库公开。

接手时继续维护现有项目。把开发工作移到云端不代表已经要求重写界面、转换为网站、支持 Linux 桌面或部署一个远程机器人服务。

## 2. 迁移前最重要的状态

### 2.1 GitHub 上传与发行

2026-10-11 已创建公开仓库，首个源码提交 `c51cb1b` 已推送至 `main`；旧交接文档中的空仓库状态是历史情况。仓库与发行入口：

- 公开源码仓库：`https://github.com/lin2602298200-del/MCLink`，默认分支 `main`。
- 发行版本目标：`v0.5.0`，Windows 11 x64 完整便携 ZIP 及 SHA-256 校验文件；实际发行状态查看 `https://github.com/lin2602298200-del/MCLink/releases/tag/v0.5.0`。
- GitHub Actions：`.github/workflows/ci.yml` 检查 Ubuntu/Windows 桥接并构建 Windows 程序与模组；`release.yml` 在推送 `v*` 标签后构建并发行，标签必须匹配应用和桥接版本。
- 发行说明：`releases/v0.5.0.md`；本地打包：`scripts/package-release.ps1`。
- 首轮云端验证：[Actions run 38130042740](https://github.com/lin2602298200-del/MCLink/actions/runs/38130042740)，Ubuntu/Windows 桥接和 Windows 应用/模组构建、便携打包及上传全部通过。后续文档与桌面 QA 等待逻辑的提交没有修改应用或 bridge 业务实现。

新会话应直接检查上述仓库的提交、Actions 和 Release 状态，以实际结果为准；不要依据旧空仓库记录恢复或删除当前 Git 历史。GitHub 发布成功后，云端可以 clone 仓库接手，无需传递本地依赖和 SDK 缓存。

应携带：`HANDOFF.md`、`README.md`、`VERIFICATION.md`、`.gitignore`、`MCLink.sln`、`bridge/` 的源码/测试/清单/锁文件、`src/MCLink.App/` 的源码与完整 Assets、`scripts/`、`client-mod/` 的源码与构建配置、根目录构建脚本、许可证与素材来源文档。

可重新生成、不必随源码传递：`node_modules/`、`bin/`、`obj/`、`.tools/` SDK/缓存/下载包、`.gradle/`、`client-mod/build/`、`dist/`。这些目录已由 `.gitignore` 忽略。若需要保存现有 Windows 可执行成品，应另行保留**整个** `dist/MCLink` 文件夹，不要只复制 EXE。

### 2.2 已保留可迁移的 Windows 验证脚本

上一轮原生设置验证脚本在 `.tools/check-agent-settings.ps1`，会被 Git 忽略。本轮保留一份于 **`scripts/check-agent-settings.ps1`**。脚本根路径按所在目录计算，隔离测试数据仍写到 `.tools/qa-agent-settings-<GUID>`，适合随源码传递。

本轮在新位置重新运行脚本，得到两行 PASS，保存与重启恢复验证通过。`.tools` 中其他历史诊断脚本不是构建必需品；重要行为与验证结果已写入本文和 `VERIFICATION.md`。

### 2.3 运行数据与凭据位于源码之外

Windows 默认数据根目录是 `%LOCALAPPDATA%\MCLink`：

| 内容 | 位置与迁移含义 |
| --- | --- |
| API、游戏与界面设置 | `settings.bin`，Windows DPAPI `CurrentUser` 加密；不能假定在另一用户、另一机器或 Linux 上可以解密 |
| Microsoft 游戏登录缓存 | `auth/`，属于认证数据；云端单元测试不需要它 |
| 实际运行日志 | `logs/`，可能包含用户聊天、任务和游戏结果；本轮只读查询过部分错误记录 |
| 世界地图摘要 | `maps/`，不是原始 Minecraft 存档；可按需要另行备份 |

源码与本文不包含用户 API Key。云端测试使用本地假 API 和协议服务，不需要导入上述真实数据。测试可通过 `MCLINK_DATA_DIR` 指定隔离目录。

## 3. 项目结构与架构

```text
MCLink.sln
src/MCLink.App/
  MainWindow.xaml / MainWindow.xaml.cs    原生页面、设置、事件和日志脱敏
  MainWindow.Chat.cs                     聊天 UI 与桥接配置同步
  MainWindow.ApiLayout.cs                API 页响应式布局
  MainWindow.Map.cs / MainWindow.Diagnostics.cs
  Models/AppSettings.cs                  配置模型与默认值
  Services/BridgeClient.cs               Node 子进程、JSON-lines IPC
  Services/SettingsStore.cs              DPAPI 配置保存与隔离数据目录
  Services/LogStore.cs                   异步落盘日志
  Controls/WorldMapControl.*             世界地图绘制与交互
  Assets/                               物品/界面 SVG、图标与来源清单
bridge/
  package.json / package-lock.json
  src/server.mjs                        stdin/stdout IPC 入口
  src/engine.mjs                        游戏连接、任务循环、聊天、死亡恢复
  src/request-scheduler.mjs             共享请求队列与冷却，0.5.0 新增
  src/api.mjs                           协议适配、请求重试、文本与计划解析
  src/actions.mjs                       动作提示与实际游戏动作
  src/chat.mjs / prompt-defaults.json    聊天规则、消息解析、默认提示
  src/observation.mjs                   世界观察与模型用紧凑地图
  src/map-cache.mjs / map-import-worker.mjs
  test/*.test.mjs                       Node 自带 test runner 测试
client-mod/                             Java 1.21.11 Fabric 客户端指令转发
scripts/check-agent-settings.ps1         可迁移的 Windows 原生设置验证
scripts/*.mjs                           图标处理与地图性能测量工具
build.ps1 / build.cmd / run.cmd          Windows 构建、打包、启动
build-client-mod.ps1                     模组构建与打包
README.md / VERIFICATION.md / HANDOFF.md
ASSET-SOURCES.md / THIRD-PARTY-NOTICES.md / LICENSES/
dist/MCLink/                            已发布成品，Git 忽略
.tools/                                本地 SDK、缓存与隔离 QA 数据，Git 忽略
```

### 3.1 桌面与桥接通信

`BridgeClient` 启动 `bridge/src/server.mjs`，优先用成品中的 `runtime/node.exe`，否则用系统 `node.exe`。通信通过 UTF-8 stdin/stdout，每行一个 JSON 对象；第三方控制台输出改走 stderr，不得污染 stdout。

请求示例：

```json
{"id":"request-id","type":"hello","payload":{}}
```

响应和事件：

```json
{"kind":"response","id":"request-id","ok":true,"result":{}}
{"kind":"event","event":"agent","data":{"state":"thinking","step":1,"tokens":0,"message":"..."}}
```

IPC `protocolVersion` 仍为 **1**，应用/桥接版本升级没有同步改变协议版本。常用请求有 `connect`、`disconnect`、`observe`、`agent_start`、`agent_stop`、`game_chat_configure`、`chat_generate`、`chat_cancel`、`api_test`、`api_models`、`action` 和 `map_*`。

原生 UI 把 `running`、`thinking`、`acting`、`stopping`、`recovering` 视为任务仍在运行。改变状态名称时需同时检查停止按钮和 `_agentRunning` 的逻辑。

### 3.2 游戏与观察

- Node 使用 Mineflayer **4.39.0**、mineflayer-pathfinder **2.4.5**、prismarine-provider-anvil **2.13.0**、vec3 **0.2.0**；图标测试使用 pngjs **7.0.0**。
- `observe()` 输出 `source: minecraft_protocol`、生命/饥饿/位置/维度/背包、附近实体与资源、局部地图和近期事件。
- `forModel()` 把局部地图转为 legend 与 `[方块索引,地面高度,可站立]` 行，整张世界地图不会反复发送给 API。
- 机器人只能使用已经加载的区块；容器内容需实际打开才可读。
- 游戏动作受参数校验、取消信号和超时约束；正常动作最多 60 秒，熔炼最多 120 秒。

### 3.3 API 与配置

支持 `openai`、`anthropic`、`ollama`。OpenAI 兼容接口使用 `/chat/completions`，Anthropic 使用 `/messages`，Ollama 使用 `/api/chat`，模型列表分别走 `/models` 或 `/api/tags`。允许基础地址和完整生成接口地址。

采用非流式文本输出和提示词 JSON，不要求模型支持图片、tools 或 `response_format`。Ollama 任务请求带 `format: json`，普通聊天不强制 JSON。

关键默认值与含义：

| 配置 JSON 字段 | 默认与范围 | 含义 |
| --- | --- | --- |
| `profile.maxTokens` | 2048；256–32768 | 输出 token 上限，过长计划/思考输出可能截断 |
| `profile.temperature` | 0.4；0–2 | 模型温度 |
| `profile.requestIntervalSeconds` | 8；0–120 | 同服务 API 请求最短间隔，0.5.0 新增 |
| `preferences.maxSteps` | 80；1–1000 | 0.5.0 起为动作尝试步数上限，API/格式重试不占用 |
| `preferences.batchSize` | 4；1–8 | 一次规划允许的最多动作数，0.5.0 新增 |
| `preferences.intervalSeconds` | 2；0.5–30 | 两批动作之间的等待，批内不等待 |
| `preferences.stopHealth` | 4；0–19 | 低生命停止阈值；0 关闭低生命停止 |
| `preferences.autoEat` | true | 饥饿时尝试吃背包食物 |
| `preferences.chatEnabled` | true | 允许游戏聊天 |
| `preferences.autoReplyChat` | true | 空闲或行动期间自动回应玩家 |
| `preferences.chatIntervalSeconds` | 8；3–120 | 两次实际游戏发言的间隔，与 API 间隔是不同限制 |

C# 配置类使用 PascalCase 属性，JSON 使用 camelCase。旧配置缺少新增字段时，属性初始化提供默认值。Ollama 快捷配置把请求间隔设为 0；桥接直接收到没有该字段的 Ollama profile 时也默认 0。**已保存的 Ollama profile 若经 C# 旧配置加载，新增属性可能仍为通用默认 8，需检查实际值。**

## 4. 已完成的工作

### 4.1 本次优化前的项目基础

以下来自已存在的源码和 `VERIFICATION.md`，不是本轮重新逐项验证所有历史功能：

- 0.2.x：原生 WinUI 工作台、API 与游戏配置、地图/背包；世界地图缓存、只读存档导入、图标体系及布局修复。
- 0.3.0：自定义聊天提示词、游戏内聊天、配置加密保存和聊天取消。
- 0.4.0：普通聊天与 `/` 任务指令分流，空闲自动回复，任务替换与停止，死亡后自动复活并继续目标，配套 Fabric 转发模组。
- 0.4.1：自然文本聊天兼容、思考标签与 JSON 包裹解析、采集中途部分进度保留、寻路时间限制、模型/动作错误分开计数、持久化文件日志。

### 4.2 0.5.0 持续行动

原实现每一步都发一次模型请求，动作之间等待默认 2 秒。连续三次模型请求/格式错误即结束任务。

新版支持短批次计划，默认最多 4 个动作；批内连续执行，减少每个操作前的模型等待。仍保留单动作格式兼容。每个动作前检查世界就绪、生命和取消状态。

查询、部分采集、动作错误、受到伤害、维度变化、45 秒计划过期或死亡会废弃未执行的计划，并根据观察重新规划。错误和真实结果进入下一次提示。API 重试不再消耗动作步数。

临时 API 错误进入 `recovering` 并保留原任务；连续六轮请求仍不可用才停止。认证、余额等不可重试 HTTP 错误立即停止，避免重复无效请求。模型格式错误与动作错误分别保留三次/五次停止阈值。

### 4.3 0.5.0 调用频率保护

- 新增所有模型调用共用的请求队列；同服务串行、默认至少间隔 8 秒。
- 队列覆盖任务决策、自动聊天、手动发言、API 测试和模型列表。
- 429 默认从 15 秒起指数退避，并遵守 `Retry-After`；其他临时故障从 1 秒起退避。
- 每次 `complete()` 最多三次 HTTP 尝试，冷却跨调用共享，成功后逐步降低限流惩罚。
- 排队、间隔和冷却均可被取消；实际 HTTP 的 90 秒超时在获得队列执行权后才开始。
- 自动回复先等待 400 毫秒合并连续玩家消息，减少拆成多个回复请求。
- 历史动作结果不重复附带完整 `inventory`、`inventoryBefore`、`inventoryAfter`；当前观察仍包含真实背包。
- 运行设置增加批次大小；API 高级参数增加请求间隔；设置加密持久化并在重启时恢复。

### 4.4 已找到的实际故障证据

只读查看过本机真实日志，发现多次以下错误：

```text
回应玩家失败：API 网络请求失败：连接失败。请检查网络、代理及 API 服务状态。
API 网络请求失败：连接失败。请检查网络、代理及 API 服务状态。
模型连续三次请求或格式错误，任务停止。
```

这确认了“连续请求失败导致任务停止”，但日志没有足够 HTTP 状态或网络错误码，**不能证明 DeepSeek 官方封禁或账号风控是具体原因**。已补齐无 transport code 的代理连接失败的退避恢复，并保留错误脱敏。

## 5. 关键技术决策与不可遗漏的细节

### 5.1 计划解析与执行边界

新格式：

```json
{
  "reason": "按已知材料制作工具",
  "actions": [
    {"action":"craft","args":{"item":"oak_planks","count":2}},
    {"action":"craft","args":{"item":"stick","count":1}}
  ]
}
```

旧格式仍可用：

```json
{"reason":"先收集材料","action":"collect","args":{"name":"oak_log","count":4}}
```

- `api.mjs:parsePlan(text,maxActions)` 校验单个 JSON 包装对象、数组非空与数量上限、每项 action/args 结构、不能同时出现顶层 `action` 与 `actions`、`done` 只能在尾部。
- `engine.mjs:runAgent()` 在执行前检查整批 action 名均属于 `ACTION_NAMES`。每个动作的具体参数由动作执行层校验，并非所有游戏先决条件都在整批开始前验证。
- `parseDecision()` 保留为单动作解析器，用于旧格式聊天兼容等场景，不能直接改为返回数组。
- 遇到 `inspect`、`find_blocks`、`recipes`、`attack`、`follow`、容器 `list` 后清空剩余计划，读到新结果后再规划。
- `collect` 检查停止原因、挖掉数量及背包增量；挖掉方块不等于拾取成功。
- 运行提示只使用最近 14 条历史结果。
- 执行一个普通动作后若下一个是 `done`，不会直接执行这个预测完成动作，而是清空它并再次询问模型。单独返回的 `done` 仍依赖模型对当前观察的判断，没有通用的程序化任务完成证明。
- `craft.count` 表示配方执行次数，不是产物数量；`collect.count` 表示目标方块数量。这些语义在批处理提示中必须保留。

### 5.2 队列按 origin 共享

`RequestScheduler` 的 key 是 `new URL(profile.baseUrl).origin`，而不是模型名、profile ID、API Key 或路径。同一个 origin 上不同模型、凭据和 API 路径共用冷却，key 与日志都不包含凭据。

队列使用 promise reservation 按先后串行，必须在响应正文解析完成后释放。排队中的请求取消不能提前放行仍在运行的旧请求，也不能执行迟到的 fetch。

间隔按请求**开始时间**计算：实际模型响应或游戏动作已耗费的时间不会再重复等待。下一请求还要满足上一请求间隔和共享惩罚的更严格值。

这是每个桥接进程的内存调度器，**没有跨进程协调、磁盘冷却保存、RPM/TPM token bucket 或账号级分布式限流**。不同 origin 的代理可能实际共享同一账号，程序目前不知道这种映射。

### 5.3 两层重试与错误分类

- API 层：每次 `complete()` 最多 3 次 HTTP 尝试，retryable 为 408、429、5xx、超时和可恢复网络错误。
- Engine 层：一次 `complete()` 的尝试耗尽后，任务仍可再请求；连续 6 轮临时失败才停止。一次持续失败阶段最多可能产生 **18 次 HTTP 尝试**，期间间隔/退避不断生效，不是连续快速打满。
- 不可重试 HTTP 错误不走上述重试。网络层明确的证书问题、`EACCES`、`EPERM` 等也不可重试。
- 代理仅抛出不含 code 的连接失败仍可重试；读取 code 时兼容 `cause.code`、`cause.errors[0].code`、`error.code`。
- 解析失败、协议响应不兼容和截断回复属于模型/格式问题，不等同于服务暂时不可用。
- 429 退避基数 15 秒，其他临时错误 1 秒；指数基数封顶 120 秒后另加 0–20% jitter，实际等待可能超过 120 秒；更长的 Retry-After 原样尊重。
- Retry-After 支持秒数与 HTTP 日期。长等待拆成不超过 60 秒的可取消 sleep 块。
- 三次成功才降低一级限流惩罚；不能用单次成功立即清掉整个保护。
- 不向 UI/日志回显 API 响应正文、原始网络异常文本或可能携带凭据的地址。

`BridgeClient` 对 `chat_generate`、`api_test`、`api_models` 的默认 IPC 等待调整为 10 分钟，其余默认 135 秒；`hello` 单独 15 秒。`agent_start` 返回启动结果，长期任务通过事件持续报告，不能拿 10 分钟误解为整个任务超时。

### 5.4 取消与死亡恢复

保留 session controller、turn controller、action controller、聊天/传入指令 controller 的职责。停止或新指令替换任务要取消等待中的 API、队列 reservation、动作和未执行计划。死亡取消旧 turn，等待重生的世界/位置/生命/区块就绪，再从真实背包重规划同一目标；不得复用死亡前的计划或假设掉落物还在背包。

### 5.5 聊天与任务分离

普通玩家消息始终只用于对话，不启动/改变目标。明确收到的 `/` 指令才创建、替换或停止任务。原版入口是 `/msg MCLinkBot /任务`；直接 `/任务` 需要 Fabric 客户端模组转发。

聊天可以在游戏动作期间生成，但与任务 API 共用串行队列。回复不执行模型输出的游戏动作。发言上限 100 字、单行，禁止 `/` 命令；一分钟内避免重复文本，忽略机器人回声。

### 5.6 用户的图片处理要求

用户在本会话提供了 AGENTS 指令：图片识别使用外部脚本，而不是直接视觉查看：

```powershell
node C:\Users\lin26\.codex\vision\vision.js "图片路径" "问题"
```

网络图片用 `--url`。脚本返回 GLM 视觉模型的文字结果，再据此判断。实际项目中本轮未找到 `AGENTS.md` 文件，这条要求来自用户消息，不在当前 Git 源码中；脚本也在项目目录之外。云端遇到视觉任务应先确认脚本是否已迁移或存在可用适配，不能假定上述 Windows 路径可用，也不能把未经检查的图像报告为已验证。本轮没有进行新的图片识别。

## 6. 本次修改文件清单

这里列出最近“持续行动/API 调度”任务及本轮交接的改动，不表示项目历史所有文件都由本次创建。因为当前没有 Git 基线，无法用 commit diff 恢复改动前版本。

| 文件 | 改动 |
| --- | --- |
| `bridge/src/request-scheduler.mjs` | 新增共享 origin 队列、最短间隔、共享退避、Retry-After 解析、取消与渐进恢复 |
| `bridge/src/api.mjs` | 接入调度器；最多 3 次尝试；状态/code 与 retryable 分类；模型列表共享队列；新增 parsePlan，保留 parseDecision |
| `bridge/src/engine.mjs` | 批次执行、失败/查询/状态变化后重规划；临时错误恢复不占步数；聊天合并；历史背包精简；等待保护日志 |
| `bridge/src/actions.mjs` | 动作提示改为短计划，强调已知先决条件、查询边界、完整目标确认与批量 count |
| `bridge/src/chat.mjs` | 任务补充提示兼容 JSON 动作计划；普通聊天解析行为保留 |
| `bridge/test/api.test.mjs` | 队列/并发/正文释放/429/长冷却取消/模型列表/计划解析/无 code 网络故障测试，调整重试次数 |
| `bridge/test/agent.test.mjs` | 批次连续性、失败/部分采集/查询/伤害取消、完成确认、任务恢复与停止测试 |
| `bridge/test/chat.test.mjs` | 连续消息合并测试；本地 fixture 显式 requestIntervalSeconds=0 |
| `bridge/test/minecraft.test.mjs` | 本地确定性 API fixture 显式零间隔，保留真实协议测试 |
| `bridge/package.json` | 桥接版本 0.5.0；check 包含新调度器 |
| `bridge/package-lock.json` | 根包版本同步 0.5.0；依赖版本本次未改变 |
| `src/MCLink.App/Models/AppSettings.cs` | 新增 ApiProfile.RequestIntervalSeconds、AgentPreferences.BatchSize 默认值 |
| `src/MCLink.App/MainWindow.xaml` | API 间隔 NumberBox、批次大小 NumberBox、动作/批次间隔与帮助文案 |
| `src/MCLink.App/MainWindow.xaml.cs` | 新字段读取/校验/保存/加载，Ollama 快捷间隔为 0 |
| `src/MCLink.App/Services/BridgeClient.cs` | 三类模型 IPC 等待延长到 10 分钟 |
| `src/MCLink.App/MCLink.App.csproj` | 应用版本 0.5.0 |
| `README.md` | 新批次格式、共享限速、重试与设置的使用说明 |
| `VERIFICATION.md` | 0.5.0 实际日志证据、72 项测试、构建与原生持久化验证 |
| `.tools/check-agent-settings.ps1` | 上一轮本地隔离 UI Automation 验证脚本；Git 忽略 |
| `scripts/check-agent-settings.ps1` | 本轮保留可迁移版本，数据仍写在 .tools 的独立目录 |
| `HANDOFF.md` | 本轮交接文档 |
| `dist/MCLink/` | 发布更新后的 EXE/程序集、桥接 src/package.json 和 README/VERIFICATION；Git 忽略 |

本次没有改动游戏客户端模组、地图缓存实现、观察算法、原有图标资产、DPAPI 加密实现或真实用户配置。`server.mjs` 通过其调用的 `complete()` / `listModels()` 自动获得调度保护，本次没有改它的 IPC 路由。

## 7. 已完成验证与证据范围

最近功能验证在本地 Windows 完成，记录见 `VERIFICATION.md` 的 0.5.0 部分：

| 验证 | 结果 |
| --- | --- |
| `npm run check` | 桥接全部源码语法通过，包含 request-scheduler |
| `npm test` | **72 tests / 72 pass / 0 fail**，最后完整运行约 25.2 秒 |
| 模型调用数量 | 本地确定性 fixture：4 个常规动作 + 新观察完成确认，共 2 次模型调用；批内无人工 sleep |
| Minecraft 协议 | 本地 Java 1.16.5、1.21.11 协议夹具通过；验证区块、背包、行动、聊天、指令和复活相关行为 |
| Windows 发布 | 官方 .NET SDK **8.0.425**，Release x64 发布成功，EXE 文件版本 **0.5.0.0** |
| 原生设置验证 | 默认批次 4、API 间隔 8；改为 6、12 后 DPAPI 保存；重启后恢复为 6、12 |
| 成品同步 | 发布桥接 src 每个文件的 hash 与测试过的源码一致 |

这些测试没有调用用户真实模型 API，也不是完整原版生存世界模拟。2026-10-11 初次 GitHub Actions 的 Ubuntu 与 Windows 桥接检查、Windows 便携构建与打包均通过，补足了原交接时缺少的云端结果。测试数量随后续合法新增测试可能改变，72 是交接时基线。

## 8. 云端接手与环境准备

### 8.1 先辨别可运行范围

若云端是 Linux：可编辑全部源码、安装 Node 依赖、运行桥接与协议测试。**现有 WinUI 3 桌面应用、Windows UI Automation 和 DPAPI 验证需要 Windows 环境。** 不要在 Linux 上直接运行 `build.ps1` 并把平台不支持的 WinUI 发布失败判成代码回归。

若是可用的 Windows 构建环境：按下节执行完整构建。Fabric 模组需要 Java 21 JDK；它不是每次桥接改动都需要重新构建的部分。

在受管云环境中，先遵循该会话实际提供的环境/网络/证书说明，检查代理和允许访问的域名。本文不携带本机批准权限或服务登录状态。

### 8.2 新会话首先运行的只读检查

从实际项目根目录执行：

```text
git status --short
git ls-files
git rev-parse --verify HEAD
node --version
npm --version
```

然后读取 `HANDOFF.md`、`README.md`、`VERIFICATION.md` 最新部分、实际存在的 `AGENTS.md`，以及 `bridge/package.json`。确认完整 Assets、测试和锁文件在云端，不要只得到一段代码或旧成品。

若已经完成首个提交，上述 Git 状态应与本文的“未提交基线”不同，以实际状态为准；不要反向恢复成空仓库。

### 8.3 Linux / 通用 Node 初始化

需要 Node.js **22+**；上一轮本机终端使用 Node.js **24.15.0**，但项目最低要求仍是 22。

```bash
cd bridge
npm ci --no-audit --no-fund --cache ../.tools/npm-cache
npm run check
npm test
```

`npm ci` 需联网安装锁定依赖。2026-10-11 发布准备已将 `package-lock.json` 中的下载前缀从 **registry.npmmirror.com** 改为官方 **registry.npmjs.org**，没有变动依赖版本或 integrity；Windows 从该锁文件干净安装 98 个依赖成功，72 项测试通过。云端需能访问 npm 官方源；不要删除锁文件后盲目升级依赖。

上一轮默认 npm 缓存受沙箱限制报 `EPERM`，改为项目缓存后外网下载仍被拒绝；最终复用了本地现有成品的相同依赖 `dist/MCLink/bridge/node_modules` 完成测试。这是**本地恢复方法，不是云端已经做过 npm ci 的证明**。云端应优先从锁文件干净安装，不依赖本机复制来的 node_modules。

### 8.4 不携带秘密的桥接 smoke test

Linux shell，从项目根目录运行：

```bash
printf '%s\n' '{"id":"hello","type":"hello","payload":{}}' | node bridge/src/server.mjs
```

PowerShell：

```powershell
'{"id":"hello","type":"hello","payload":{}}' | node bridge/src/server.mjs
```

应看到严格 JSON-lines 的 ready 事件和 `ok:true` 的 hello 响应，`protocolVersion` 为 1。stdin 关闭后桥接退出。该检查不连接 Minecraft 或真实 API；独立运行的桥接默认数据目录是工作目录的 `.data`，正式测试可先设置隔离的 `MCLINK_DATA_DIR`。

## 9. 构建与测试方法

### 9.1 桥接测试定位

在 `bridge/` 下：

```text
node --test test/api.test.mjs
node --test test/agent.test.mjs test/chat.test.mjs
node --test test/minecraft.test.mjs
node --test test/actions.test.mjs test/map.test.mjs test/icons.test.mjs
```

API 测试用 loopback HTTP 假服务；协议测试用 loopback Minecraft wire packet 服务；地图测试生成隔离存档；图标测试使用仓库内 Assets。它们需要允许本地 socket listen/connect，无需真实 API Key、正版游戏登录或安装游戏客户端。

其中一项动作测试故意等 10 秒验证寻路超时；1.21.11 协议测试可耗约 20 秒，上限 35 秒。云端资源变慢时应区分真正行为失败与 fixture 时间预算，不要为加速移除取消/超时断言。

测试 fixture 显式使用 `requestIntervalSeconds:0` 是为了确定性快速运行；生产默认仍为 8。测试 429 时用独立 scheduler 的毫秒级参数压缩等待，不要把这些测试参数改成生产默认。

新增/维护测试应覆盖实际行为，尤其是：

- 4 个动作只需要一份计划、批内无重复模型请求。
- 批内失败、查询、部分拾取或伤害会清掉依赖动作。
- 用户停止、死亡、断线、新指令不会执行迟到决策。
- 同 origin 请求不能并发，不能在只读到响应头时释放队列。
- 排队取消不提前释放前一个请求；长 Retry-After 等待可立即取消。
- 429 冷却影响任务与聊天；无 code 的网络错误仍脱敏并可恢复。
- API 临时失败不消耗动作预算，认证错误不重复调用。
- 普通聊天不能执行动作，连续消息合并但推理期间新消息仍保留。

### 9.2 Windows 完整构建

Windows 11 x64，Node.js 22+，.NET 8 SDK，联网到 npm/NuGet/Microsoft 下载站。根目录执行：

```powershell
.\build.ps1
```

构建并启动：

```powershell
.\build.ps1 -Run
```

脚本会安装 bridge 依赖、检查语法、运行测试、发布自包含 WinUI 程序，复制 Node runtime、node_modules、许可证与文档。`-SkipTests` 只跳过测试，不跳过 npm ci；正常交付应保留测试。`-BuildClientMod` 可要求同时构建模组。

上一轮因为本地网络/缓存权限限制，测试成功后实际发布用的是下面命令；随后保留了已有完整运行依赖，并显式同步桥接源码和文档：

```powershell
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
$env:DOTNET_CLI_HOME = Join-Path (Get-Location) '.tools/cli'
$env:NUGET_PACKAGES = Join-Path (Get-Location) '.tools/nuget'
& ./.tools/dotnet/dotnet.exe publish src/MCLink.App/MCLink.App.csproj -c Release -p:Platform=x64 -o dist/MCLink -v:minimal
```

`dotnet publish` 自身不会复制 `runtime/node.exe` 与整个 node_modules；fresh checkout 应优先用完整 `build.ps1`，避免发布出无法启动的半成品。

官方 SDK 当时安装在 `.tools/dotnet`，版本 8.0.425；该目录不随源码迁移。第一次 SDK/NuGet 下载可能需要较长时间，失败时优先查网络/证书与工作目录权限。

### 9.3 Windows 原生设置回归

完成发布后，从根目录使用 PowerShell 7 运行：

```powershell
pwsh -NoProfile -File .\scripts\check-agent-settings.ps1
```

需要 PowerShell 7、可访问桌面的 Windows 会话与 UI Automation；脚本使用的 `CryptographicOperations.ZeroMemory` 不应假定在 Windows PowerShell 5.1 中可用。脚本只启动自己的测试实例：

1. 使用新的 `.tools/qa-agent-settings-<GUID>`，不读写真实 `%LOCALAPPDATA%\MCLink`。
2. 验证批次默认 4，改为 6 并保存。
3. 验证 API 间隔默认 8，保存假本地 profile 与间隔 12；不执行 API 测试、不访问假地址。
4. 读取**隔离测试** DPAPI 设置检查保存值。
5. 关闭并重新启动该实例，验证控件恢复为 6、12。
6. finally 只关闭本脚本启动的进程。

预期输出：

```text
PASS: Native WinUI defaults, setting edits, DPAPI persistence and restart restore.
PASS: Isolated data directory; no user API calls or settings changes.
```

曾经因 UI Automation 设置 NumberBox 后立刻 Invoke 保存，读到旧值；最终脚本在输入后及焦点转移后各等 200 毫秒让原生控件提交，再保存，验证已通过。维护 UI 测试时保留输入提交步骤，不要把自动化焦点时序问题误判为 JSON 持久化失败。

本轮验证迁移后的脚本时，一次 `SetFocus()` 出现 Windows UI Automation COM `Unexpected HRESULT`；该测试实例关闭后，重新运行完整脚本通过。此项记录为桌面自动化的偶发焦点问题，尚未做专项稳定性修复；若持续出现，先检查交互桌面、控件可见/可用状态和焦点时序，再判断是否为应用回归。

### 9.4 Fabric 模组

本次未修改模组，仍为 0.4.0。构建需要 Java 21 JDK、Gradle 9.2.1、Fabric Loom 1.14.10；源码配置目标 Minecraft 1.21.11，Yarn `1.21.11+build.6`，Loader `0.19.5`，Fabric API `0.141.6+1.21.11`。

Windows 根目录：

```powershell
.\build-client-mod.ps1
```

模组目录没有随项目提供的 Gradle wrapper；脚本会准备 Gradle。若云端另行配置好兼容 Gradle，在 `client-mod/` 下可运行 `gradle build`，`check` 会执行独立 `routingCheck`。项目禁用了普通 JUnit `test` task，不能用“Gradle test 无失败”替代路由检查。

### 9.5 真实服务与真实游戏的验收

这是仍待进行的验证，需要能访问游戏服务器与用户选定服务的环境：

- 短目标先测试：采集原木、制作工作台；再测试较长的材料/工具链。
- 检查日志中的已规划动作数、请求次数、模型延迟、API 间隔/冷却提示和实际目标完成情况。
- 在任务期间发送普通聊天，确认仅回复而不替换目标；用 `/msg 机器人名 /新目标` 验证任务替换。
- 在队列等待、429 冷却、模型推理和动作执行期间分别停止，确认没有迟到动作或发言。
- 观察连续失败后是否保留目标并恢复，是否仍频繁触发 429、403、截断回复或重复不可达动作。
- 按实际服务调整 API 请求间隔；UI 中可设更高值。保护只控制本进程，其他程序的调用量需另行考虑。

真实 API 调用可能计费，不能把本地假服务的低延迟/成功率当成真实服务表现。日志分析只使用脱敏信息，不需要在文档或 issue 中展示密钥。

## 10. 当前问题、限制与后续候选事项

交接时没有已知未解决的编译失败或自动测试失败。下列事项仍存在，按“已观察”或“尚未验证/实现”区分：

| 事项 | 状态与下一步 |
| --- | --- |
| GitHub 发布状态 | 公开源码已上传，首轮云端检查/构建/打包全部通过；发行实际状态见 2.1 节 Release 链接 |
| Linux 云端原生界面构建/运行 | 受 Windows 平台约束；桥接可先验证，WinUI/DPAPI/UIA 留到 Windows |
| 云端干净 npm ci | 已改官方源并完成 Windows 干净安装；云端结果查看 GitHub Actions，受其网络策略影响 |
| Windows UI Automation 焦点稳定性 | 历史 SetFocus 和本轮展开控件曾出现 COM 错误；增加展开有限重试与布局等待后本轮检查通过，仍依赖可用交互桌面 |
| 用户真实 DeepSeek/代理风控改善 | 尚未验证；已有日志只证明连接失败后的三次停止，缺少具体状态来源 |
| 长任务连续运行与真实生存玩法 | 尚未做长时间验收；模型可能只返回单动作，也可能提前认为任务完成 |
| 通用目标完成证明 | 没有程序化通用 verifier；`done` 依赖模型对新观察判断，保护仅避免把预测的 done 直接接在行动后执行 |
| 跨实例/跨 origin 同账号限流 | 当前没有；队列在进程内，重启会重置内存冷却，不能限制其他程序 |
| 基于 RPM/TPM 的预算控制 | 当前只有间隔、串行、退避；若仍触发 TPM/RPM，可在现有调度器上增加可配置预算 |
| 共享队列的等待体验 | FIFO，无任务优先级；慢聊天请求可能排在决策前，应先测量再决定是否加优先级 |
| 延迟统计 | `reply.latencyMs` 包含排队/退避/重试的总时间，不是纯模型生成时间；进一步诊断可拆分指标 |
| 队列长冷却与 UI 请求超时 | Retry-After 可超过 10 分钟；UI IPC 超时不等于底层请求一定取消。API 测试/模型列表尚无统一 cancel-by-request-id 机制，可作为后续审查项 |
| 专项覆盖 | 建议补充 45 秒计划过期、跨维度取消、完整挖掉但背包未拾取、连续成功降惩罚、六轮故障停止与旧配置缺字段的专项测试 |
| 历史地图/模组局限 | 未适配外部 .mcc、LZ4 区块、任意模组方块/维度/插件菜单；详见 README |

这些候选项未在本轮交接中实现，也没有把它们列为本次优化测试失败。优先用真实故障证据决定下一项修改，不要为了“完全自主”直接取消生命、死亡、动作错误或步数边界。

## 11. 建议的下一步执行顺序

1. 完成源码传递，核对 Git 已跟踪内容、版本与完整文件结构。新会话读完本文后先报告实际环境和缺失项。
2. 在云端 Node 22+ 环境完成干净依赖安装、`npm run check`、`npm test`，记录真实云端结果；如 socket 或网络受限，明确是哪一阶段受阻。
3. 保留已通过的 0.5.0 实现作为基线。若没有新修改需求，可以完成交接/验证，不必重新设计项目。
4. 在可访问真实服务和游戏的环境收集持续行动与调用频率数据；确定剩余停顿来自队列冷却、模型生成、动作寻路、错误恢复还是模型提前 done。
5. 依据数据选择一项后续工作：更细的调用预算/时间指标、队列优先级、完成证据、恢复策略或专项测试。保持现有取消、聊天分流与生命周期边界。
6. 修改原生界面或配置后，用 Windows 完整发布与 `scripts/check-agent-settings.ps1` 验证；在 Linux 编辑成功不代表 WinUI 已通过。
7. 更新 README/VERIFICATION/HANDOFF 的版本与证据范围，确认成品桥接源码和测试源码一致，再交付或执行用户实际要求的迁移/发布动作。

## 12. 新会话可直接使用的接手提示

> 请先阅读项目根目录 HANDOFF.md、README.md、VERIFICATION.md 最新部分及实际 AGENTS.md。当前基线是 MCLink 0.5.0：Windows WinUI 3 桌面应用 + Node Minecraft 桥接，已实现短批次动作与共享 API 请求调度，本地 Windows 72 项测试和发布通过。首先核对项目是否完整迁移并已纳入 Git，再安装 Node 22+ 依赖并运行桥接检查/测试。若环境是 Linux，明确 WinUI、DPAPI 与原生 UI Automation 尚需 Windows 验证。用户真实 API 的长期风控效果未验证，不要报告为已解决或自动改写为网站。继续保留停止取消、普通聊天与 / 指令分流、死亡后重新规划及凭据脱敏。本文列出了修改文件、参数、已知限制和下一步验证顺序。

## 13. 参考资料

- 项目使用与限制：`README.md`。
- 历史与 0.5.0 验证：`VERIFICATION.md`，以最新部分为准，旧版本叙述不代表当前实现。
- 模组入口与安装：`client-mod/README.md`。
- 素材与依赖许可：`ASSET-SOURCES.md`、`THIRD-PARTY-NOTICES.md`、`LICENSES/`。
- [DeepSeek 官方错误码与限流处理说明](https://api-docs.deepseek.com/zh-cn/quick_start/error_codes/)。
- [DeepSeek 官方限速与隔离说明](https://api-docs.deepseek.com/zh-cn/quick_start/rate_limit/)。
- [Mineflayer 官方 API](https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md)。
- [mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder)。

外部服务规则可能变化；涉及真实服务限额的新增判断，应重新查官方资料，而不是只依据这份交接记录。
