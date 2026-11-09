# Memory & Autonomy Engine

这是一个独立运行的 SillyTavern 本地记忆与自主叙事引擎。它把聊天中的世界状态保存为实体、事实、时间线和审计记录，再通过 SillyTavern 第三方扩展主动注入，而不是把一段散文总结当作唯一记忆。

## 运行

双击 `Start.bat`，或在 PowerShell 中运行：

```powershell
cd .\st-card-writer
cd <本项目目录>\\st-card-writer
npm install
npm start
```

打开 `http://127.0.0.1:8787`。启动器会检测 8787-8799 端口并复用已经运行的实例。Node.js 22+ 会使用本地 SQLite；较旧 Node 版本会回退到同目录 JSON 快照。

## 功能

- 顶部目录封面：首页封面提供功能链接，点击左上角图标会从页面顶部展开目录，不再从右侧弹出。
- 会话控制台：记录回合、查看实体/事实/时间线数量，手动运行后台 tick。
- 实体账本：登记主角、NPC、地点、物品等实体；在“NPC / 物品”编辑区直接修改简介、个性、行为、物品、目标、状态和地点。
- 事实账本：按类别保存硬事实，冲突时保留新事实并标记旧事实为 `superseded_by`。
- 主动注入：轻/中/重三档，按 top、mid、bottom 组装世界原则、演员表、世界书召回、事实重述和最近动态。
- 世界书接入：导入 SillyTavern World Info、角色卡内嵌 `character_book` 或本工具导出的世界书包，保存为当前会话召回快照。
- 一致性审计：检查明确禁止项和硬事实漂移，失败时生成 open ticket。
- 后台 tick：通过本地 OpenAI 兼容模型适配器推进符合条件的 NPC；没有模型配置时不会伪造事件。
- 高级世界机制：六类生理规则（怀孕、伤势、成瘾、衰老、节育、性病）按世界时间结算；世界书召回支持本地向量索引和关键词降级。
- 分槽模型路由：`main`、`extract`、`audit_A`、`audit_B`、`tick`、`gaiden` 可以分别跟随主模型或配置独立 OpenAI 兼容模型。
- 番外队列：事件链达到阈值自动入队，终章优先，默认每 24 小时最多生成 3 章，并经过本地一致性审计。
- 死亡与继任：玩家和 NPC 使用同一死亡结算，死亡事实转为遗产，支持创建继任者、遗产迁移和一次性交接注入。

## SillyTavern 扩展

扩展源代码在 `sillytavern-extension/memory-agency`。将整个目录复制到：

```text
SillyTavern/public/scripts/extensions/third-party/memory-agency
```

重启 SillyTavern，在扩展菜单打开“世界状态面板”。扩展默认连接 `http://127.0.0.1:8787/api/mae`，面板内可修改地址。它会监听聊天切换、消息变更、生成结束和角色消息渲染事件；生成前请求 MAE 注入，生成后记录回合。

卡视图扩展在 `sillytavern-extension/st-card-writer-viewer`，复制到同一个 `third-party` 目录后，在扩展菜单打开“Worldbook Card”。本次兼容性验证使用 SillyTavern release URL：`https://github.com/SillyTavern/SillyTavern.git`，本地测试副本快进到 `06bde939f`。

扩展不会保存模型密钥。模型配置只由本地服务从项目根目录 `.env.local` 或环境变量读取，例如：

```text
ST_CARD_WRITER_BASE_URL=https://api.deepseek.com/v1
ST_CARD_WRITER_API_KEY=replace-with-your-local-key
ST_CARD_WRITER_MODEL=deepseek-v4-pro
```

`.env.local` 已被 `.gitignore` 忽略，不能提交到 GitHub。

扩展默认开启后台 tick，但只在服务端按档位返回 `tickDue` 时运行：轻档关闭，中档每 8 轮，重档每 3 轮。面板仍可手动运行 tick。

卡视图扩展的面板从 SillyTavern 页面顶部下落打开。封面本身是目录入口，可跳转到 NPC / 物品、剧情状态、全部世界书条目和设置；每个世界书条目都显示为可展开的编辑卡，修改后写回当前角色的 `character_book` 并调用 SillyTavern 的角色保存接口。

## HTTP 接口

MAE 接口前缀为 `/api/mae`：

- `GET /health`
- `GET /session?chatId=...`
- `POST /session`
- `POST /settings`
- `POST /entity`：编辑当前会话中的 NPC、物品或其他实体字段。
- `POST /worldbook/sync`
- `POST /turn`
- `POST /injection`
- `POST /audit`
- `POST /tick`
- `GET/POST /model-routes`
- `GET/POST /physiology/rules`
- `POST /physiology/state`
- `POST /physiology/contact`
- `POST /death`
- `POST /successor`
- `GET /gaiden`
- `POST /gaiden/enqueue`
- `POST /gaiden/process`
- `GET /export?chatId=...`

原有世界书卡生成、TavernCard V2、World Info 和 Regex 路由仍保留在 `/api`，只作为迁移工具，不再是默认首页的数据模型。

## 验证
The extension source is in:

```text
sillytavern-extension\st-card-writer-viewer
```

It is also installed locally at:

```text
<你的 SillyTavern 安装目录>\public\scripts\extensions\third-party\st-card-writer-viewer
```

After restarting SillyTavern, open the extensions wand menu or character management menu and select the worldbook card viewer. The extension only activates for cards with `data.extensions.st_card_writer.kind = "worldbook-card"`.

## Project Structure

- `server.js`: Express entrypoint and static file hosting.
- `src/routes.js`: API route registration and export response assembly.
- `src/local-config.js`: local `.env.local` / environment default API configuration.
- `src/worldbook.js`: worldbook normalization, validation, embedded card export, and standalone World Info export.
- `src/openai.js`: OpenAI-compatible connection test, plan generation, and worldbook generation.
- `public/app.js`: browser workflow orchestration.
- `public/modules/`: browser-side API, state, rendering, and UI utility modules.
- `sillytavern-extension/st-card-writer-viewer/`: third-party SillyTavern viewer extension source.

## Test

```powershell
npm test
npm run check
```

测试覆盖旧世界书格式兼容性，以及 MAE 的存储、事实冲突、注入预算、世界书召回、审计、tick、六类生理、模型路由、番外队列、死亡继任和 HTTP seam。

