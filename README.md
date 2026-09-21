# RealBrowser

RealBrowser is a full agentic web browser inside DeepSeek Harness. You and your AI agent share the same live browser: browse normally, let the agent navigate and interact, or select an element and attach it to chat.

## What it does

- Shares one live Chrome browser between you and the AI agent
- Navigates, clicks, types, reads pages, runs page actions, and takes screenshots
- Selects visible page elements and attaches their image and details to chat
- Tests responsive, desktop, tablet, mobile, and foldable layouts

## Install

RealBrowser requires DeepSeek Harness and Chrome or Chromium.

If you installed the legacy `realbrowser` package, remove it first:

```bash
dsh plugin --profile tauri remove realbrowser
```

```bash
dsh plugin --profile tauri add https://github.com/prv-ctech/dsh-realbrowser/releases/download/v0.0.2/dsh-realbrowser-0.0.2.tgz
```

Fully restart DeepSeek Harness, then open **RealBrowser** from the browser button or sidebar.

## Agent tools

| Tool | What it does |
| --- | --- |
| `realbrowser_navigate` | Opens a web address |
| `realbrowser_screenshot` | Captures the current page |
| `realbrowser_get_dom` | Reads the page or one matching element |
| `realbrowser_click` | Clicks a matching element |
| `realbrowser_type` | Types into a matching field |
| `realbrowser_evaluate` | Runs a page expression |

## View sizes

Use **Responsive** for the available panel size, or choose desktop, ultrawide, tablet, phone, and foldable presets. RealBrowser includes sizes from Full HD through 4K and common Apple, Samsung, Google, Microsoft, and Xiaomi devices.

- [Tool guide](https://github.com/prv-ctech/dsh-realbrowser/blob/master/docs/API.md)
- [How RealBrowser works](https://github.com/prv-ctech/dsh-realbrowser/blob/master/docs/ARCHITECTURE.md)
