<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.png">
  <img src=".github/assets/banner-light.png" alt="Rold: your new tab is an AI agent" width="100%">
</picture>

<br>

[![Browser](https://img.shields.io/badge/Microsoft%20Edge-116%2B-0078D7?style=for-the-badge&logo=microsoftedge&logoColor=white)](#installation)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-8b7bff?style=for-the-badge)](manifest.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-ff8a4c?style=for-the-badge)](LICENSE)

An AI chat on every new tab that is also a browsing agent. It searches the web, reads pages, and opens, clicks and types in your tabs, with **OpenCode Zen** (pay per use), **OpenCode Go** (subscription) or your **ChatGPT** plan, for Claude, GPT, Kimi, GLM and more.

</div>

<p align="center">
  <img src=".github/assets/agent.png" alt="Rold replying to an email: it opened the inbox and Ana's email, typed the reply and is waiting for approval before clicking Send." width="100%">
</p>

## Features

### 🧭 An agent that uses your browser
Ask for something and it does the steps: searches, reads pages, opens tabs, clicks buttons, fills in forms and presses keys. You see every step as it happens. The tabs it opens go into their own purple **Rold** tab group, so they never get mixed up with yours.

### 🖱️ Sees and uses any page
With **Computer use** on (Settings → Agent), it takes screenshots of tabs and uses a real mouse and keyboard, so it works with anything on screen: canvas apps, maps, editors, drag and drop. It works in background tabs without switching away from what you're doing. While it does, Edge shows a *"started debugging this browser"* bar, which goes away when the task ends; clicking **Cancel** on it stops screen control. With models that can't see images, it falls back to reading the page.

### 🛡️ You decide how much it can do
The pill under the chat box sets the permission mode:

| Mode | What the agent can do |
| :-- | :-- |
| **Read only** | Search and read pages and tabs. No clicking or typing. |
| **Guard** *(default)* | Everything, but it stops and asks before anything important: sending, buying, deleting, publishing, booking. |
| **Full access** | Everything, without asking. |

Password and card fields are always off-limits.

### 💬 Talk to it while it works
- **Steer:** type while it's working and the message reaches it right away, so you can correct it mid-task.
- **Queue:** or have your messages wait and run as soon as it finishes.
- **⏸ Pause** to take over the browser yourself, then **Resume**.
- Tasks keep running when you switch tabs or open another chat. If one needs your approval, the chat gets a badge and you get a notification.

### 🧠 Memory
It remembers what matters about you (where you live, how you like answers, who's who) and uses it in every chat. You can see, edit and delete every memory, and choose how long task memories last. It can also look through your browsing history if you turn that on.

### ⏰ Routines
Tasks that run on their own: every few minutes, daily, on weekdays or weekly. They run in the background and send a notification with the result. A routine can start a new chat each time or keep adding to an existing one, and you can ask the agent to set one up for you. **Routines** in the sidebar lists them, with their recent runs, and lets you add, run, pause, edit or delete one.

### 🪟 Side panel
The same chat next to whatever page you're on (**Ctrl+Shift+Y**). It knows which page you're looking at, so *"summarize this"* just works. You can also right-click any page or selection → **Ask Rold**.

<table>
  <tr>
    <td width="32%" valign="top"><img src=".github/assets/sidepanel.png" alt="The side panel summarizing the page next to it."></td>
    <td width="68%" valign="top"><img src=".github/assets/settings.png" alt="Settings: the memories the agent saved about you, which you can edit or delete."></td>
  </tr>
</table>

<a id="installation"></a>

## Installation

1. Download this repo (**Code → Download ZIP**) and extract it, or `git clone` it.
2. Open `edge://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the `Rold` folder (the one with `manifest.json`).
4. Open a new tab. When Edge asks about the changed new tab page, choose **Keep changes**.
5. Settings opens by itself: paste an OpenCode key or sign in with ChatGPT, then pick a model.

To update, pull or download the new version and click **↻** on Rold in `edge://extensions`.

## Accounts

| Provider | Plan | What you need | Models |
| :-- | :-- | :-- | :-- |
| **OpenCode Zen** | Pay per use | Key from [opencode.ai/zen](https://opencode.ai/zen) and a prepaid balance | Zen's paid models: Claude, GPT, Kimi, GLM, Qwen, DeepSeek… |
| **OpenCode Go** | Subscription | Key from your [OpenCode Go](https://opencode.ai/console/go) subscription | Everything in Go, including its free models |
| **ChatGPT** | Subscription | Sign in with a paid ChatGPT account (Plus, Pro, Business…). No API key | The GPT models your plan offers in Codex |

Zen's free models (the ones ending in `-free`, and `big-pickle`) only work inside OpenCode's own app, so Rold doesn't list them. ChatGPT sign-in uses the same login as OpenAI's Codex CLI, so usage counts toward your plan's Codex limits. Web search goes through DuckDuckGo, falling back to Bing, with every account.

Models load as soon as you paste a key or sign in. Under the chat box you can switch provider and model, and set the thinking effort for models that have it.

> [!NOTE]
> Claude models are used through OpenCode Zen or OpenCode Go. Anthropic accounts and OpenAI API keys aren't supported.

<details>
<summary><b>Everything the agent can do</b></summary>
<br>

| Tool | What it does |
| :-- | :-- |
| `web_search` | Search the web |
| `read_url` | Read any page (falls back to a background tab for sites that need JavaScript) |
| `list_tabs`, `read_tab` | See your open tabs and read them, including pages you're logged into |
| `browser_info` | Installed Rold and browser version, platform and current tab |
| `open_tab`, `navigate_tab`, `scroll_page`, `close_tab` | Drive tabs |
| `get_page_elements`, `click_element`, `type_text`, `press_key`, `wait` | Use pages: buttons, links, forms, menus |
| `screenshot` | See a tab, including background tabs |
| `click_at`, `type_keys`, `scroll_at`, `drag` | Real mouse and keyboard at screen coordinates (Computer use) |
| `request_approval` | Ask you before doing something important |
| `search_history` | Search your browsing history (only when turned on) |
| `save_memory`, `forget_memory` | Remember or forget things about you |
| `create_routine` | Set up a scheduled task (always asks first) |

</details>

> [!NOTE]
> Edge doesn't let extensions read or control browser-internal pages (`edge://`, `chrome://`) directly. Open Rold's side panel on one of those pages (toolbar button, or right-click → **Summarize this page with Rold**) and `read_tab` can capture the visible area and read it from the screenshot with a vision-capable model. For build and browser details, `browser_info` is faster.

## Privacy

- Your API keys, ChatGPT sign-in, chats and memories stay in this browser profile. They're never synced or sent anywhere else.
- Your messages, and the pages the agent reads, go only to the provider you picked. Web searches go to DuckDuckGo or Bing.
- No analytics, no tracking, no servers of its own.

<details>
<summary><b>Project structure</b></summary>
<br>

```
manifest.json         MV3 manifest: new tab override, side panel, context menus
background.js         side panel, right-click menu, routine alarms
newtab.html           new tab page
sidepanel.html        side panel
routine.html          background runner for routines
css/app.css
js/app.js             UI: chats, composer, settings, approvals
js/agent.js           providers (Anthropic Messages, OpenAI Responses, Chat Completions) + agent loop
js/tools.js           search, read, browser-control and computer-use tools
js/runner.js          runs a routine and saves its chat
js/routines.js        schedule math
js/storage.js         settings, chats, memories, routines
js/markdown.js        safe markdown renderer
```

No build step: edit a file and reload the extension.

</details>

## Bugs & feedback

Open an [issue](../../issues/new) with what you asked, what happened, and which provider and model you were using.

---

<sub>MIT License · Not affiliated with Anthropic, OpenAI, OpenCode or Microsoft.</sub>
