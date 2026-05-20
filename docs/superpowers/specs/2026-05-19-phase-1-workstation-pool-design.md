# Phase 1 设计 — 工作站池与调度器

> 第一阶段，flova-clone roadmap 的架构基石。后续阶段（Projects、Characters、
> Conversational、Skills、Timeline 等）的任务派发全部走本阶段建立的调度器。

## 1. 背景与目标

### 1.1 为什么做

目前的 `GenerateView` 只能向 settings 中保存的**单个** ComfyUI URL 派发任务。
用户希望把多台本地工作站组成一个池——既能负载均衡，又能按模型路由（PC-A 装
SDXL，PC-B 装 Flux），还允许手动指定。这是 flova.ai 多模型云生成在本地的
等价替代。

### 1.2 范围（Full V1 + 自动发现）

- 多工作站 CRUD（增/删/改/启停）
- 健康轮询（在线/忙/离线 + GPU + VRAM）
- 模型自动检测（checkpoints / LoRAs / VAE）
- **三种调度模式**：LAN pool、per-model、manual
- LAN 自动发现（端口扫描）
- 跨工作站统一队列视图

### 1.3 不在本阶段

- WebSocket 实时步数进度（粒度先用 `/queue` 5s 轮询，留 Phase 1.5）
- 任务持久化（重启即丢，没意义重连 ComfyUI）
- 跨子网发现 / VLAN
- mDNS / Bonjour 广播（ComfyUI 不原生支持）
- 配额 / 调度优先级 / 用户多租户

---

## 2. 架构与数据模型

### 2.1 进程分层

```
┌────────────────────────────────────────────────────┐
│ Renderer                                           │
│  ┌──────────────────────────────────────────────┐ │
│  │ GenerateView                                 │ │
│  │   ├─ WorkstationPanel (折叠)                │ │
│  │   ├─ QueuePanel (折叠)                      │ │
│  │   ├─ "Run on" 下拉                          │ │
│  │   └─ Outputs 网格                           │ │
│  │ SettingsView                                 │ │
│  │   └─ Workstations 区 + DiscoverDialog       │ │
│  │ TopNav                                       │ │
│  │   └─ 聚合状态点                              │ │
│  └──────────────────────────────────────────────┘ │
│            ▲ useWorkstationPool() hook            │
│            │ 订阅 workstations:update / jobs:update│
└────────────┼───────────────────────────────────────┘
             │ IPC
┌────────────▼───────────────────────────────────────┐
│ Main                                               │
│  ┌──────────────────────────────────────────────┐ │
│  │ workstationPool (单例 service)              │ │
│  │   ├─ list / add / remove / edit             │ │
│  │   ├─ discover()    (端口扫描)               │ │
│  │   ├─ healthLoop()  (每 5s 轮询所有工作站)  │ │
│  │   ├─ refreshModels(id)                      │ │
│  │   └─ submit(workflow, hints) → jobId        │ │
│  └──────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────┐ │
│  │ ipc/workstations.ts  (IPC 桥)              │ │
│  └──────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────┐ │
│  │ ipc/comfy.ts  (薄包装：comfy:queue/getStatus│ │
│  │  内部转发到 workstationPool)                │ │
│  └──────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

**核心决定**：调度器在主进程（不在 renderer）。

- 任务可能跑数分钟——用户会切到 Gallery；调度器必须不依赖 GenerateView 挂载。
- 多工作站需要单一事实来源做负载均衡。
- 非 localhost ComfyUI 在 renderer 直连有 CORS 问题（参照已修过的 Ollama）。
- 状态推送沿用现有 `analyze:progress` 的 `webContents.send` 模式。

### 2.2 数据类型

```ts
// 持久化：仅 id/name/url/enabled
// 运行时派生：status/models/queueDepth/gpu/lastSeenAt
type Workstation = {
  id: string                      // uuid
  name: string                    // 用户标签，e.g. "PC-1 (3090)"
  url: string                     // http://192.168.1.10:8188
  enabled: boolean
  // —— 运行时 ——
  status: 'online' | 'busy' | 'offline' | 'unknown'
  models: { checkpoints: string[]; loras: string[]; vae: string[] }
  queueDepth: number              // pending + running on this WS
  gpu?: { name: string; vramTotal: number; vramFree: number }
  lastSeenAt?: number
}

type Job = {
  id: string                      // 本地 uuid
  workstationId: string | null
  promptId: string | null         // ComfyUI 返回，提交后填
  workflow: WorkflowJSON
  hints: { requireModel?: string[]; preferWorkstation?: string }
  status: 'queued' | 'submitting' | 'pending' | 'running' | 'done' | 'error'
  queuePosition?: number
  outputs?: string[]
  error?: string
  promptPreview?: string          // 截前 50 字符，仅 UI 显示
  createdAt: number
  startedAt?: number
  finishedAt?: number
}

type SchedulerMode = 'lan-pool' | 'per-model' | 'manual'
```

### 2.3 Settings schema（v2）

```ts
type Settings = {
  // —— 已有 ——
  ollamaBaseUrl: string
  ollamaModel: string
  maxKeyframes: number
  outputFolder: string
  comfyUrl: string                // 保留，迁移后视为只读

  // —— Phase 1 新增 ——
  version: 2
  workstations: Pick<Workstation, 'id' | 'name' | 'url' | 'enabled'>[]
  schedulerMode: SchedulerMode    // 默认 'lan-pool'
  discovery: { portRange: [number, number] }   // 默认 [8188, 8190]
  ui: { workstationsPanelOpen: boolean; queuePanelOpen: boolean }
}
```

只持久化静态字段；运行时字段每次启动从健康循环重建。`settings.json` 通过
**写临时文件 + rename** 实现原子写入。

---

## 3. 发现与健康轮询

### 3.1 LAN 自动发现

ComfyUI 不广播 mDNS。发现 = 并行端口扫描本子网。

1. `os.networkInterfaces()` 找到本机 IPv4 + 子网掩码（e.g. `192.168.1.42/24`）。
2. 枚举 `/24` 中 254 个候选 IP，剔除自己和已添加的 URL。
3. 对每个 IP × `discovery.portRange` 中的端口，`GET http://IP:PORT/system_stats`。
4. **并发上限 32**（手写 semaphore），单次 timeout 1500ms。
5. 响应 JSON 含 `system` 和 `devices` 字段 = ComfyUI；其他全部丢弃。
6. 命中的项实时追加进 `DiscoverDialog` 候选列表（带 GPU 名 + VRAM）。
7. 用户勾选 + 点 "Add selected" 才真正加入池——**绝不静默添加**。

`/24` 扫描在 32 并发下约 5–8s 完成。

### 3.2 健康轮询

工作站池启动一个 `setInterval(5000)` 循环，对每个 `enabled` 工作站并行：

- `GET /system_stats` → `devices[0].name / vram_total / vram_free`
- `GET /queue` → `queue_running.length`（≥1 即 busy）+ `queue_pending.length`

状态机：

```
unknown ─┬─→ online  (一次成功)
         └─→ offline (连续 3 次失败)

online ↔ busy   依据 queue_running

任意状态 ── 连续 3 次失败 ──→ offline
offline ── 一次成功 ──→ online
```

- 离线工作站继续按 5s 频率轮询（恢复立即可见）。
- 连续 3 次容错避免单次网络抖动误判。

### 3.3 模型检测（按需）

`/object_info` 返回 ~5MB+，**不进入 5s 循环**。触发：

- 工作站首次成功在线（一次性）
- 用户点工作站卡片的 ↻ 按钮
- 检测到 ComfyUI 重启（`system.os` 或启动时间戳变化）

提取三类：

```ts
models.checkpoints = info.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? []
models.loras       = info.LoraLoader?.input?.required?.lora_name?.[0] ?? []
models.vae         = info.VAELoader?.input?.required?.vae_name?.[0] ?? []
```

`/object_info` 调用**全局序列化**（semaphore = 1），避免多个大响应同时驻留内存。
`axios` 设 `maxContentLength: 50_000_000`，超限工作站功能降级（模型列表为空，但
其他功能正常）。

### 3.4 IPC 事件

`webContents.send('workstations:update', list)` — 工作站列表整体推送（≤16 项，
payload 仍 <10KB）。每当任一字段变化都触发。

---

## 4. 调度器

### 4.1 三种模式

每种模式底层共用同一套挑选算法，区别只是默认参数：

| 模式 | 行为 |
|---|---|
| `lan-pool` | 在 online 工作站中按 `queueDepth` 升序挑；并列随机。 |
| `per-model` | 先按 `hints.requireModel` 过滤工作站（必须全部模型都有），再走 `lan-pool` 算法。**若 `requireModel` 为空（workflow 中无 checkpoint/LoRA/VAE 节点）→ 等同 `lan-pool`**。 |
| `manual` | 不自动选；调用方必须传 `hints.preferWorkstation`。 |

**Hint 优先级**：`hints.preferWorkstation` **永远优先于全局模式**——只要工作站存在且 enabled（无论 online/offline），调度器都派给它。这让 GenerateView 的 "Run on" 下拉在选定具体工作站时能强制覆盖全局模式（offline 也接受，等它上线再跑）。

### 4.2 提交流程

```ts
pool.submit({ workflow, hints }) → jobId
```

1. **自动提取 requireModel**：遍历 workflow，读所有 `CheckpointLoaderSimple.ckpt_name`、
   `LoraLoader.lora_name`、`VAELoader.vae_name`，去重后并入 `hints.requireModel`。
2. **挑选工作站**：按当前模式 + hints。挑不到 → job 状态直接 `error`，错误消息
   指出具体原因。
3. **创建 Job**：`status: 'queued'`，分配本地 `jobId`，立刻派 `jobs:update` 事件。
4. **提交到 ComfyUI**：`POST {ws.url}/prompt`（**全局并发上限 4**，semaphore 排队）。
   成功后存 `promptId`，状态 → `submitting → pending`。
5. **状态推进**：健康循环同时刷新所属任务的 `status` / `queuePosition` / `outputs`。

### 4.3 任务状态机

```
queued ─→ submitting ─→ pending ─→ running ─→ done
   │          │            │          │
   └──────────┴────────────┴──────────┴───→ error
```

### 4.4 失败处理

- **提交失败**（网络 / 非 2xx）：立刻把该工作站标 `offline`（不等下次健康），
  自动重跑挑选算法。**重试 2 次**后还失败 → `error`。
- **运行中工作站掉线**：标记 `offline` 时其上 `running` 任务转 `error`，附 Retry 按钮。
  不自动转移——ComfyUI 图执行不可恢复。
- **任务卡 pending/running 但 /history 和 /queue 都找不到**：连续 20 次 unknown
  （约 100s）后转 `error: "Lost track of job (ComfyUI may have restarted)"`。

### 4.5 任务不持久化

任务列表仅主进程内存。理由：

- ComfyUI 重启即丢，本地持久化无法续接
- 完成的任务进 Gallery 已经是持久化路径
- 进程退出 = 工作流终止，符合"本地工具"心智

### 4.6 IPC 事件

`webContents.send('jobs:update', list)` — 任务列表整体推送（典型 <50 项）。

---

## 5. UI

### 5.1 GenerateView 布局

保留左右两栏。右栏从"单任务 Status + Outputs"重做为 **Workstations 面板（折叠）+
Queue 面板（折叠）+ Outputs（选中 job 的产物）**。

左栏底部 Send 按钮上方新增 **"Run on" 下拉**——永远显示：

- `Auto (LAN pool)` / `Auto (per model)`（取决于全局模式，全局模式变更时下拉标签实时刷新）
- 每个 `enabled` 工作站一项（offline 灰显，仍可选；下次上线即跑）
- 全局模式为 `manual` 时**没有 Auto 选项**，必须挑具体工作站
- **选定具体工作站** = 传 `hints.preferWorkstation`，覆盖全局模式（见 §4.1 Hint 优先级）。选 Auto 则不带该 hint，纯走全局模式。

### 5.2 工作站卡片

```
┌────────────────────────────────────────┐
│ ●  PC-1 (3090)              Idle  ↻   │
│    192.168.1.10:8188                   │
│    VRAM ████████░░  19.0 / 24.0 GB    │
│    6 checkpoints, 23 LoRAs             │
└────────────────────────────────────────┘
```

- 状态点：`●` 绿=idle, `◐` 黄=busy（带分数）, `○` 灰=offline, `◌` 空心灰=unknown
- 悬停：完整 URL + GPU 全名 + 首次发现时间
- 右键菜单：Edit / Disable / Remove
- ↻：手动刷新模型列表
- 模型数点击展开滚动列表

### 5.3 Queue 卡片

```
┌────────────────────────────────────────┐
│ ⬤  #A94    running          PC-2       │
│     "A cinematic portrait of..."        │
│     ████████░░░░░ step 15/25 · 60%    │
└────────────────────────────────────────┘
```

- 状态图标：`◇` queued/submitting, `◐` pending（带队列位置）, `⬤` running, `✓` done, `✗` error
- prompt 预览：前 50 字符 + 省略号
- 进度：Phase 1 用 `/queue` 5s 轮询；**WebSocket 实时步数留 Phase 1.5**
- 点击 = 选中该 job → 下方 Outputs 显示其产物
- 右键菜单：Retry（error）/ Cancel（pending/running，调 `/interrupt`）/
  Send to Gallery（done）/ Remove
- 完成 job 默认留在队列直到手动清理；顶部 "Clear done" 链接

### 5.4 Settings → Workstations 区

放在现有 ComfyUI 区**上方**；旧字段保留并标 "Legacy (migrated to workstation #1)"。

- Scheduler mode：3 个 radio
- 工作站列表卡片（含 enable 复选、Edit、Remove、↻ Refresh）
- `[ + Add workstation ]` / `[ ⚲ Discover on LAN… ]`
- 端口范围输入框

**Add workstation 对话框**：Name + URL + Test connection 按钮。测试通过才允许保存。

**Discover dialog**：实时增长的候选列表 + 进度条 + "Add selected" 按钮。

### 5.5 TopNav 聚合状态点

右侧 Ollama 状态点旁加 `⊙ 3/4 stations`。点击跳到 Generate（工作站面板已展开）。

### 5.6 空状态

新装 / 零工作站：GenerateView 顶部醒目卡片：

> **Add a workstation to start generating**
> [Add manually]  [Discover on LAN]

两个按钮都跳到 Settings 对应区域。

---

## 6. 迁移与持久化

### 6.1 设置迁移（v1 → v2）

App 主进程启动时跑一次 `migrateSettings()`：

```ts
function migrateSettings(s: Partial<Settings>): Settings {
  if (s.version === 2) return s as Settings
  const workstations = s.comfyUrl?.trim()
    ? [{
        id: randomUUID(),
        name: 'Local ComfyUI',
        url: s.comfyUrl.trim().replace(/\/$/, ''),
        enabled: true
      }]
    : []
  return {
    ...defaults,
    ...s,
    version: 2,
    workstations,
    schedulerMode: 'lan-pool',
    discovery: { portRange: [8188, 8190] },
    ui: { workstationsPanelOpen: true, queuePanelOpen: true }
  }
}
```

幂等。现有用户启动即看到自己的 ComfyUI 出现在池里，零配置。

### 6.2 现有 `comfyUrl` 引用的处理

| 文件 | 处理 |
|---|---|
| `comfy:queue` / `comfy:getStatus` | **保留为薄包装**：签名不变（仍接 `{workflow, comfyUrl}` / `{promptId, comfyUrl}`）。包装内部：(1) 用 `comfyUrl` 在工作站池中按 URL 精确匹配找出工作站；(2) 若匹配到，转发为 `pool.submit({workflow, hints:{preferWorkstation: id}})`；(3) 若无匹配（外部脚本传了一个池里没有的 URL），按当前全局模式走，并在日志里 warn。`getStatus` 反查同理，按 `promptId` 在 job 列表里查找。renderer 端 `GenerateView` 切到 `window.api.workstations.*`，旧 API 一段时间内还能用，方便外部脚本平滑过渡。 |
| `comfy:open` (legacy save-JSON) | **完全不动**——它和池无关，是直接打开 ComfyUI 文件夹的功能。 |
| `SettingsView` 中 `comfyUrl` 字段 | 保留但置灰，副标显示 "Legacy (migrated to workstation #1)"。Phase 2 删。 |

### 6.3 原子写入

```ts
const tmp = `${settingsPath}.tmp`
await fs.writeFile(tmp, JSON.stringify(s, null, 2))
await fs.rename(tmp, settingsPath)
```

---

## 7. 错误处理

### 7.1 三级分类

| 级别 | 例子 | 处理 |
|---|---|---|
| 可恢复 | 健康检查抖动；偶发 500 | 静默吞，下个 5s 周期再试。不冒泡。 |
| 工作站特定 | 单个工作站离线；模型不存在 | 自动绕过；UI 在卡片上更新状态点 + tooltip。已派的任务转 error + Retry。 |
| 致命 | 全部工作站离线；任何工作站都没有所需模型 | 任务 error；UI 弹 toast + job 卡显示完整错误。 |

### 7.2 错误文案表

| 场景 | 文案 |
|---|---|
| 全部工作站离线 | `No workstations are online. Check your network, or click "Discover on LAN" in Settings.` |
| 所需模型不存在 | `No workstation has 'flux1-dev.safetensors'. Refresh model lists with ↻, or pick a different checkpoint.` |
| 工作站拒绝任务 | `Workstation 'PC-2' rejected the job: <ComfyUI msg>. Click Retry to send to another workstation.` |
| 工作站中途掉线 | `Workstation 'PC-1' went offline mid-job. Click Retry to resubmit.` |
| 任务追踪丢失 | `Lost track of job on 'PC-2' (ComfyUI may have restarted). Click Retry.` |
| Manual 未选工作站 | `Pick a workstation from "Run on" before sending.` |
| 发现扫描为空 | `No ComfyUI servers found on 192.168.1.0/24 ports 8188–8190. Make sure ComfyUI is running with --listen, or add manually.` |

致命错误同时写主进程日志（`console.error` + `app.getPath('logs')`）。

### 7.3 并发上限

| 操作 | 上限 | 实现 |
|---|---|---|
| LAN 扫描 | 32 并发 | 手写 semaphore（零依赖，约 30 行） |
| 任务提交 `POST /prompt` | 4 并发全局 | 同上 |
| 健康轮询 | 无显式上限（工作站数 <16） | 并行 axios |
| `/object_info` 刷新 | 1 全局 | semaphore |

### 7.4 边界情况

| 情况 | 行为 |
|---|---|
| Discovery 期间用户加同一 URL | dedupe by URL，不重复 |
| 删除工作站时其上有运行中任务 | 阻止删除，弹"Cancel jobs first?"对话框 |
| ComfyUI 中途重启 | 任务 20 次 unknown 后转 error |
| 同时提交 100 任务 | semaphore 排队，UI 显 submitting |
| `/object_info` >50MB | 超限跳过模型检测，其他功能正常 |
| 新装零工作站 | GenerateView 顶部空态卡片引导添加 |

---

## 8. 改动面与估算

| 文件 | 类型 | 估算 |
|---|---|---|
| `src/main/store.ts` | 改 | +60 行（migrate + atomic write） |
| `src/main/services/workstationPool.ts` | **新** | ~400 行 |
| `src/main/ipc/workstations.ts` | **新** | ~80 行 |
| `src/main/ipc/comfy.ts` | 改 | -40 / +30（薄包装） |
| `src/main/utils/semaphore.ts` | **新** | ~30 行 |
| `src/main/utils/discovery.ts` | **新** | ~80 行 |
| `src/main/index.ts` | 改 | +5 行（注册 + 启动） |
| `src/preload/index.ts` + `.d.ts` | 改 | +60 行 |
| `src/renderer/src/types.ts` | 改 | +40 行 |
| `src/renderer/src/hooks/useWorkstationPool.ts` | **新** | ~80 行 |
| `src/renderer/src/views/GenerateView.tsx` | **大改** | -60 / +200 |
| `src/renderer/src/views/GenerateView.module.css` | 改 | +50 行 |
| `src/renderer/src/views/SettingsView.tsx` | 改 | +180 行 |
| `src/renderer/src/views/SettingsView.module.css` | 改 | +40 行 |
| `src/renderer/src/components/TopNav.tsx` | 改 | +20 行 |
| `src/renderer/src/components/WorkstationPanel.tsx` | **新** | ~120 行 |
| `src/renderer/src/components/QueuePanel.tsx` | **新** | ~140 行 |
| `src/renderer/src/components/DiscoverDialog.tsx` | **新** | ~150 行 |

合计：~18 个文件，~1800 行新增、~100 行删除。约 Phase 0 commit 的 1.8 倍。零新增 npm 依赖。

---

## 9. 验收标准

1. **迁移**：现有用户启动后 Settings 中看到 "Local ComfyUI" 工作站，URL 来自原 `settings.comfyUrl`，无需再次配置即可生成图像。
2. **手动添加**：Settings → Add workstation → 填入 LAN 中另一台 ComfyUI 的 URL → Test connection 通过 → 保存。工作站卡片在 Settings 和 GenerateView 中都出现。
3. **自动发现**：本机所在 `/24` 子网另一台跑了 ComfyUI → 点 Discover on LAN → ≤8s 内出现在候选列表 → 勾选 + Add selected → 加入池。
4. **健康循环**：关掉某工作站 ComfyUI → 5–15s 内状态点变灰。重启 → 5s 内回绿。
5. **模型检测**：新工作站首次在线后自动出现模型计数；安装新 checkpoint → 点 ↻ → 列表更新。
6. **LAN pool 模式**：向池提交 5 个任务 → 任务在 idle 工作站间分布；某工作站离线时新任务自动绕过。
7. **Per-model 模式**：workflow 用 PC-A 独有的 checkpoint → 任务只会派给 PC-A，即使 PC-B 更闲。
8. **Manual 模式**：Send 时未选工作站 → toast 提示 + 任务不提交。选定 PC-B → 任务进 PC-B 的队列。
9. **错误恢复**：提交时工作站 ComfyUI 突然不响应 → 任务自动重路由到另一工作站。所有工作站都失败 → 任务 error + 错误信息含全部失败工作站名。
10. **并发**：同时提交 100 任务 → 同一时刻向 ComfyUI POST 的不超过 4；submitting 状态正确轮转。
11. **持久化**：增删工作站、改调度模式 → 关 app → 重开 → 状态保留。

---

## 10. 未来工作（明确推到后续阶段）

- WebSocket 实时步数进度（Phase 1.5）
- 跨子网工作站（Phase 1.5 配合 Tailscale / 手动 URL）
- 任务持久化 SQLite（仅在引入夜间批量渲染时）
- 调度优先级 / 任务标签（Phase 4 conversational 多任务编排时）
- 工作站组（按 GPU 类型分组）
