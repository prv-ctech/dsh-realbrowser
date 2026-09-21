# RealBrowser tool guide

RealBrowser gives an AI agent six tools. The agent and the person use the same browser page.

## `realbrowser_navigate`

Opens a web address.

- Input: `url`
- Result: confirmation after navigation starts
- Example: open `https://example.com`

## `realbrowser_screenshot`

Saves a PNG image of the current page.

- Input: none
- Result: image path and file size
- Example: capture what the browser shows before clicking

## `realbrowser_get_dom`

Reads page HTML. An optional CSS selector limits the result to one element.

- Input: optional `selector`
- Result: matching HTML
- Example: read `main` or the complete page

## `realbrowser_click`

Clicks the first element matching a CSS selector.

- Input: `selector`
- Result: click confirmation
- Example: click `button[type="submit"]`

## `realbrowser_type`

Types text into an input matching a CSS selector.

- Inputs: `selector`, `text`
- Result: typing confirmation
- Example: type into `input[name="email"]`

## `realbrowser_evaluate`

Runs a JavaScript expression in the current page.

- Input: `expression`
- Result: the expression result
- Example: read `document.title`

## Select an element for chat

1. Open **RealBrowser**.
2. Turn on element selection.
3. Point to an element and select it.
4. RealBrowser attaches a cropped image and text details to chat.
5. Ask the agent to explain, change, test, or interact with that element.

Only run page expressions you trust. They execute inside the open page.
