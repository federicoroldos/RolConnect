# RolConnect — AI new tab + browsing agent for Microsoft Edge

RolConnect replaces Edge's new tab page with a chat that is also a web agent. It searches the web, reads pages, and can open, read, click and type in your tabs. The same UI runs in Edge's side panel next to whatever page you're on.

## Install (unpacked)

1. Open `edge://extensions`.
2. Turn on **Developer mode** (bottom-left).
3. Click **Load unpacked** and select this `RolConnect` folder (the one with `manifest.json`).
4. Open a new tab. Edge will ask whether to keep the changed new tab page: choose **Keep changes**.
5. Settings opens automatically. Connect at least one account (below).

Side panel: click the RolConnect toolbar icon, or press **Ctrl+Shift+Y**. You can also right-click a page or a text selection and choose **Ask RolConnect / Summarize this page**.

## Accounts

| Provider | What you need | Web search |
|---|---|---|
| **Claude** (Anthropic) | API key from platform.claude.com → Settings → API keys | Claude's built-in web search |
| **ChatGPT** (OpenAI) | API key from platform.openai.com/api-keys | OpenAI's built-in web search |
| **OpenCode** (Zen) | Zen API key from opencode.ai/zen; one key covers Claude, GPT, Kimi, GLM, Qwen, DeepSeek… | RolConnect's own search (DuckDuckGo → Bing) |
| **OpenCode Go** | Go API key from the OpenCode console (Go subscription); Kimi, GLM, Qwen, DeepSeek, MiniMax… within your plan limits | RolConnect's own search |

Third-party apps can't use Claude.ai or ChatGPT *subscriptions*, so Claude and ChatGPT use API keys billed to your API account. OpenCode Go is the exception: its key draws on your Go subscription. Paste a key and the model list loads automatically; pick a model from the dropdown, then **Use …** to switch to that provider. Under the chat box you can switch provider and model, and set the thinking effort (shown only for models that support it).

## What the agent can do

| Tool | What it does |
|---|---|
| `web_search` | Search the web (native for Claude/OpenAI, else DuckDuckGo/Bing) |
| `read_url` | Fetch a page and extract readable text (falls back to a background tab for JS-heavy sites) |
| `list_tabs`, `read_tab` | See open tabs and read any of them, including pages you're logged into |
| `open_tab`, `navigate_tab`, `scroll_page`, `close_tab` | Drive tabs. Tabs the agent opens go into a **RolConnect** tab group |
| `get_page_elements`, `click_element`, `type_text`, `press_key`, `wait` | Interact with pages. Password and card fields are refused |
| `request_approval` | Ask you before doing something important |
| `search_history` | Search your browsing history (only when turned on) |
| `save_memory`, `forget_memory` | Remember things about you across chats |
| `create_routine` | Set up a scheduled task (always asks first) |

**Permissions** (pill under the chat box):
- **Read**: only reads pages.
- **Guard** (default): asks before important actions such as sending, buying, deleting or publishing.
- **Full**: never asks.

**While it works:**
- Messages you type either steer the running task or wait in a queue (Settings → Agent).
- ⏸ pauses before the next action. Switching to one of the agent's tabs pauses it too, so you can take over; Resume continues.

**Memory**: Settings → Memory to view, edit, add or forget memories, and to choose how long task memories are kept.

**Routines** run on a schedule in a background tab and notify you when done:
- Schedules: every N minutes, daily, weekdays or weekly.
- A routine can start a new chat each time, or continue an existing one.
- Manage them in Settings → Routines.

## Privacy

- API keys and chats are stored only in this browser profile (`chrome.storage.local`). They are never synced.
- Your messages, and any page text the agent reads, go only to the provider you selected.
- With direct OpenAI, requests use `previous_response_id` within a turn, so OpenAI stores them under its normal API retention.

## Files

```
manifest.json         MV3 manifest (new tab override, side panel, context menus)
background.js         side panel behaviour, right-click menu, routine alarms
newtab.html / sidepanel.html
routine.html          headless runner for routines
css/app.css
js/app.js             UI: chats, composer, settings, confirmations
js/agent.js           provider adapters (Anthropic Messages, OpenAI Responses, Chat Completions) + agent loop
js/tools.js           search / read / tab-control tools
js/markdown.js        safe markdown renderer
js/storage.js         settings, chats, memories, routines
js/routines.js        schedule math
js/runner.js          runs a routine and saves its chat
```
