# Director Canvas 开发交接

Obsidian 插件：无限白板，直接打开并编辑原生 `.canvas` 文件。插件 id `director-canvas`，仓库 `yidachen-14/director-canvas`（默认分支 `main`）。已上架 Obsidian 社区插件，当前版本见 `manifest.json`。

## 用户（陈导）的工作方式

- **回复语言**：回复用**繁体中文**；工作文档用简体中文。用户不是程序员，用结果说话，不要讲实现细节。
- **自己收尾**：自己弄出来的东西自己收拾，例如测试分支、被测试动过的白板。不要把杂事丢给用户。
- **说做不到之前先找办法**：用户的 Mac 上 Safari 已登录 GitHub。网页操作（建 Release、删分支等）先申请用 Safari 自己做，不要直接说"做不到，请你来"。
- **每次改动都在用户的 Obsidian 里实测**：
  - 在用户的白板上测试后，一定要用撤销还原，并和测试前的快照比对，确认没有留下改动。
  - 不要把按键打进白板：开发者控制台的焦点会丢，打字前先点一下控制台输入行。
- **测试分支**：`claude/test-build` 是专用测试分支，**保留它，之后测试都用它**。不要再开新分支：代理只允许推送，不能删除。

## 常用命令

```bash
npm install
npm run build      # tsc 检查 + esbuild 打包 → main.js
npm test           # vitest，目前 98 项
node scripts/i18n-missing.mjs   # 列出缺繁中翻译的文字
```

**Lint**（Obsidian 审核用的规则）不在仓库依赖里：typescript-eslint 的 peer 要求 TS < 6.1，和本项目的 TS 7 冲突。做法是另建一个目录：

```bash
mkdir -p /tmp/lint && cd /tmp/lint
cp -r <repo>/{src,tsconfig.json,package.json} .
npm install --legacy-peer-deps
npm install --legacy-peer-deps --no-save eslint@10.13.0 eslint-plugin-obsidianmd@0.4.2 typescript-eslint@8.72.1
cat > eslint.config.mjs <<'EOF'
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
export default defineConfig([
  { ignores: ["main.js", "node_modules/**", "test/**", "esbuild.config.mjs", "eslint.config.mjs", "vitest.config.*"] },
  ...obsidianmd.configs.recommended,
  { files: ["src/**/*.ts"], languageOptions: { parserOptions: { project: "./tsconfig.json" } } },
]);
EOF
npx eslint src      # 要求 0 个 error（warning 是旧的，可忽略）
```

每次改完都要通过：build、test、lint 0 error。

## 装进用户的 Obsidian 测试

**在用户电脑本机开发时（推荐）**：把 `main.js`、`manifest.json`、`styles.css` 复制到 `<vault>/.obsidian/plugins/director-canvas/`，然后在 Obsidian 里停用再启用插件，或执行"重新加载"。

**在云端开发时（无法直接写用户的文件）**：

1. 把三个文件提交到一个只放构建产物的仓库，强推到测试分支：`git push -f origin HEAD:refs/heads/claude/test-build`。
2. 在用户的 Obsidian 按 ⌥⌘I 打开开发者控制台。先定义 `dcI`（每次 Obsidian 重启后都要重新定义）：

```js
dcI = async (sha) => {
  const bases = [`https://raw.githubusercontent.com/yidachen-14/director-canvas/${sha}/`, `https://cdn.jsdelivr.net/gh/yidachen-14/director-canvas@${sha}/`];
  const get = async f => { for (const b of bases) { try { const r = await fetch(b + f, { cache: 'no-store' }); if (r.ok) return await r.text(); } catch {} } throw new Error('fetch ' + f); };
  const dir = app.vault.configDir + '/plugins/director-canvas/', out = [];
  for (const f of ['main.js', 'manifest.json', 'styles.css']) { const t = await get(f); await app.vault.adapter.write(dir + f, t); out.push(f + ':' + t.length); }
  await app.plugins.disablePlugin('director-canvas'); await app.plugins.enablePlugin('director-canvas');
  return out.join(' ');
};
```

3. 用完整的 commit SHA 安装。中国网络下经常失败，所以要重试：

```js
for (let i = 0; i < 8; i++) { try { console.warn('INSTALLED', await dcI('<完整SHA>')); break } catch (e) { console.warn('fail', i, e) } }
```

插件重新加载后，打开着的白板对象会换新，测试前要重新取 board：
`app.workspace.getLeavesOfType('director-canvas').find(l => l.view.file?.path.includes('DLOVA')).view.board`。

撤销以后，节点对象也会换新，要用 `board.model.node(id)` 重新取。

## 发布新版本

1. 改版本号：`manifest.json`、`package.json`、`package-lock.json`（前两处 `"version"`），并在 `versions.json` 加上 `"x.y.z": "1.7.2"`。
2. build、test、lint 通过后提交，推送到 `main`。
3. 在 GitHub 建 Release：tag 就是版本号（不加 v），选择"Create new tag on publish"，target 选 `main`，说明用英文写。
   - 云端的会话不能建 Release，也不能推送 tag，所以要用用户 Mac 上的 Safari（需要申请权限）。
4. `.github/workflows/release.yml` 会自动 build，并把三个文件附加到 Release 上。确认 Release 页面上有 main.js、manifest.json、styles.css，而且 manifest 里的版本号正确。
5. 已经上架，不用再提交 obsidian-releases。用户在 Obsidian 里"检查更新"就能拿到。

**注意**：main 上的 manifest 版本号一改，对应的 Release 必须尽快建好。否则别人检查更新时会找不到文件。

## 代码地图

- `src/main.ts`：插件入口，ribbon，接管 `.canvas`。`src/takeover.ts` 负责关掉内置 Canvas 时的回退。
- `src/view/canvas-view.ts`：Obsidian 视图。
- `src/board/`：
  - `board.ts`：白板核心，管选区和渲染。
  - `interactions.ts`：指针、触控、缩放、键盘。多选缩放在 `startMultiResize` 里，以整组外框上的对边或对角为固定点。
  - `context-bar.ts`：选取后出现的浮动工具栏，包括尺寸面板（原尺寸、25/50/75%）和多选"转换为"。
  - `menus.ts`：右键菜单。
  - `shortcuts.ts`：所有快捷键都在这一张表里，用户可以改。
  - `connect-ui.ts`：连线，先点一下、再点一下完成。
  - `pen.ts`：画笔，仿 Freeform。
  - `insets.ts`：移动端避开系统底栏。
- `src/cards/`：各种卡片。
  - `media.ts`：图片、视频、音频卡。
  - `video-player.ts`：审片播放器。两排控制条和卡片一体；JKL 的 L 不加速。
  - `gif-player.ts`：仿 PureRef 的 GIF 控制，用 ImageDecoder，支持全部暂停或播放。
  - `crop.ts`：非破坏性裁剪和翻转，数据在 `vc.crop`、`vc.flipH`、`vc.flipV`。
  - `text-cards.ts`：文字、笔记、便利贴、提示框。
- `src/mindmap/`：心智图，仿 Boardmix。
- `src/export/`：PDF、PNG（分块渲染，上限 64M 像素）、HTML（固定输出文件夹）、打包。
- `src/i18n/`：18 种语言。繁中在 `zh-tw.ts`，其他在 `locales/*.ts`。新增文字时每个语言都要补。
- `styles.css`：全部样式。

## 数据约定

- 扩展资料都放在节点的 `vc` 字段里，这样内置 Canvas 仍然能打开同一个文件。
- 一次修改就是一个撤销步骤，用 `board.model.transact()` 包起来。只是预览、不算撤销步骤的，用 `beginGesture().preview()`。
- 媒体卡的高度 = 画面高度 + `vc.descH`（描述、链接栏、播放条加起来的高度）。
- `vc.ctrlIn` 和 `vc.ctrlH` 用于旧版播放条的迁移。迁移只会让卡片变窄，绝不能变宽、推动或盖住其他卡片。
  - 以前出过一次事：迁移把用户的 DLOVA 白板弄乱，后来用文件恢复还原到当天 16:46 的版本。

## 还没做

- PureRef 的按住键操作还没做：按住 C 拉框裁剪、按住 V 在框内移动图片、按住 Shift+V 缩放框内图片。目前用拖框边、拖框内来完成。
