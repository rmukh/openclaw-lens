[English](./README.md) | [中文](./README.zh.md)

# claw-lens

[![npm version](https://img.shields.io/npm/v/claw-lens-cli)](https://www.npmjs.com/package/claw-lens-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org)

**claw-lens 将 Observability、Analytics 与开发者工具融合为一 —— 为 [OpenClaw](https://openclaw.ai) agent 提供成本追踪、Session 分析、Profiler、Cache Trace 和安全审计，全部跑在本地。**

---

## 设计理念

过去做监控的工具，默认写代码的人、看日志的人、修 bug 的人都是工程师。AI agent 把这件事改了。现在用 agent 干活的人——创业者、分析师、运营、跨境电商从业者——他们不是工程师，Datadog 和 Honeycomb 也不是给他们做的。

claw-lens 就是在这个背景下做的。对 agent 来说，最该盯的不是延迟，是钱。最基本的单位不是一次请求，是一整个 session。而最严重的问题——agent 读了不该读的文件、把密钥暴露出去、被注入的指令带着跑——根本不会报错。你得有个工具，能把系统真正在干什么摊开给你看。

→ [claw-lens.com/engineering/agent-observability](https://claw-lens.com/engineering/agent-observability)

---

<h2 id="screenshot">截图</h2>

![Overview](./assets/zh_screenshot/zh_overview.png)

<details id="more-details">
<summary>更多截图（有点长，可以过后再读）</summary>

### Token 用量
![Token 用量](./assets/zh_screenshot/zh_token.png)

### 智能体
![智能体](./assets/zh_screenshot/zh_agents.png)

### 实时监控
![实时监控](./assets/zh_screenshot/zh_live.png)

### 会话
![会话](./assets/zh_screenshot/zh_sessions.png)
![会话详情](./assets/zh_screenshot/zh_sessions_details.png)
![会话消息](./assets/zh_screenshot/zh_sessions_msg.png)

### 定时任务
![定时任务](./assets/zh_screenshot/zh_cron.png)

### 记忆
![记忆](./assets/zh_screenshot/zh_memory.png)

### 安全审计
![安全审计](./assets/zh_screenshot/zh_audit.png)
![审计事件详情](./assets/zh_screenshot/zh_audit_eventdetails.png)
![审计智能体状态](./assets/zh_screenshot/zh_audit_agentstatus.png)

### 时间线
![时间线](./assets/zh_screenshot/zh_timeline.png)
![时间线错误步骤](./assets/zh_screenshot/zh_timeline_errorstep.png)

### 性能分析
![性能分析](./assets/zh_screenshot/zh_profiler.png)

### 深度轮次
![深度轮次](./assets/zh_screenshot/zh_deepturn.png)

### 上下文拆解
![上下文拆解](./assets/zh_screenshot/zh_contextbreakdown.png)

### 缓存追踪
![缓存追踪](./assets/zh_screenshot/zh_cachetrace.png)

[回到顶部](#more-details)

</details>

---

## 功能

- **概览** — KPI 一览（今日花费、token 用量、session 数、报错数、缓存效率），7 天走势，周环比，按模型的成本分布，活跃 agent 列表
- **Token 用量** — 四维成本拆解（input、output、cache read、cache write），支持按 agent、模型、时间段看；缓存命中率；定时任务和手动任务的成本对比
- **智能体** — 每个 agent 的统计数据、花费、session 数，以及 agent 的记忆文件
- **实时监控** — 实时 agent 活动流，通过 WebSocket 接 OpenClaw Gateway
- **会话** — session 列表，可以按 agent、模型、日期、成本筛选；除已有排序外，还支持按最后活跃时间、开始时间、持续时间和每条消息的平均 token 数升序或降序排列；带上下文健康度标识；每个 session 都能展开看完整的 tool call 链路
- **定时任务** — 定时任务列表、历次运行记录、状态和成本
- **记忆** — 查看所有 agent 的工作区和记忆文件
- **安全审计** — 安全事件时间线，用规则做风险评分（高/中/低），覆盖文件访问、shell 命令、外部 HTTP 请求、敏感数据检测（34 种正则）、提示词注入检测（9 种模式），还有基于 30 天行为基线的异常检测
- **时间线** — 单个 session 的逐轮消息回放，带 token 数、停止原因、tool call 详情；按当前会话的工具集合分配感知差异较大的颜色，支持自定义工具；工具种类较多时增加条纹，失败调用用红色边框标记
- **性能分析** — 按 token 消耗给 session 排名，工具耗时分析
- **深度轮次** — 发现深层轮次里的重复 tool 调用模式，带唯一性评分和按 agent 分组
- **上下文拆解** — 逐轮上下文窗口占用图，拆成 system / history / tool-result 三块，刻度精确到模型的真实容量上限
- **缓存追踪** — 逐步回放 OpenClaw 的缓存日志，看每个阶段的变化、digest diff 和模型配置
- **i18n** — 中英文双语界面
- **数据全部留在本地** — 只读 OpenClaw 本地的 JSONL 日志，不往任何外部服务器发数据

详细的逐页功能说明：**[claw-lens.com/monitoring/overview](https://claw-lens.com/monitoring/overview)**

在 Token 用量的 **分析** 部分，**本周（周一至今）** 从本地时区周一零点开始计算。
**自定义范围** 使用以 `-` 分隔的两个日历输入框，包含开始和结束当天。
这些筛选同时作用于 agent、模型及定时/手动任务明细，独立于汇总和 Token 趋势的时间选择。
**按智能体的 Token 用量** 也有独立且相同的时间选择器：今天、本周、最近 7/30/90 天、
全部时间、按天、按周及自定义范围。用量、费用、占比、会话数和展开的热门会话均使用
该部分选择的范围。没有匹配用量时仍可调整日期。这两部分的“全部时间”包含全部记录。

在会话列表中，用下拉框选择排序字段，点击旁边的箭头按钮切换方向：↑ 为升序，↓ 为降序。
所有字段都支持两个方向。默认按最后活跃时间降序排列，与原来的“最新”排序一致。

活动状态根据最近记录的轮次判断。助手以 `stop`、`error`、`aborted` 或 `length` 结束时，
导入后立即显示 **空闲**。最近的用户消息等待回复、或尚未结束的工具轮次显示 **进行中**
（由日志推断）。未结束的轮次超过十分钟没有更新时显示 **未知**，不假定它已完成。
悬停状态可查看原因。“当前活跃”统计这些推断为进行中的轮次。日志更新会刷新表格，
定期轮询作为备用。

这里追踪的是轮次活动，而不是 TUI 进程生命周期。`/exit` 可能只关闭 TUI，不写入会话
退出记录，Gateway 中的运行也可能继续。因此直接启动 OpenClaw 时不会声称 **已退出**。

在时间筛选中选择 **自定义范围**，通过以 `-` 分隔的两个日历输入框选择开始和结束日期。
范围包含本地时区的开始及结束当天。只要会话在该范围内有消息，就会显示，即使它之后
还有更新的活动。Token、费用、错误数及缓存统计仅计算范围内的消息。
日期缺失或结束日期早于开始日期时，会显示验证提示。

**工作区 / 运行** 列在上方显示工作区目录名，下方显示会话名称或运行键。可以按工作区
筛选，也可以搜索工作区、会话名称、agent、会话键或会话 ID。悬停工作区可查看完整路径，
展开会话可查看完整路径和会话键。名称取自 OpenClaw 会话索引及日志元数据；缺少元数据
的旧会话使用 agent 名称，未知的运行名称显示为 `—`。
仪表盘运行期间会自动发现新建的 agent 目录，并在表格下次刷新时显示其中的会话。

为 `workspace-1` 和 `workspace-2` 配置各自的工作区目录后，可启动命名运行：

```bash
openclaw agent --agent workspace-1 --session-key agent:workspace-1:run1 --message "Inspect this workspace"
openclaw agent --agent workspace-1 --session-key agent:workspace-1:run2 --message "Review the changes"
openclaw agent --agent workspace-2 --session-key agent:workspace-2:run1 --message "Inspect this workspace"
```

`--agent` 选择已配置的 agent ID，`--session-key` 选择运行。带 agent 前缀的会话键必须使用
相同的 agent ID。工作区路径来自日志、会话专属工作区元数据或 agent 配置。

---

## 快速开始

```bash
npx claw-lens-cli
```

打开 `http://localhost:4242`。不用注册，不用配置，不上传任何数据。

```bash
npm install -g claw-lens-cli   # 或者用 npm 全局安装
claw-lens --port 3000      # 换端口（默认 4242）
claw-lens --no-open        # 启动时不自动开浏览器
```

需要 Node.js 18+。设置 `OPENCLAW_HOME` 环境变量可以指定数据目录（默认 `~/.openclaw`）。

更多 CLI 用法见 [claw-lens.com/reference/cli](https://claw-lens.com/reference/cli)。

### 开发者

```bash
git clone https://github.com/msfirebird/claw-lens.git
cd claw-lens
npm install
cd src/ui && npm install && cd ../..
npm run dev
```

后端（Express + ts-node-dev，端口 4242）和前端（React + Vite，端口 6060）同时跑，改了 `src/server/` 或 `src/ui/` 下的代码马上生效。

运行 `npm run dev:local` 可使用独立的开发数据库。前端地址为
<http://localhost:6060>，API 地址为 <http://localhost:4242>。该模式读取本地
OpenClaw 会话，将数据库保存到 `.dev/claw-lens.db`，与已安装仪表盘的数据库分开。

运行 `npm run dev:demo` 可用四个模拟会话体验时间线配色和会话排序，覆盖两个工作区，
包括命名运行、缺少元数据的旧会话、自定义工具名和失败的工具调用。
模拟日志保存在 `.dev/demo-openclaw/`，数据库保存在
`.dev/demo.db`。该模式不会执行工具，也不会修改本地 OpenClaw 安装。

两个命令均支持热更新。切换模式前请按 Ctrl+C 停止当前开发服务，因为它们使用相同端口。
运行 `npm test` 可检查配色、会话排序及会话日志文件发现的回归测试。

→ [claw-lens.com/development](https://claw-lens.com/development)

---

## 架构

claw-lens 完全跑在本地。它读 OpenClaw 写到磁盘上的文件——session JSONL、缓存日志、定时任务配置、agent 记忆——把 session 数据解析进 SQLite，再通过 Express API 给 React 前端用。不依赖外部服务，不用部署，不需要配置文件。

四个核心原则：

- **零配置** — `npx claw-lens-cli` 自动建表、导入数据、打开浏览器。装了 Node.js 就能用。
- **成本优先** — 美元花费是最醒目的数字，session、模型、agent 三个维度都能看到。Token 明细在下一层，想看随时点进去。
- **本地只读** — 服务只监听 `127.0.0.1`，不往外发请求，不碰 agent 的文件。claw-lens 唯一写的东西是自己的 SQLite 数据库。
- **规则驱动的安全审计** — 每个 tool call 入库时就用确定性规则打分，不靠机器学习。每个 agent 有自己的行为基线用来检测异常。规则全是透明的——看代码就知道为什么会被标记。

完整设计文档（数据模型、技术选型、各种取舍）：**[claw-lens.com/engineering/design-doc](https://claw-lens.com/engineering/design-doc)**

---

## 数据来源

claw-lens 直接读本地 OpenClaw 数据目录（默认 `~/.openclaw/`）：

| 路径 | 内容 |
|------|------|
| `agents/*/sessions/*.jsonl` | Session 日志（包括 `.deleted` 和 `.reset` 后缀的归档文件） |
| `logs/cache-trace.jsonl` | 缓存日志，用于回放和上下文分析 *(需要在 OpenClaw 里开启 cache trace — [怎么开](https://claw-lens.com/reference/data-storage#cache-trace-retention))* |
| `cron/` | 定时任务定义和状态 |
| `workspace-*/`, `agents/*/workspace/` | Agent 记忆和工作区文件 |
| `openclaw.json` | Gateway 认证 token，用于实时 WebSocket 连接 |

claw-lens 只写一个文件：`~/.openclaw/claw-lens.db`（SQLite）。

---

> **所有数据都在本地。** claw-lens 只监听 `127.0.0.1`，CORS 限制在 localhost，不发任何外部请求。唯一的网络连接是到你本机 OpenClaw Gateway 的 WebSocket。没有任何东西会离开你的电脑。

---

## 许可证

[MIT](./LICENSE)
