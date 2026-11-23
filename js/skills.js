// Site guides ("skills"): short, practical notes on how to get things done on popular sites.
// A guide loads automatically the first time a task touches its site, when the request
// mentions it, or when the agent asks for it with read_skill.
//
// { name, title, description, hosts: RegExp (matched against the hostname),
//   keywords: RegExp (matched against the user's request), body }

export const SKILLS = [
  {
    name: 'gmail',
    title: 'Gmail',
    description: 'Search, read, triage and draft email in Gmail.',
    hosts: /^mail\.google\.com$/,
    keywords: /\b(gmail|e-?mails?|inbox|correos?|mails?)\b/i,
    body: `- Go straight to filtered views by URL instead of clicking: https://mail.google.com/mail/u/0/#search/<query> with the query URL-encoded. Other views: #inbox, #starred, #sent, #drafts, #label/<Label>. A second signed-in account is /u/1/.
- Useful search operators: from:, to:, subject:, is:unread, is:starred, has:attachment, filename:pdf, newer_than:3d, older_than:1y, after:2026/01/31, before:, in:inbox, in:anywhere, category:primary, label:, larger:5M. Combine them: is:unread category:primary newer_than:2d.
- read_tab on a list view gives sender, subject, preview and date for every row. Work from that; open single threads only when the preview is not enough.
- To draft a new email, open https://mail.google.com/mail/?view=cm&fs=1&to=<addr>&su=<subject>&body=<text> (all URL-encoded). It opens a filled compose window. Check it with a fresh read before anything else.
- In compose, the To field turns typed addresses into chips: type the address, then press Enter or Tab. The body is an editable div labeled "Message Body".
- Sending (the Send button, or ctrl+Enter), archiving, deleting and marking as spam are consequential. Only send when the user asked for it; otherwise leave the draft open (Gmail saves drafts automatically) and say so.
- Gmail's single-key shortcuts only work if the user enabled them in Gmail settings. Don't rely on them.`,
  },
  {
    name: 'google-calendar',
    title: 'Google Calendar',
    description: 'Read the agenda and create events in Google Calendar.',
    hosts: /^calendar\.google\.com$/,
    keywords: /\b(calendar|calendario|meeting|meetings|event|events|agenda|schedule a|reuni[oó]n)\b/i,
    body: `- Read the schedule as text from the agenda view: https://calendar.google.com/calendar/u/0/r/agenda (or /r/day/YYYY/M/D, /r/week/YYYY/M/D, /r/month/YYYY/M/D for a given date). read_tab lists times, titles and locations.
- Create an event with a prefilled form: https://calendar.google.com/calendar/render?action=TEMPLATE&text=<title>&dates=<start>/<end>&details=<notes>&location=<place>&add=<guest email>. Dates look like 20261124T150000/20261124T160000 (local time) or 20261124/20261125 for an all-day event. Add &ctz=Europe/Madrid to pin a time zone.
- The prefilled page still needs Save. Saving an event with guests sends invitations, so treat Save as consequential.
- Event details open in a dialog when you click an event; its text includes the meeting link, guests and description.
- Find free time by reading the week view for the days in question, then list open slots in your answer.`,
  },
  {
    name: 'google-docs',
    title: 'Google Docs, Sheets and Slides',
    description: 'Read and edit Google Docs, Sheets and Slides files.',
    hosts: /^docs\.google\.com$/,
    keywords: /\b(google docs?|google sheets?|spreadsheet|hoja de c[aá]lculo|google slides|docs\.google)\b/i,
    body: `- The Docs and Sheets editors draw their content on a canvas, so read_tab on the editor shows little of the document. Read through these views instead, in a tab (they use the user's login):
  - Doc as plain HTML: https://docs.google.com/document/d/<ID>/mobilebasic
  - Sheet tab as an HTML table: https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:html&sheet=<tab name> (add &range=A1:F200 to limit it, or &tq=<query> like select A, C where D > 100).
  - Whole spreadsheet, every tab: https://docs.google.com/spreadsheets/d/<ID>/htmlview
  - Slides: https://docs.google.com/presentation/d/<ID>/htmlpresent or the /preview view.
- New files: https://docs.new, https://sheets.new, https://slides.new, https://forms.new.
- Editing needs computer use: click_at inside the document to place the caret, then type_keys. ctrl+a, ctrl+b, ctrl+z and other shortcuts work. Get a fresh screenshot to confirm the text landed where you meant.
- In Sheets, jump to a cell with the Name box (top left, left of the formula bar): click it, type a reference like B7, press Enter, then type the value and press Enter (or Tab to move right). Formulas start with =.
- Sharing, changing permissions and deleting files are consequential.`,
  },
  {
    name: 'google-drive',
    title: 'Google Drive',
    description: 'Find files in Google Drive.',
    hosts: /^drive\.google\.com$/,
    keywords: /\b(google drive|drive file|my drive|gdrive)\b/i,
    body: `- Search by URL: https://drive.google.com/drive/u/0/search?q=<query>. Operators: type:document, type:spreadsheet, type:pdf, owner:me, owner:<email>, before:2026-01-01, after:, title:"exact words".
- Other views: /drive/recent, /drive/shared-with-me, /drive/starred, /drive/my-drive.
- read_tab on a list view gives names, owners and dates. File links open in the matching editor; see the Google Docs guide for reading their content.
- Moving to trash, sharing and changing access are consequential.`,
  },
  {
    name: 'github',
    title: 'GitHub',
    description: 'Navigate repos, issues, pull requests and code on GitHub.',
    hosts: /(^|\.)github\.com$|^raw\.githubusercontent\.com$/,
    keywords: /\b(github|pull request|\bPR\b|repo|repository|issues?)\b/i,
    body: `- Use canonical URLs instead of clicking around: /<owner>/<repo>/issues?q=is:open label:bug, /<owner>/<repo>/pulls?q=is:open review-requested:@me, https://github.com/pulls (your PRs), https://github.com/issues (assigned to you), https://github.com/notifications.
- Search: https://github.com/search?q=<query>&type=repositories|code|issues|pullrequests|commits. Qualifiers: repo:o/r, org:, language:, author:, is:merged, created:>2026-01-01.
- Raw file text: https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<path> (read_url works for public repos; private ones need a tab).
- A PR's full diff: add .diff to the PR URL (…/pull/123.diff). The changed files view is …/pull/123/files, checks are …/pull/123/checks.
- Public data as JSON (no login, 60 requests an hour): https://api.github.com/repos/<o>/<r>, …/issues?state=open, …/releases/latest, …/commits?per_page=10.
- Commenting, approving, merging, closing, and pushing edits through the web editor are consequential.`,
  },
  {
    name: 'linkedin',
    title: 'LinkedIn',
    description: 'Search people, jobs and posts, and read messages on LinkedIn.',
    hosts: /(^|\.)linkedin\.com$/,
    keywords: /\blinked ?in\b/i,
    body: `- Search by URL: people https://www.linkedin.com/search/results/people/?keywords=<q>, jobs https://www.linkedin.com/jobs/search/?keywords=<q>&location=<place>, posts https://www.linkedin.com/search/results/content/?keywords=<q>, companies /search/results/companies/?keywords=<q>.
- Pages: feed /feed/, messages /messaging/, notifications /notifications/, a profile /in/<handle>/, full experience list /in/<handle>/details/experience/.
- Lists load as you scroll. Scroll, then read again to get more results.
- Visit profiles at a human pace: LinkedIn limits accounts that view many profiles quickly.
- Sending messages, connection requests, posting, reacting and applying to jobs are consequential.`,
  },
  {
    name: 'x',
    title: 'X (Twitter)',
    description: 'Search, read and draft posts on X.',
    hosts: /(^|\.)(x|twitter)\.com$/,
    keywords: /\b(twitter|tweets?|x\.com|post on x)\b/i,
    body: `- Search: https://x.com/search?q=<query>&f=live for latest, &f=top for top. Operators: from:handle, to:handle, since:2026-01-01, until:, min_faves:100, min_retweets:, filter:links, filter:media, -filter:replies, lang:en, "exact phrase".
- Pages: x.com/<handle>, x.com/<handle>/with_replies, x.com/notifications, x.com/messages, x.com/i/bookmarks.
- Timelines drop posts that scroll out of view. Read, scroll, read again, and collect as you go.
- A prefilled composer: https://x.com/intent/post?text=<encoded text>. Posts are 280 characters unless the account has Premium.
- Posting, replying, reposting, liking, following and sending DMs are consequential.`,
  },
  {
    name: 'youtube',
    title: 'YouTube',
    description: 'Find videos and read transcripts on YouTube.',
    hosts: /(^|\.)youtube\.com$|^youtu\.be$/,
    keywords: /\b(youtube|video|videos|transcript)\b/i,
    body: `- Search: https://www.youtube.com/results?search_query=<q>. A channel's uploads: https://www.youtube.com/@<handle>/videos. Subscriptions: /feed/subscriptions, history: /feed/history, Watch later: /playlist?list=WL.
- Video title and channel without loading the page: https://www.youtube.com/oembed?url=<video URL>&format=json (read_url).
- Transcript: on the video page, expand the description ("...more"), click "Show transcript", then read_tab. The panel lists every line with its timestamp. If there is no such button, the video has no transcript.
- Link to a moment with &t=<seconds>s.
- Subscribing, liking, commenting and adding to playlists are consequential.`,
  },
  {
    name: 'reddit',
    title: 'Reddit',
    description: 'Search and read Reddit threads.',
    hosts: /(^|\.)reddit\.com$/,
    keywords: /\breddit\b|\br\/\w+/i,
    body: `- old.reddit.com pages are lighter and read cleanly: https://old.reddit.com/r/<sub>/comments/<id>/.
- Add .json to a thread or listing URL for structured data with full comment trees (read_url).
- Search: https://www.reddit.com/search/?q=<q>&sort=top&t=year, or inside one community: /r/<sub>/search/?q=<q>&restrict_sr=1.
- For "what do people think of X" questions, read several threads and weigh upvoted comments over the original post.
- Posting, commenting, voting and joining are consequential.`,
  },
  {
    name: 'slack',
    title: 'Slack',
    description: 'Read channels, search and draft messages in Slack.',
    hosts: /(^|\.)slack\.com$/,
    keywords: /\bslack\b/i,
    body: `- The web app lives at app.slack.com/client/<team id>/<channel id>. Switch channels with ctrl+k and type the name.
- Search with the top search bar. Modifiers: in:#channel, in:@person, from:@person, after:2026-01-01, before:, during:month, has:link, has:pin, is:thread.
- Message lists only render what is on screen. Scroll up and read again for older messages.
- The composer is an editable box labeled "Message #channel". Enter sends, shift+Enter adds a line. Sending, reacting and editing are consequential, so type the draft and stop before Enter unless the user asked to send.`,
  },
  {
    name: 'notion',
    title: 'Notion',
    description: 'Read, search and edit pages in Notion.',
    hosts: /(^|\.)notion\.(so|site|com)$/,
    keywords: /\bnotion\b/i,
    body: `- read_tab reads a whole Notion page well, including toggles that are open. Closed toggles hide their content until clicked.
- Search across the workspace with ctrl+p (the Search dialog), then type.
- Every block is editable text. Click into a block and type; type "/" for the block menu (headings, to-dos, tables). Enter makes a new block.
- Database views show rows as a table. Open a row to see its properties and body.
- Sharing, publishing to the web and deleting pages are consequential.`,
  },
  {
    name: 'jira',
    title: 'Jira',
    description: 'Find and update issues in Jira (Atlassian Cloud).',
    hosts: /\.atlassian\.net$/,
    keywords: /\bjira\b|\bjql\b/i,
    body: `- An issue: https://<site>.atlassian.net/browse/<KEY-123>. Your work: /jira/your-work.
- Search with JQL in the URL: https://<site>.atlassian.net/issues/?jql=<encoded JQL>. Examples: assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC; project = ABC AND created >= -7d.
- An issue as JSON, using the user's login: /rest/api/3/issue/<KEY-123> (open in a tab, then read_tab).
- Confluence pages on the same site live under /wiki/.
- Transitions (status changes), assignments, comments and edits are consequential.`,
  },
  {
    name: 'linear',
    title: 'Linear',
    description: 'Find and update issues in Linear.',
    hosts: /(^|\.)linear\.app$/,
    keywords: /\blinear\b/i,
    body: `- Issues: linear.app/<workspace>/issue/<ABC-123>. Your issues: linear.app/<workspace>/my-issues/assigned. Inbox: linear.app/<workspace>/inbox.
- ctrl+k opens the command menu for almost any action (change status, assign, label). On an issue, "c" creates a new issue.
- Status changes, comments and new issues are consequential.`,
  },
  {
    name: 'trello',
    title: 'Trello',
    description: 'Read boards and cards in Trello.',
    hosts: /(^|\.)trello\.com$/,
    keywords: /\btrello\b/i,
    body: `- Boards: trello.com/b/<id>/<name>. Cards: trello.com/c/<id>.
- Add .json to a board or card URL and open it in a tab to get the full data (lists, cards, labels, members) with the user's login.
- On a board, "q" filters to cards assigned to the user and "f" opens filters.
- Moving, archiving and commenting on cards are consequential.`,
  },
  {
    name: 'amazon',
    title: 'Amazon',
    description: 'Search products, compare prices and check orders on Amazon.',
    hosts: /(^|\.)amazon\.[a-z.]+$/,
    keywords: /\bamazon\b/i,
    body: `- Use the user's regional store (amazon.com, amazon.es, amazon.co.uk…). Search: /s?k=<query>. A product: /dp/<ASIN>. Orders: /gp/css/order-history. Cart: /gp/cart/view.html.
- Listing pages show price, rating and review count. Check the product page for the seller, delivery date and "Other sellers" before recommending.
- "Buy Now" places an order in one click. Never click it, and never place an order, unless the user explicitly asked you to buy that exact item at that price.
- Adding to cart is fine when asked; checkout and payment steps are always consequential.`,
  },
  {
    name: 'outlook',
    title: 'Outlook',
    description: 'Read mail and calendar, and draft email in Outlook on the web.',
    hosts: /^outlook\.(office|office365|live)\.com$/,
    keywords: /\b(outlook|hotmail|office 365|microsoft 365)\b/i,
    body: `- Work accounts use outlook.office.com, personal accounts outlook.live.com. Mail: /mail/, calendar: /calendar/view/week.
- Search with the search box at the top. Operators: from:, to:, subject:, hasattachments:yes, received>=2026-01-01.
- A prefilled email: https://outlook.office.com/mail/deeplink/compose?to=<addr>&subject=<s>&body=<text>.
- A prefilled event: https://outlook.office.com/calendar/deeplink/compose?subject=<s>&startdt=2026-11-24T15:00:00&enddt=2026-11-24T16:00:00&location=<place>&body=<text>.
- Sending email and saving events with attendees are consequential.`,
  },
  {
    name: 'whatsapp',
    title: 'WhatsApp Web',
    description: 'Read chats and draft messages in WhatsApp Web.',
    hosts: /^web\.whatsapp\.com$/,
    keywords: /\bwhats ?app\b/i,
    body: `- Find a chat with the search box above the chat list, then click the result.
- Open a chat with a draft for a phone number: https://web.whatsapp.com/send?phone=<number with country code, digits only>&text=<encoded text>.
- Only the visible part of a conversation is loaded. Scroll up and read again for older messages.
- The message box is labeled "Type a message". Enter sends: treat it as consequential and stop before sending unless the user asked.`,
  },
  {
    name: 'discord',
    title: 'Discord',
    description: 'Read channels and draft messages in Discord.',
    hosts: /(^|\.)discord\.com$/,
    keywords: /\bdiscord\b/i,
    body: `- Channels: discord.com/channels/<server id>/<channel id>. ctrl+k opens the quick switcher for servers, channels and DMs.
- Only nearby messages are rendered. Scroll up and read again for history.
- Enter sends a message (consequential); shift+Enter adds a line.`,
  },
  {
    name: 'google-maps',
    title: 'Google Maps and travel',
    description: 'Places, directions, flights and hotels through Google.',
    hosts: /^(www\.)?google\.[a-z.]+$|^maps\.google\.[a-z.]+$/,
    keywords: /\b(maps?|directions|route|near me|restaurants?|flights?|hotels?|vuelos?|c[oó]mo llegar)\b/i,
    body: `- Places: https://www.google.com/maps/search/<query> (e.g. "coffee near Plaza Mayor Madrid"). read_tab lists names, ratings, review counts, prices and hours from the side panel.
- Directions: https://www.google.com/maps/dir/?api=1&origin=<a>&destination=<b>&travelmode=driving|walking|transit|bicycling. To leave at a set time, pick it in the page after it loads.
- Flights: https://www.google.com/travel/flights?q=<plain words, e.g. flights from MAD to JFK on 2026-12-20 returning 2027-01-05>. Hotels: https://www.google.com/travel/hotels?q=<city and dates>.
- Google Search filters: &tbs=qdr:d (past day), qdr:w, qdr:m, qdr:y; &tbm=nws for news. If Google shows a robot check, stop using it and switch to web_search.`,
  },
];

const byName = new Map(SKILLS.map((s) => [s.name, s]));

export const getSkill = (name) => byName.get(String(name || '').toLowerCase().trim());

export function skillForUrl(url) {
  let h = '';
  try { h = new URL(url).hostname.toLowerCase(); } catch { return null; }
  return SKILLS.find((s) => s.hosts.test(h)) || null;
}

export function skillsForText(text, limit = 2) {
  const t = String(text || '');
  return SKILLS.filter((s) => s.keywords.test(t)).slice(0, limit);
}

export const skillIndex = () => SKILLS.map((s) => `- ${s.name}: ${s.description}`).join('\n');

export const skillText = (s) => `## ${s.title} guide\n${s.body}`;
