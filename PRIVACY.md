# RolConnect Privacy Policy

*Last updated: November 21, 2026*

RolConnect is a browser extension that turns the new tab page and the side panel into an AI assistant and browsing agent. It has no servers of its own, and its developer does not collect, receive, store or sell any of your data.

## What stays on your device

These are saved only in your browser profile, with `chrome.storage.local`. They are never synced, and they are never sent to the developer:

- the API keys you enter
- your chats, memories, routines and settings

Uninstalling the extension deletes all of it.

## What is sent to third parties, and when

RolConnect only sends data when you ask it to do something, or when one of your routines runs. Each request goes directly from your browser to these services:

| Service | What is sent | Why |
| :-- | :-- | :-- |
| The AI provider you choose: OpenCode (Zen or Go) | Your messages; the text of pages and tabs the agent reads; screenshots of tabs when Computer use is on; relevant memories; your API key | To generate answers and decide on the agent's next steps |
| DuckDuckGo or Bing (with OpenCode only) | Search queries | Web search |
| The websites the agent opens | Normal page requests, like any visit from your browser | To read pages and act on them |

How each AI provider handles what it receives is governed by that provider's own terms and privacy policy:

- [OpenCode](https://opencode.ai)

## Permissions and data access

- **Pages and tabs:** RolConnect reads a page only when it needs to for a task you started, or for one of your routines. It acts on pages (clicks, typing, screenshots) only for those tasks too.
- **Browsing history:** read only if you turn on *Use browsing history* in Settings. You can turn it off at any time.
- **Debugger:** used only while a task is running, to take screenshots and send mouse and keyboard input. Edge shows a bar while it's active, and RolConnect detaches when the task ends.
- **Sensitive fields:** the agent never types into password, one-time-code or payment card fields.

## Analytics and tracking

None. RolConnect has no analytics, telemetry, ads or tracking.

## Children

RolConnect is not directed at children under 13.

## Changes

Changes to this policy are published in this file in the [RolConnect repository](https://github.com/federicoroldos/RolConnect).

## Contact

Open an issue at <https://github.com/federicoroldos/RolConnect/issues>.
