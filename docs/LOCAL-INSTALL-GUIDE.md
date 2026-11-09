# 本地酒馆安装指南

这份指南面向不熟悉终端的用户。请按顺序完成 1 到 6 步，最后验证。全过程只使用本地文件和公开 GitHub 仓库，不会把 API 密钥上传到 GitHub。

## 你需要准备

- Windows 电脑。
- 本项目 `st-card-writer` 的完整目录。
- SillyTavern 已安装并能打开。
- Node.js 20 或更高版本。
- 可选：OpenAI 兼容 API 密钥。

## 1. 启动 MAE 本地服务

1. 打开本项目目录 `D:\github-neirong\SillyTavern\st-card-writer`。
2. 双击 `Start.bat`。
3. 等待命令行出现类似信息：

```text
Memory & Autonomy Engine running at http://localhost:8787
```

4. 浏览器打开 `http://127.0.0.1:8787/api/health`。看到下面结果表示服务已启动：

```json
{"ok":true,"name":"st-card-writer"}
```

如果端口 8787 被占用，`Start.bat` 会自动选择 8788 到 8799 中的空闲端口。安装扩展时也必须使用实际显示的端口。

## 2. 配置 API（可选，但生成 AI 世界书时必需）

在本项目根目录创建 `.env.local`，可以复制 `.env.example` 后填写：

```text
ST_CARD_WRITER_BASE_URL=https://api.deepseek.com/v1
ST_CARD_WRITER_API_KEY=你的本地密钥
ST_CARD_WRITER_MODEL=deepseek-v4-pro
ST_CARD_WRITER_TEMPERATURE=0.7
ST_CARD_WRITER_MAX_TOKENS=3200
```

不要把 `.env.local` 上传到 GitHub。GitHub 推送时应确认它没有出现在 `git status` 中。

## 3. 在 SillyTavern 中安装两个扩展

SillyTavern 的扩展安装入口是：`扩展菜单 -> 从 URL 安装扩展`。分别填入两个仓库地址：

```text
https://github.com/uers123/memory-agency.git
https://github.com/uers123/st-card-writer-viewer.git
```

两个地址分别安装完成后，重启 SillyTavern。

> 说明：`memory-agency` 是本地记忆和主动注入扩展；`st-card-writer-viewer` 是世界书卡视图和深度角色扩展。两个扩展必须使用当前仓库中提供的最新版本，不要混用旧版文件。

## 4. 手动安装（URL 不可用时的备选方法）

如果 SillyTavern 的 URL 安装失败，可以下载仓库 ZIP 后解压，然后把两个目录复制到：

```text
<SillyTavern 根目录>\public\scripts\extensions\third-party\
```

最终应存在：

```text
third-party\memory-agency\manifest.json
third-party\memory-agency\index.js
third-party\memory-agency\style.css
third-party\st-card-writer-viewer\manifest.json
third-party\st-card-writer-viewer\index.js
third-party\st-card-writer-viewer\style.css
```

复制完成后重启 SillyTavern。

## 5. SillyTavern 内设置

重启后打开扩展菜单：

- 点击 `世界状态面板`。
- 在面板的 `服务地址` 中填写：

```text
http://127.0.0.1:8787/api/mae
```

- 点击 `测试本地服务` 或 `刷新`。
- 点击 `Worldbook Card` 可以打开世界书卡视图。

只有带 `data.character_book` 和 `data.extensions.st_card_writer` 元数据的角色卡，世界书卡视图才会激活。

## 6. 验证是否安装成功

完成以下检查：

1. 浏览器能打开 `http://127.0.0.1:8787/api/health`，返回 `ok: true`。
2. SillyTavern 扩展菜单出现 `世界状态面板`。
3. SillyTavern 扩展菜单出现 `Worldbook Card`。
4. 打开世界状态面板，点击 `刷新`，没有连接错误。
5. 导入一个世界书角色卡后，Worldbook Card 面板能显示条目、关键词和分组。
6. `npm test` 通过，`npm run check` 通过。

## 常见问题

### 页面报错“连接失败”

先确认 `Start.bat` 仍处于运行状态，再确认扩展设置中的端口与命令行显示的端口一致。

### URL 安装时文件不完整

确认安装的仓库根目录直接包含 `manifest.json`、`index.js` 和 `style.css`。不要安装只包含子目录的 monorepo 路径。

### 服务启动后仍没有世界书数据

检查角色卡是否包含 `data.character_book` 和 `data.extensions.st_card_writer`。普通人物卡不会触发 Worldbook Card 视图。

### API 密钥安全

密钥只保存在本地 `.env.local`。浏览器只获得“是否已配置密钥”等安全信息，不应看到完整密钥。
