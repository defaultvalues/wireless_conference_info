# 通信会议截稿雷达 · GitHub Pages

电脑端通信会议日历，展示会议简介、论文截止日期、会期、地点和官方来源。支持筛选、收藏、月历、时间线和 ICS 导出。

**全部使用 GitHub：网页由 GitHub Pages 托管，数据由 GitHub Actions 定时更新。用户只需打开网址，无需本地安装或运行服务。**

- 目标仓库：`defaultvalues/wireless_conference_info`
- 发布成功后的网址：`https://defaultvalues.github.io/wireless_conference_info/`
- 默认计划：每小时第 17 分钟检查会议官网，再发布网页和数据。
- 打开网页或点击“读取最新数据”只下载最近发布的快照，不会立即触发官网抓取。

## 首次部署（只用 GitHub 网页操作）

1. 在 GitHub 创建公开仓库 `defaultvalues/wireless_conference_info`，默认分支使用 `main`。
2. 上传本项目目录中的文件，确保仓库根目录直接包含 `package.json`、`collector.py`、`dist/`、`data/`、`scripts/`、`tests/` 和 `.github/workflows/`。不要多嵌套一层 `comm-deadlines/`。使用交付 ZIP 时先解压，再上传文件；GitHub 不会自动解压 ZIP。注意 `.github` 是隐藏目录，上传时必须包含。
3. 打开 **Settings → Pages → Build and deployment → Source**，选择 **GitHub Actions**。
4. 打开 **Actions → Update conferences and deploy Pages → Run workflow**，选择 `main` 并运行。首次上传触发的任务若因尚未设置 Pages 失败，在此重新运行即可。
5. 等待 `build` 和 `deploy` 成功；部署任务与 **Settings → Pages** 会显示正式网址。

不需要第三方服务账号、不需要自己购买域名，也不需要在网页中填入 token。工作流使用 GitHub 自动提供的 `GITHUB_TOKEN`。

公开仓库可使用 GitHub Free 的 Pages 功能。若组织策略或分支保护阻止 Actions 写入数据，需要允许该工作流写入 `main`，或按仓库规则调整数据保存方式；无需向网页提供凭据。

## 更新机制

```text
GitHub Actions（每小时 / 手动 / 代码更新）
  → 检查代码与日期逻辑
  → 读取已收录会议的官方来源
  → 更新 data/latest.json，保存到 GitHub 仓库
  → 构建并发布 GitHub Pages

浏览器打开网页 → 读取已发布的 data/latest.json
```

- 日期抓取失败或内容冲突时，保留每场会议上次成功读取的日期及时间戳。
- `data/latest.json` 持久保存在仓库，新一轮云端运行不会丢失上轮确认的延期信息。
- 数据提交使用工作流自带的 token，不会再次触发同类 push 工作流；此外 push 触发条件排除了只修改快照的提交。
- 页面显示最近一轮官网检查时间、逐条成功/失败状态。距离检查超过 3 小时会提示数据可能过期。
- 网页读取失败时，使用已随站点发布的快照或当前浏览器缓存。
- 同一 Pages 工作流串行执行；遇到代码推送冲突时停止该次发布，不强制覆盖其他提交。
- 全部官网抓取失败时仍发布明确标记为旧数据的快照，并在 Actions 日志给出 warning。
- 手动立即抓取：进入上述 Actions 工作流点击 **Run workflow**。网页刷新按钮不会执行抓取任务。

GitHub 定时任务可能延迟或被跳过；公开仓库长期无活动时可能停用定时工作流。若页面长时间显示过期，请检查 Actions 并重新启用任务。网页不承诺精确每小时更新或官网信息绝对实时。

## 数据范围与准确性

初始人工核查日期为 2026-10-27。自动检查仅覆盖已收录会议，不自动发现所有会议或未来新年度。

- 维护入口：`dist/data.js`。新增会议或更改来源后，代码提交会触发重新构建和发布。
- 优先解析论文投稿截止，排除摘要、最终稿、提案和删除线旧日期；多日期冲突时保留旧数据。
- IEEE ComSoc 目录中结构明确的会期和地点一同刷新；其他会议当前自动更新截稿日期，简介及会期地点仍为维护信息。
- 仅明确公布的时刻、时区用于精确倒计时。缺少时区时按北京时间日历日估算，导出全天提醒，不推定为 AoE。
- 学会目录可能晚于会议官网更新；投稿前请核对每场会议的最新 CFP。
- 收藏保存在当前浏览器。ICS 为导出快照，延期后需重新导入。

## 开发与检查（部署使用者不需要运行）

需要 Node.js 24 和 Python 3.10+，无 npm/pip 第三方依赖。

```bash
npm test                         # 31 项逻辑、页面启动和缓存测试
python3 scripts/update_data.py    # 执行一次官网检查并保存快照
npm run build:pages               # 构建 _site/ 静态发布目录
```

`npm run build` 生成维护数据 JSON 和离线 `preview.html`，不覆盖云端快照；`npm run build:pages` 使用 `data/latest.json` 生成前端内置快照与同版本 JSON。所有网页资源和数据地址为相对路径，支持 GitHub Pages 的仓库子路径。

`preview.html` 是离线预览，正式使用以 GitHub Pages 网址为准。`.openai/` 为旧托管流程的本地元数据，已排除在版本控制及交付包之外，不参与此方案。

## 验证状态

核心逻辑、前端加载、延期识别、失败保留、跨次运行持久化测试已通过。页面流程使用模拟 DOM 与网络。当前执行环境限制网络套接字，尚未完成真实浏览器、GitHub Actions 或线上发布实测；正式是否上线以 GitHub 的部署结果为准。

## 官方文档

- [GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [GitHub Actions 定时触发限制](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
