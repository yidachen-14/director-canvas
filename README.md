# Director Canvas

[繁體中文](#繁體中文) · [English](#english)

---

## 繁體中文

Director Canvas 是 Obsidian 的無限白板插件，直接開啟並編輯你現有的 `.canvas` 檔。內建 Canvas 隨時可以打開同一個檔案，不會損壞內容。

### 特色

- **原生檔案**：讀寫 Obsidian 的 JSON Canvas。Director Canvas 額外的資料（文字格式、心智圖、媒體描述等）存在節點的 `vc` 欄位，內建 Canvas 照樣顯示基本內容。白板標題列可一鍵切換「用內建 Canvas 開啟」。
- **文字卡片**：Text、Note（完整多格式編輯：標題、清單、待辦、引用、程式碼、顏色、螢光筆、字級、對齊）、便利貼、Callout。輸入 `/` 叫出段落選單，支援 Markdown 快捷輸入；段落可以拖曳排序、拖到別張卡片或拖出白板成為新卡片。任何一行文字都能加上待辦框。
- **媒體與其他卡片**：圖片、影片（審片播放器：封面格、標記與入出點區段加註記、逐格、倍速、循環）、音訊、筆記連結與檔案、書籤（網址預覽）、看板、欄、畫筆（壓感筆跡、螢光筆、橡皮擦）、色票、行事曆（規劃表，會顯示各卡片中帶 📅 日期的待辦）。
- **心智圖**：仿 Boardmix。5 種佈局（向右、左右展開、組織圖、時間軸、大綱）、12 組配色、緊湊／正常／較大，以及主題的填充、邊框、外形、分支線樣式與分支顏色。Tab／Enter／Delete／方向鍵操作，可以直接打字（支援中文輸入法），拖曳改掛，可收合。
- **排列（仿 PureRef）**：最佳排列、依名稱／加入順序／路徑、隨機、四向推齊、堆疊、統一高度／寬度／大小／面積、水平／垂直分佈，以及對齊。
- **浮動選單**：選取物件時出現在上方（仿 Boardmix），單選時是該物件的工具，多選時提供大小、對齊、排列與組合。
- **匯出**：
  - **PDF**：向量文字可搜尋，可選依內容大小或 A4／A3／Letter。
  - **PNG**：1x／2x／3x，可選透明背景。
  - **HTML**：單一檔案，或 index.html 加素材資料夾；用任何瀏覽器都能平移、縮放、看小地圖、搜尋。
  - **打包**：白板連同用到的筆記與附件放進一個資料夾或 ZIP，內部路徑自動改好。
  - 範圍可以是整個白板、選取範圍或單一物件（從右鍵選單進入）。
- **改名同步**：檔案或資料夾改名、搬移時，所有白板（包含沒開啟的）裡的路徑一起更新。
- **介面語言**：18 種語言（繁體中文、简体中文、English、日本語、한국어、Deutsch、Español、Français、Italiano、Português (Brasil)、Русский、Українська、Nederlands、Polski、Türkçe、Bahasa Indonesia、Tiếng Việt、ไทย），預設跟隨 Obsidian，可在設定頁切換。

### 安裝

1. 從 Releases 下載 `main.js`、`manifest.json`、`styles.css`。
2. 放進保險庫的 `.obsidian/plugins/director-canvas/`。
3. 在「設定 → 第三方外掛程式」啟用 Director Canvas。

只支援桌面版（匯出、附件處理需要桌面環境）。

### 常用操作

| 操作 | 方式 |
| --- | --- |
| 建立卡片 | 雙擊空白處（類型可在設定中選擇），或使用工具列 |
| 平移／縮放 | 按住空白鍵拖曳；⌘＋滾輪或觸控板捏合 |
| 復原／重做 | ⌘Z／⌘⇧Z |
| 建立副本 | ⌘D |
| 排列 | 右鍵選單「排列」或 ⌥⌘＋字母（可在 Obsidian 快捷鍵設定中自訂） |
| 匯出 | 空白處右鍵「匯出整個白板」；卡片右鍵「匯出此物件」；多選右鍵「匯出選取範圍」 |

### 網路使用

只有書籤卡片會連網，用來抓取你加入的網址的預覽（標題、圖片）。其他功能（包括所有匯出）都在本機完成。

### 第三方程式庫

全部為 MIT 授權：ProseMirror、markdown-it、perfect-freehand、html-to-image、fflate。

---

## English

Director Canvas is an infinite whiteboard for Obsidian that opens and edits your existing `.canvas` files. The core Canvas can open the same files at any time without damage.

### Features

- **Native files**: reads and writes Obsidian's JSON Canvas. Anything extra (text formatting, mind maps, media descriptions…) lives in each node's `vc` field, so the core Canvas still shows the basic content. Switch a board to the core Canvas from its header.
- **Text cards**: Text, Note (full rich text: headings, lists, to-dos, quotes, code, colours, highlight, font size, alignment), Sticky note, Callout. `/` opens a block menu and Markdown shortcuts work. Drag paragraphs to reorder them, move them into another card, or drop them on the board as a new card. Any line can get a to-do checkbox.
- **Media and more**: pictures and videos (a review player: cover frame, point and range marks with notes, frame stepping, speed, loops), audio, notes and files, bookmarks (link previews), kanban, columns, pen (pressure ink, highlighter, eraser), colour swatches, and a calendar planner that also shows dated 📅 to-dos from other cards.
- **Mind maps**, Boardmix-style:
  - Five layouts (right, both sides, org chart, timeline, outline), twelve themes, and compact / normal / large sizes.
  - Per-topic fill, border, shape, branch line style and branch colour.
  - Tab / Enter / Delete / arrow keys, typing straight into a topic (input methods included), drag to re-parent, and folding.
- **Arranging, PureRef-style**: optimal, by name / added / path, random, push in four directions, stack, same height / width / size / area, distribute, and align.
- **Floating bar**: appears above the selection. It shows a card's own tools for a single card, and size, align, arrange and group for several cards.
- **Export**:
  - **PDF** with real, searchable text, fitted to the content or on A4 / A3 / Letter.
  - **PNG** at 1x / 2x / 3x, optionally transparent.
  - **HTML** as a single file or as index.html with an assets folder. It opens in any browser with pan, zoom, a minimap and search.
  - **Bundle**: the board plus the notes and attachments it uses, in a folder or ZIP, with paths rewritten.
  - Export the whole board, the selection, or one object (from its right-click menu).
- **Rename sync**: when files or folders are renamed or moved, paths in every board update, including boards that are closed.
- **Languages**: 18 interface languages (English, Traditional and Simplified Chinese, Japanese, Korean, German, Spanish, French, Italian, Brazilian Portuguese, Russian, Ukrainian, Dutch, Polish, Turkish, Indonesian, Vietnamese, Thai). Follows Obsidian by default; change it in Settings.

### Install

1. Download `main.js`, `manifest.json` and `styles.css` from Releases.
2. Put them in `.obsidian/plugins/director-canvas/` in your vault.
3. Enable Director Canvas in Settings → Community plugins.

Desktop only (export and attachment handling need the desktop app).

### Network use

Only bookmark cards go online, to fetch a preview (title, image) of the links you add. Everything else, including every export, happens on your computer.

### Third-party libraries

All MIT-licensed: ProseMirror, markdown-it, perfect-freehand, html-to-image, fflate.

### License

MIT
