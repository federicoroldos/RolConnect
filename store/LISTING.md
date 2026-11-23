# Edge Add-ons submission

Copy and paste these into [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview). Upload the package from `store/build.ps1`. The images are in `store/images/`.

## Package

Upload `dist/Rold-<version>.zip`. To build it, run:

```powershell
powershell -ExecutionPolicy Bypass -File store\build.ps1
```

## Availability

- **Visibility:** Public
- **Markets:** All markets

## Properties

- **Category:** Productivity
- **Website:** https://github.com/federicoroldos/Rold
- **Support contact:** https://github.com/federicoroldos/Rold/issues
- **Mature content:** unchecked

## Privacy

### Single purpose description

Rold replaces the new tab page and adds a side panel with an AI assistant that can browse for the user: it searches the web, reads pages and carries out tasks in the user's tabs, using an OpenCode Zen or OpenCode Go API key the user provides, or the user's own ChatGPT sign-in.

### Permission justifications

| Permission | Justification |
| :-- | :-- |
| `storage` | Saves the user's settings, API keys, chats, memories and routines locally in the browser profile. |
| `unlimitedStorage` | Chat history and memories can exceed the default 10 MB local storage quota over time. |
| `tabs` | Lists the open tabs and reads their titles and URLs, so the assistant can tell which page the user means. Also opens, switches and closes the tabs the agent works in, and opens OpenAI's sign-in page when the user signs in with ChatGPT, reading the sign-in result from that tab's address. |
| `activeTab` | Captures the visible area of a browser-internal page (for example `edge://extensions`) after the user invokes Rold on that tab, because Edge blocks direct access to those pages. |
| `scripting` | Reads the text of a page, and clicks or types on it, when the user asks the assistant to read that page or act on it. |
| `sidePanel` | Shows the assistant in the side panel, next to the page the user is viewing. |
| `contextMenus` | Adds "Ask Rold" to the right-click menu for pages and selected text. |
| `favicon` | Shows site icons next to the sources the assistant cites. |
| `tabGroups` | Keeps the tabs the agent opens in their own labeled "Rold" tab group, so they don't mix with the user's tabs. |
| `search` | When the user switches the message box to Search, sends what they typed to the browser's default search engine, instead of to the assistant. |
| `alarms` | Runs the scheduled routines the user creates (for example, a daily news summary). |
| `notifications` | Tells the user when a routine finishes, or when a running task needs their approval. |
| `debugger` | Computer use, which the user can turn off in Settings. While a task runs, the debugger takes screenshots of the agent's tab and sends real mouse and keyboard input, so the agent can use interfaces the DOM can't reach: canvas apps, maps, editors, drag and drop. It attaches only during a task the user started, Edge shows its debugging bar the whole time, and it detaches when the task ends. |
| `history` (optional) | Requested only when the user turns on "Use browsing history" in Settings, so the assistant can find pages the user visited before. |
| Host permission `<all_urls>` | The user can ask the agent to read or act on any website they choose. Pages are read only for tasks the user starts, or for routines they created. |

### Remote code

No. All code ships in the package. The extension calls the AI provider's API over HTTPS, but it never loads or runs remote code.

### Data usage

Check these:

- **Personally identifiable information:** the user's messages and memories can contain it.
- **Authentication information:** the user's own API key, which is sent only to OpenCode, or their ChatGPT sign-in token, which is sent only to OpenAI.
- **Personal communications:** pages the user asks the agent to read, such as email, can contain them.
- **Web history:** only when "Use browsing history" is on.
- **Website content:** page text and screenshots of the tabs the agent works in.

Certify all three statements: the data isn't sold to third parties, it isn't used for purposes unrelated to the single purpose, and it isn't used to determine creditworthiness or for lending.

### Privacy policy URL

https://github.com/federicoroldos/Rold/blob/main/PRIVACY.md

## Store listing (English)

### Description

```
Rold turns every new tab, and the side panel, into an AI assistant that can also use your browser for you.

Ask a question and it searches the web, reads the best sources and answers with links. Ask for a task and it does the steps itself: it opens tabs, clicks, fills in forms and presses keys, and you watch every step as it happens.

• Works with Claude, GPT, Kimi, GLM and more through OpenCode Zen (pay per use) or OpenCode Go (subscription), or sign in with your ChatGPT plan. No API key needed for ChatGPT.
• Computer use: it sees tabs through screenshots and uses a real mouse and keyboard, so it can handle canvas apps, maps, editors and drag and drop.
• You choose the permission level: Read only, Guard (it asks before sending, buying, deleting or publishing), or Full access. It never types passwords or card numbers.
• Talk to it while it works: steer it mid-task, queue follow-ups, or pause and take over.
• Tasks keep running when you switch tabs or chats, and you get a notification when one needs your approval.
• Memory: it remembers what matters about you, and you can see, edit and delete every memory.
• Routines: scheduled tasks, like a morning news summary or a price check, that run in the background and notify you. Manage them from Routines in the sidebar.
• Side panel (Ctrl+Shift+Y) next to any page, so "summarize this" just works. Or right-click → Ask Rold.

Private by design: your keys, chats and memories stay in your browser. Requests go directly to OpenCode or OpenAI, and there are no analytics or tracking.

Open source (MIT): https://github.com/federicoroldos/Rold
```

### Images

| Field | File |
| :-- | :-- |
| Extension logo (300 × 300) | `store/images/logo-300.png` |
| Small promotional tile (440 × 280) | `store/images/tile-small-440x280.png` |
| Large promotional tile (1400 × 560) | `store/images/tile-large-1400x560.png` |
| Screenshots (1280 × 800) | `store/images/screenshot-1-agent.png` … `screenshot-5-routines.png` |

### Search terms

At most 7 terms and 21 words.

```
AI agent; new tab; side panel; Claude; ChatGPT; browser automation; AI assistant
```

## Notes for certification

```
Rold needs an OpenCode API key to answer. For this test, use an OpenCode Zen key (small prepaid balance): <PASTE KEY HERE>

How to test:
1. Open a new tab. Choose "Keep changes" if Edge asks about the new tab page. Settings opens.
2. Under Accounts → OpenCode Zen, paste the key above, pick any Claude or GPT model from the list (only paid models are listed), and click "Use OpenCode Zen".
3. Ask: "What's on the front page of Hacker News?" The agent searches, opens a tab in the "Rold" group, reads it and answers.
4. Computer use: ask "Open https://excalidraw.com and draw a rectangle." Edge shows its debugging bar while the agent works. The bar goes away when the task ends.
5. Side panel: press Ctrl+Shift+Y on any page and ask "Summarize this page".

The debugger permission is used only during a task the user starts (screenshots and mouse/keyboard input), and it can be turned off in Settings → Agent → Computer use. ChatGPT sign-in (Settings → Accounts → ChatGPT) is optional and needs a paid ChatGPT account. No remote code, analytics or developer-side servers.
```
