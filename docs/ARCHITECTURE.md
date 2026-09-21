# How RealBrowser works

RealBrowser connects a visible browser panel in DeepSeek Harness to a Chrome browser controlled through Chrome DevTools Protocol (CDP).

```text
Person and AI agent
        |
        v
DeepSeek Harness chat + RealBrowser panel
        |
        v
RealBrowser host -------- Chrome / Chromium
        |                       |
        +---- commands --------+
        +---- live frames <-----+
```

## Main parts

- **RealBrowser panel:** address bar, navigation, page view, viewport menu, and element selector.
- **Host controller:** starts Chrome, reconnects when needed, and sends browser commands.
- **Chrome DevTools Protocol:** handles navigation, clicks, typing, page reading, screenshots, and expressions.
- **Live frame stream:** sends current browser images to the panel while input travels back to Chrome.
- **Element picker:** finds the visible element under the pointer, captures it, and adds its selector and details to chat.

## View sizes

**Responsive** follows the panel size. Fixed presets emulate desktop and ultrawide monitors from Full HD to 4K, tablets, phones, and foldable devices. The preset changes page layout metrics, not only the preview box.

## Browser data

RealBrowser starts a dedicated Chrome profile for its session. Websites still control login rules, bot checks, permissions, and available content.
