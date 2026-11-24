// VetroAI's plugin registry: every plugin the app offers, in one place.
//
// A plugin bundles:
//   - who it is: id, name, tagline, description, category, icon, color;
//   - how people find it: aliases (names it answers to after "@"),
//     keywords (search terms), triggers (whole words in a message that switch
//     an installed plugin on without an @-mention);
//   - what it does: skills, each with the instructions the model is given
//     when the skill is in use (sent with the message, added to the system
//     prompt by the backend: backend/src/config/plugins.js);
//   - commands: "/name" shortcuts typed in the composer, expanded into a
//     prompt before sending;
//   - connectors: outside services it reads from. `env` names the backend
//     environment variable that holds the key; `live` names the backend data
//     source (backend/src/services/pluginLiveService.js) that is fetched before
//     the model answers, so scores, weather and prices are real, never made up.
//
//   - flags for what the app does around the answer: `search` (always runs
//     a web search), `research` (runs DeepSearch when picked), `readsLinks`
//     (the backend reads a linked page), `files` (the answer comes as a file).
//
// Ids are stable: saved install state and the backend refer to them.

export const PLUGIN_STORAGE_KEY = "vetroai_plugins_v1";

export const PLUGIN_CATEGORIES = [
  "Productivity", "Research", "Developer", "Documents", "Data", "Live info",
  "Writing", "Learning", "Creative", "Travel", "Career", "Role packs",
];

const skill = (id, name, description, instructions, triggers = []) => ({ id, name, description, instructions, triggers });
// `file`: this command's answer comes as the plugin's file (Sheets' /sheet).
const command = (name, description, prompt, { file = false } = {}) => ({ name, description, prompt, ...(file ? { file: true } : {}) });

export const PLUGIN_CATALOG = [
  // ── Research ────────────────────────────────────────────────────────────
  {
    id: "web-search",
    // Runs a web search for every message it's used in (App.jsx triggerAI).
    search: true,
    name: "Web Search",
    tagline: "Fresh answers with live sources",
    description: "Search the live web when a question needs current information, links, or citations.",
    category: "Research",
    icon: "globe",
    color: "#2563eb",
    featured: true,
    permissions: ["Send search queries", "Read public webpages"],
    aliases: ["web", "search", "web search"],
    keywords: ["internet", "google", "lookup", "sources", "citations", "current"],
    triggers: ["latest", "current", "today", "news", "price", "source", "website"],
    skills: [skill("cited-answer", "Cited answers", "Answers from live results with numbered sources.",
      "Use the live web results provided with the question. Cite the claims they support inline as [1], [2]; never invent a link, a source or a number that isn't in them. Say so plainly when the results don't answer the question.")],
    commands: [command("search", "Search the web for something", "Search the web and answer with sources: {args}")],
    connectors: [{ id: "tavily", name: "Web search", env: "TAVILY_API_KEY", optional: true, note: "Falls back to a free search without a key." }],
  },
  {
    id: "deep-report",
    // Runs VetroAI's DeepSearch research when picked (App.jsx triggerAI).
    research: true,
    name: "Deep Report",
    tagline: "A researched report with sources",
    description: "Plan the research, read several sources and write a structured report with citations and open questions.",
    category: "Research",
    icon: "report",
    color: "#1d4ed8",
    aliases: ["report", "deep report", "research"],
    keywords: ["research", "report", "analysis", "literature", "sources", "investigate", "study"],
    triggers: ["research report", "in-depth report", "literature review"],
    skills: [skill("report", "Research report", "A sectioned report built only on its sources.",
      "Write a research report: a two-sentence answer up front, then sections with ## headings for the main findings, each claim cited to the sources given. Mark where sources disagree and how sure the evidence is. End with open questions. Never cite a source you weren't given.")],
    commands: [command("report", "Write a researched report on a topic", "Research this and write a cited report: {args}")],
    connectors: [{ id: "tavily", name: "Web search", env: "TAVILY_API_KEY", optional: true }],
  },
  {
    id: "page-digest",
    // The backend reads a linked page before the model answers
    // (backend services/pluginLiveService.js, "page").
    readsLinks: true,
    name: "Page & PDF Digest",
    tagline: "Summarise any link or PDF",
    description: "Read a web page, article or attached PDF and give the gist, the key points and what to read in full.",
    category: "Research",
    icon: "file",
    color: "#0369a1",
    aliases: ["digest", "summarise", "summarize", "tldr"],
    keywords: ["summary", "summarise", "summarize", "url", "link", "article", "pdf", "tldr", "gist"],
    triggers: ["summarise this", "summarize this", "tldr"],
    skills: [skill("digest", "Summarise a page", "TL;DR, key points and what matters most.",
      "Summarise the page or document the user gave: one-sentence TL;DR, a short paragraph, then the key points as bullets. Quote numbers exactly. If the text wasn't provided or couldn't be read, say so instead of guessing at its contents.")],
    commands: [command("tldr", "Summarise a link or the attached PDF", "Summarise this: {args}")],
    connectors: [],
  },

  // ── Productivity ────────────────────────────────────────────────────────
  {
    id: "day-planner",
    name: "Day Planner",
    tagline: "Plan days, weeks and schedules",
    description: "Turn tasks, deadlines and appointments into a realistic schedule with time blocks and buffers.",
    category: "Productivity",
    icon: "calendar",
    color: "#0f766e",
    aliases: ["planner", "calendar", "day planner", "schedule"],
    keywords: ["calendar", "schedule", "plan", "timetable", "agenda", "appointment", "routine", "week"],
    triggers: ["schedule", "timetable", "plan my day", "plan my week"],
    skills: [skill("timeblock", "Time-block a day", "A schedule with realistic blocks and breaks.",
      "Build a schedule as a table (Time | Task | Notes). Put the hardest work in the person's best hours, add buffers between blocks and breaks every 90 minutes, and keep fixed appointments where they are. Flag anything that doesn't fit instead of squeezing it in.")],
    commands: [command("plan", "Plan a day or week", "Plan my schedule: {args}")],
    connectors: [{ id: "calendar", name: "Calendar", optional: true, note: "Works from what you type; calendar sync is not connected." }],
  },
  {
    id: "mail-drafter",
    name: "Mail Drafter",
    tagline: "Clear emails in the right tone",
    description: "Draft, reply to and shorten emails, with a subject line and the tone the situation needs.",
    category: "Productivity",
    icon: "mail",
    color: "#0284c7",
    aliases: ["email", "mail", "mail drafter"],
    keywords: ["email", "mail", "reply", "message", "letter", "outlook", "gmail", "follow up"],
    triggers: ["email", "e-mail", "reply to this"],
    skills: [skill("draft-email", "Draft an email", "Subject line plus a ready-to-send body.",
      "Write the email ready to send: a specific subject line, a greeting, the point in the first two sentences, any details, one clear ask with a date if needed, and a sign-off. Keep it short. Match the relationship (manager, client, friend). Don't invent facts, names or dates; leave [placeholders] for missing ones.")],
    commands: [command("email", "Draft an email", "Draft an email: {args}"), command("reply", "Write a reply to an email", "Write a reply to this email: {args}")],
    connectors: [],
  },
  {
    id: "meeting-notes",
    name: "Meeting Notes",
    tagline: "Notes, decisions and action items",
    description: "Turn a transcript or rough notes into a summary, the decisions made and who does what by when.",
    category: "Productivity",
    icon: "notes",
    color: "#7c3aed",
    aliases: ["meeting", "notes", "meeting notes", "minutes"],
    keywords: ["meeting", "minutes", "transcript", "action items", "standup", "summary", "decisions"],
    triggers: ["meeting notes", "minutes", "action items"],
    skills: [skill("minutes", "Write minutes", "Summary, decisions and action items.",
      "From the transcript or notes, write: a 3-sentence summary; Decisions (bullets); Action items as a table (Owner | Action | Due). Only list owners and dates that appear in the notes; write 'unassigned' otherwise.")],
    commands: [command("minutes", "Turn notes into meeting minutes", "Turn these notes into meeting minutes: {args}")],
    connectors: [],
  },
  {
    id: "task-tracker",
    name: "Task Tracker",
    tagline: "To-dos, priorities and progress",
    description: "Break goals into tasks, prioritise them and keep a running checklist in the chat.",
    category: "Productivity",
    icon: "check",
    color: "#16a34a",
    aliases: ["tasks", "todo", "task tracker"],
    keywords: ["todo", "to-do", "tasks", "checklist", "priorities", "kanban", "backlog", "project"],
    triggers: ["to-do", "todo", "checklist"],
    skills: [skill("breakdown", "Break down a goal", "Tasks with priority and effort.",
      "Break the goal into concrete tasks a person can start today, each one action. Show them as a checklist (- [ ] task), grouped by priority (Now / Next / Later), with a rough effort per task. When the user reports progress, show the updated list.")],
    commands: [command("todo", "Turn a goal into a checklist", "Break this into a prioritised checklist: {args}")],
    connectors: [],
  },

  // ── Developer ───────────────────────────────────────────────────────────
  {
    id: "code-runner",
    name: "Code Runner",
    tagline: "Write, debug, and explain code",
    description: "Get implementation help, debugging guidance, and runnable code across popular languages.",
    category: "Developer",
    icon: "terminal",
    color: "#059669",
    featured: true,
    permissions: ["Read code you provide", "Use the code workspace"],
    aliases: ["code", "coder", "code runner"],
    keywords: ["programming", "python", "javascript", "java", "script", "function", "coding"],
    triggers: ["code", "program", "function", "script", "algorithm"],
    skills: [skill("write-code", "Write code", "Complete, runnable code with how to run it.",
      "Write complete, runnable code in a fenced block with its language tag, using the fastest correct approach. Say in a sentence how to run it and what it prints. State assumptions (versions, inputs) rather than leaving gaps.")],
    commands: [command("code", "Write code for a task", "Write code: {args}")],
    connectors: [],
  },
  {
    id: "code-review",
    name: "Code Review",
    tagline: "Find bugs before they ship",
    description: "Review code for bugs, security issues, performance and readability, most severe first.",
    category: "Developer",
    icon: "review",
    color: "#047857",
    aliases: ["review", "code review", "reviewer"],
    keywords: ["review", "pull request", "pr", "bugs", "security", "refactor", "lint", "audit"],
    triggers: ["review my code", "code review", "review this code"],
    skills: [skill("review", "Review code", "Findings ranked by severity with fixes.",
      "Review the code like a senior engineer. List findings most severe first; for each: the line or function, what goes wrong and with what input, and the fix as a short code block. Cover correctness, security, performance, then readability. Don't pad with praise; say 'no issues found' for an area that has none.")],
    commands: [command("review", "Review code for bugs and issues", "Review this code: {args}")],
    connectors: [],
  },
  {
    id: "bug-hunter",
    name: "Bug Hunter",
    tagline: "From error message to fix",
    description: "Read an error or stack trace, find the root cause and give the smallest fix that solves it.",
    category: "Developer",
    icon: "bug",
    color: "#b91c1c",
    aliases: ["debug", "bug", "bug hunter", "debugger"],
    keywords: ["debug", "error", "exception", "stack trace", "traceback", "crash", "bug", "fix"],
    triggers: ["error", "exception", "traceback", "stack trace", "not working", "crash"],
    skills: [skill("root-cause", "Find the root cause", "Cause, fix and how to check it.",
      "Find the root cause, not the symptom. Explain in plain words what goes wrong and why, show the fixed code, and say how to confirm the fix (a command or test). If the error could have several causes, list them most likely first and what to check for each.")],
    commands: [command("debug", "Debug an error or stack trace", "Help me debug this: {args}")],
    connectors: [],
  },
  {
    id: "repo-helper",
    name: "Repo Helper",
    tagline: "Git and GitHub, explained and done right",
    description: "Git commands, branching, pull requests, Actions workflows and repository housekeeping.",
    category: "Developer",
    icon: "git",
    color: "#24292f",
    aliases: ["github", "git", "repo", "repo helper"],
    keywords: ["github", "git", "repository", "pull request", "merge", "rebase", "actions", "ci", "commit"],
    triggers: ["git", "github", "pull request", "merge conflict", "rebase"],
    skills: [skill("git", "Git help", "Exact commands with what each does.",
      "Give the exact git or gh commands in a bash block, one per line, then what each one does. Warn before anything that rewrites history or deletes work (force push, reset --hard) and give the safer alternative.")],
    commands: [command("git", "Get the git commands for a task", "Give me the git commands to: {args}")],
    connectors: [{ id: "github", name: "GitHub", optional: true, note: "Explains and writes commands; repository access is not connected." }],
  },
  {
    id: "sql-helper",
    name: "SQL Helper",
    tagline: "Queries, schemas and tuning",
    description: "Write and explain SQL queries, design tables and speed up slow queries.",
    category: "Developer",
    icon: "database",
    color: "#0e7490",
    aliases: ["sql", "sql helper", "database"],
    keywords: ["sql", "query", "database", "postgres", "mysql", "sqlite", "join", "index", "schema"],
    triggers: ["sql", "query", "database", "postgres", "mysql"],
    skills: [skill("sql", "Write SQL", "A correct query with the index it needs.",
      "Write the SQL in a ```sql block for the dialect the user names (ask once if it matters and isn't given). Explain the query in a few sentences, note the index that makes it fast, and point out NULL and duplicate edge cases.")],
    commands: [command("sql", "Write or fix a SQL query", "Write SQL for: {args}")],
    connectors: [],
  },
  {
    id: "regex-lab",
    name: "Regex Lab",
    tagline: "Regular expressions that work",
    description: "Build, explain and test regular expressions with examples that match and don't.",
    category: "Developer",
    icon: "regex",
    color: "#9333ea",
    aliases: ["regex", "regexp", "regex lab"],
    keywords: ["regex", "regexp", "regular expression", "pattern", "match", "validate"],
    triggers: ["regex", "regexp", "regular expression"],
    skills: [skill("regex", "Build a regex", "Pattern, explanation and test cases.",
      "Give the pattern in a code block for the language asked (default JavaScript), explain each part in a short table, and list examples it matches and ones it must not. Mention the flags needed.")],
    commands: [command("regex", "Build a regular expression", "Write a regex that: {args}")],
    connectors: [],
  },

  // ── Documents & files ───────────────────────────────────────────────────
  {
    id: "doc-writer",
    name: "Docs",
    tagline: "Reports, letters and long documents",
    description: "Write and edit structured documents: reports, proposals, letters, policies and guides.",
    category: "Documents",
    icon: "doc",
    color: "#2563eb",
    aliases: ["docs", "document", "doc writer"],
    keywords: ["document", "word", "docx", "report", "proposal", "letter", "policy", "essay", "guide"],
    triggers: ["write a report", "proposal", "document"],
    // Picked by name, its reply comes as a Word file.
    files: ["docx"],
    skills: [skill("document", "Write a document", "A finished document, downloadable as Word.",
      "Write the complete document, not an outline: one # title, ## sections in a logical order, full paragraphs, and tables where data is compared. Use [placeholders] for details you don't have.")],
    commands: [command("doc", "Write a document", "Write a document: {args}", { file: true })],
    connectors: [],
  },
  {
    id: "sheet-builder",
    name: "Sheets",
    tagline: "Spreadsheets, formulas and tables",
    description: "Design spreadsheets, write Excel and Google Sheets formulas and build tables from data.",
    category: "Documents",
    icon: "sheet",
    color: "#15803d",
    aliases: ["sheets", "excel", "spreadsheet"],
    keywords: ["excel", "spreadsheet", "google sheets", "formula", "vlookup", "xlookup", "pivot", "table"],
    triggers: ["excel", "spreadsheet", "formula", "vlookup", "pivot"],
    // Picked by name (chip, @, /command), its reply comes as an Excel file
    // (App.jsx filesAskedBy → lib/documentExport.js).
    files: ["xlsx"],
    skills: [
      skill("sheet", "Build a spreadsheet", "Tables that download as an Excel file with real formulas.",
        "Build the spreadsheet as Markdown tables: start with a # title naming it, then one table per sheet (a header row, then the separator row) with a ### heading above each naming the sheet. Put plain numbers in number cells (1200, not ₹1,200; put the unit in the header, e.g. 'Amount (₹)'). Where a cell should calculate, write the Excel formula starting with = (e.g. =SUM(B2:B13), =B2*C2), using that table's cell addresses with row 1 as the header. Add a totals row when it helps. Keep any explanation to a line or two after the tables."),
      skill("formula", "Write formulas", "The formula, where it goes and why.",
        "Give each formula with the cell it goes in, then explain it in a sentence. Prefer XLOOKUP/FILTER over older functions when the user's app supports them. Show a small example table with the expected result.", ["formula", "vlookup", "xlookup"]),
    ],
    commands: [command("sheet", "Make an Excel spreadsheet", "Make a spreadsheet: {args}", { file: true }), command("formula", "Write a spreadsheet formula", "Write a spreadsheet formula that: {args}")],
    connectors: [],
  },
  {
    id: "slide-maker",
    name: "Slides",
    tagline: "Presentation decks from an idea",
    description: "Outline and write slide decks with titles, key points and speaker notes.",
    category: "Documents",
    icon: "slides",
    color: "#ea580c",
    aliases: ["slides", "deck", "presentation", "ppt"],
    keywords: ["slides", "presentation", "deck", "powerpoint", "pptx", "pitch", "speaker notes"],
    triggers: ["slides", "presentation", "deck", "powerpoint"],
    skills: [skill("deck", "Build a deck", "A slide deck the app can show.",
      "Build the whole deck as one ```slides block in the format given under [SLIDES] (the app shows it as slides with a .pptx download). One idea per slide, a title slide first, varied layouts, and a clear closing slide. Never write the slides out as text as well.")],
    commands: [command("slides", "Make a slide deck", "Make a slide deck about: {args}")],
    connectors: [],
  },
  {
    id: "pdf-tools",
    name: "PDF Tools",
    tagline: "Read, extract and compare PDFs",
    description: "Pull text, tables and figures out of attached PDFs, compare versions and answer questions about them.",
    category: "Documents",
    icon: "pdf",
    color: "#dc2626",
    aliases: ["pdf", "pdf tools"],
    keywords: ["pdf", "extract", "table", "compare", "contract", "invoice", "scan", "form"],
    triggers: ["pdf"],
    skills: [skill("pdf", "Work with a PDF", "Answers quoted from the PDF, with page numbers.",
      "Answer from the attached PDF's text only. Quote the relevant passage and give its page when known. Rebuild tables as Markdown tables. If no PDF text was provided, ask the user to attach it rather than guessing.")],
    commands: [command("pdf", "Ask about the attached PDF", "From the attached PDF: {args}")],
    connectors: [],
  },

  // ── Data ────────────────────────────────────────────────────────────────
  {
    id: "data-analyst",
    name: "Data Analyst",
    tagline: "Charts, comparisons, and insights",
    description: "Turn pasted or uploaded data into clear analysis, tables, metrics, and visualizations.",
    category: "Data",
    icon: "chart",
    color: "#7c3aed",
    featured: true,
    permissions: ["Read files you attach", "Create charts in chat"],
    aliases: ["analyst", "data", "data analyst"],
    keywords: ["analysis", "statistics", "insights", "metrics", "trend", "dataset"],
    triggers: ["analyze data", "analyse data", "dataset", "statistics"],
    skills: [skill("analyse", "Analyse data", "Findings, numbers and one chart.",
      "Analyse the data the user gave: the headline finding first, then the supporting numbers (exact, with units), a comparison table if useful and one chart when it makes the pattern clearer. Say what the data can't tell you.")],
    commands: [command("analyse", "Analyse some data", "Analyse this data: {args}")],
    connectors: [],
  },
  {
    id: "chart-maker",
    name: "Chart Maker",
    tagline: "The right chart for your numbers",
    description: "Pick the right chart type and draw it in the chat from numbers you paste or describe.",
    category: "Data",
    icon: "bars",
    color: "#6d28d9",
    aliases: ["chart", "charts", "graph", "chart maker"],
    keywords: ["chart", "graph", "plot", "visualise", "visualize", "bar chart", "line chart", "pie", "data viz"],
    triggers: ["chart", "graph", "plot", "visualise", "visualize"],
    skills: [skill("chart", "Draw a chart", "A chart block with a one-line takeaway.",
      "Draw it as one ```chartjs block in the format given under [CHART], choosing the type that fits (line for change over time, bar to compare, scatter for relationships; doughnut only for parts of a whole). Plot the user's numbers, or well-known reference figures labelled approximate; never invent data. Add one sentence on what it shows.")],
    commands: [command("chart", "Make a chart from numbers", "Make a chart of: {args}")],
    connectors: [],
  },
  {
    id: "csv-explorer",
    name: "CSV Explorer",
    tagline: "Clean and question CSV files",
    description: "Profile a CSV, clean messy columns and answer questions with exact numbers.",
    category: "Data",
    icon: "table",
    color: "#4338ca",
    aliases: ["csv", "csv explorer"],
    keywords: ["csv", "tsv", "columns", "rows", "clean", "duplicates", "pandas", "dataset"],
    triggers: ["csv"],
    skills: [skill("profile", "Profile a CSV", "Columns, types, gaps and outliers.",
      "Profile the CSV: row and column counts, each column's type, missing values and odd values, as a table. Answer questions with exact figures computed from the rows provided, and give a pandas snippet the user can run on the full file when they only pasted part of it.")],
    commands: [command("csv", "Profile or question a CSV", "Look at this CSV: {args}")],
    connectors: [],
  },

  // ── Live info ───────────────────────────────────────────────────────────
  {
    id: "sports-live",
    name: "Live Sports",
    tagline: "Scores, fixtures, and match context",
    description: "Live cricket and football scores, fixtures and results from real sports feeds.",
    category: "Live info",
    icon: "trophy",
    color: "#ca8a04",
    featured: true,
    live: "sports",
    permissions: ["Read public sports feeds"],
    aliases: ["sports", "scores", "live sports", "cricket", "football"],
    keywords: ["cricket", "football", "soccer", "ipl", "score", "scores", "fixtures", "results", "match", "live score", "world cup", "premier league", "t20", "odi", "test match"],
    triggers: ["score", "match", "fixture", "standings", "cricket", "football", "ipl", "league"],
    skills: [skill("scores", "Live scores", "Current scores and status from the live feed.",
      "Answer from the LIVE DATA block only: teams, score, overs or minute, and status. Name when the data was fetched. If the block says the feed isn't connected or has no match for the request, say that plainly; never invent or estimate a score.")],
    commands: [command("score", "Live score of a match or team", "Live score: {args}"), command("fixtures", "Upcoming fixtures", "Upcoming fixtures for: {args}")],
    connectors: [
      { id: "highlightly", name: "Highlightly (cricket & football)", env: "HIGHLIGHTLY_API_KEY" },
      { id: "cricapi", name: "CricAPI (cricket fallback)", env: "CRICAPI_KEY", optional: true, note: "Only used when HIGHLIGHTLY_API_KEY isn't set." },
      { id: "api-sports", name: "API-Football (football fallback)", env: "API_SPORTS_KEY", optional: true, note: "Only used when HIGHLIGHTLY_API_KEY isn't set." },
    ],
  },
  {
    id: "weather-now",
    name: "Weather",
    tagline: "Current weather and forecast",
    description: "Current conditions and a short forecast for any city, from a live weather service.",
    category: "Live info",
    icon: "weather",
    color: "#0ea5e9",
    live: "weather",
    aliases: ["weather", "forecast"],
    keywords: ["weather", "forecast", "rain", "temperature", "humidity", "wind", "climate today", "monsoon"],
    triggers: ["weather", "forecast", "temperature", "raining"],
    skills: [skill("weather", "Weather report", "Now, today and the next days.",
      "Answer from the LIVE DATA block only: the place, the current temperature and conditions, today's high and low and chance of rain, and the next days briefly. If the block has no data for the place, say so and ask which city.")],
    commands: [command("weather", "Weather for a city", "Weather in {args}")],
    connectors: [{ id: "open-meteo", name: "Open-Meteo", keyless: true }],
  },
  {
    id: "news-brief",
    name: "News Brief",
    tagline: "Today's headlines on any topic",
    description: "The latest headlines on a topic or place, with sources and when they were published.",
    category: "Live info",
    icon: "news",
    color: "#e11d48",
    live: "news",
    aliases: ["news", "headlines", "news brief"],
    keywords: ["news", "headlines", "breaking", "today", "latest", "current events"],
    triggers: ["headlines", "breaking news"],
    skills: [skill("brief", "News brief", "Headlines with source and time.",
      "Brief the user from the LIVE DATA headlines: the most important stories first, one or two sentences each, with the source and how long ago. Don't add stories that aren't in the data. If the news feed isn't connected, say so.")],
    commands: [command("news", "Latest headlines on a topic", "Latest news about: {args}")],
    connectors: [{ id: "newsdata", name: "NewsData.io", env: "NEWS_API_KEY" }],
  },
  {
    id: "markets",
    name: "Markets",
    tagline: "Stock and crypto prices",
    description: "Live crypto prices and stock quotes with the day's change.",
    category: "Live info",
    icon: "trend",
    color: "#059669",
    live: "markets",
    aliases: ["markets", "stocks", "crypto", "stock", "market"],
    keywords: ["stock", "stocks", "share price", "crypto", "bitcoin", "ethereum", "btc", "eth", "nifty", "sensex", "nasdaq", "market"],
    triggers: ["stock price", "share price", "bitcoin", "ethereum", "crypto", "btc"],
    skills: [skill("quote", "Price check", "Price, day change and time.",
      "Give prices from the LIVE DATA block only, with currency, the 24-hour or day change and the time fetched. Never give investment advice as certainty. If a symbol isn't in the data or the stock feed isn't connected, say so.")],
    commands: [command("price", "Price of a stock or coin", "Current price of {args}")],
    connectors: [
      { id: "coingecko", name: "CoinGecko (crypto)", keyless: true },
      { id: "alphavantage", name: "Alpha Vantage (stocks)", env: "ALPHAVANTAGE_API_KEY" },
    ],
  },
  {
    id: "currency-convert",
    name: "Currency",
    tagline: "Live exchange rates",
    description: "Convert between currencies at today's reference rates.",
    category: "Live info",
    icon: "currency",
    color: "#65a30d",
    live: "currency",
    aliases: ["currency", "fx", "exchange rate", "convert"],
    keywords: ["currency", "exchange rate", "convert", "usd", "inr", "eur", "gbp", "dollar", "rupee", "euro", "forex"],
    triggers: ["exchange rate", "convert currency", "usd to inr", "dollar to rupee"],
    skills: [skill("convert", "Convert currency", "Amount at today's rate, with the date.",
      "Convert using the rate in the LIVE DATA block: show the amount, the rate and the rate's date. Mention that banks and cards add their own margin. If the pair isn't in the data, say so.")],
    commands: [command("convert", "Convert an amount between currencies", "Convert {args}")],
    connectors: [{ id: "frankfurter", name: "Frankfurter (ECB rates)", keyless: true }],
  },

  // ── Writing ─────────────────────────────────────────────────────────────
  {
    id: "grammar-check",
    name: "Grammar Check",
    tagline: "Fix grammar, spelling and clarity",
    description: "Correct grammar and spelling, then show what changed and why.",
    category: "Writing",
    icon: "spell",
    color: "#0d9488",
    aliases: ["grammar", "proofread", "grammar check", "spellcheck"],
    keywords: ["grammar", "spelling", "proofread", "punctuation", "correct", "edit", "typo"],
    triggers: ["proofread", "grammar", "correct this", "fix my english"],
    skills: [skill("proofread", "Proofread", "The corrected text and a list of changes.",
      "Return the corrected text first, keeping the writer's voice and meaning. Then list the changes that matter (not every comma) with a one-line reason each.")],
    commands: [command("fix", "Fix grammar and spelling", "Proofread and correct: {args}")],
    connectors: [],
  },
  {
    id: "translator",
    name: "Translate",
    tagline: "Natural translations, any language",
    description: "Translate text naturally, keeping tone and meaning, including Indian languages.",
    category: "Writing",
    icon: "translate",
    color: "#2563eb",
    aliases: ["translate", "translator", "translation"],
    keywords: ["translate", "translation", "tamil", "hindi", "telugu", "malayalam", "kannada", "spanish", "french", "language"],
    triggers: ["translate", "in tamil", "in hindi", "to english"],
    skills: [skill("translate", "Translate", "A natural translation, with notes on tricky phrases.",
      "Translate naturally, not word for word, keeping the tone and register. Give the translation first. For idioms or words with no direct equivalent, add a short note. Add a romanised version for non-Latin scripts when the user may not read the script.")],
    commands: [command("translate", "Translate text", "Translate: {args}")],
    connectors: [],
  },
  {
    id: "tone-rewriter",
    name: "Tone Rewriter",
    tagline: "Say it formally, kindly or briefly",
    description: "Rewrite text in a different tone: formal, friendly, persuasive, shorter or simpler.",
    category: "Writing",
    icon: "pen",
    color: "#c026d3",
    aliases: ["rewrite", "tone", "tone rewriter", "paraphrase"],
    keywords: ["rewrite", "tone", "formal", "polite", "friendly", "paraphrase", "shorten", "persuasive"],
    triggers: ["rewrite", "make it formal", "make it polite", "paraphrase"],
    skills: [skill("rewrite", "Rewrite in a tone", "The rewritten text, ready to use.",
      "Rewrite the text in the tone asked, keeping every fact. Give one version ready to paste; add a second, shorter alternative only if the user may want a choice.")],
    commands: [command("rewrite", "Rewrite text in a new tone", "Rewrite this: {args}")],
    connectors: [],
  },
  {
    id: "resume-builder",
    name: "Resume & Cover Letter",
    tagline: "Get shortlisted",
    description: "Write and improve resumes and cover letters tailored to a job description.",
    category: "Writing",
    icon: "resume",
    color: "#0891b2",
    aliases: ["resume", "cv", "cover letter", "resume builder"],
    keywords: ["resume", "cv", "cover letter", "ats", "job application", "linkedin", "bullet points", "portfolio"],
    triggers: ["resume", "cv", "cover letter"],
    skills: [skill("resume", "Improve a resume", "Impact bullets matched to the job.",
      "Rewrite bullets as achievement + measurable result, starting with a strong verb. Match keywords from the job description truthfully; never invent experience, employers or numbers (use [X%] placeholders). For a cover letter: 3 short paragraphs, specific to the company.")],
    commands: [command("resume", "Improve a resume for a job", "Improve my resume for this job: {args}"), command("coverletter", "Write a cover letter", "Write a cover letter for: {args}")],
    connectors: [],
  },

  // ── Learning ────────────────────────────────────────────────────────────
  {
    id: "study-coach",
    name: "Study Coach",
    tagline: "Simple, exam-ready learning",
    description: "Explain concepts in simple terms, create revision plans, and format scoring-friendly answers.",
    category: "Learning",
    icon: "study",
    color: "#4f46e5",
    featured: true,
    permissions: ["Use study details you provide"],
    aliases: ["study", "teacher", "study coach"],
    keywords: ["learn", "exam", "revision", "notes", "syllabus", "school", "college", "homework"],
    triggers: ["exam", "revision", "study", "notes", "definition"],
    skills: [skill("exam-answer", "Exam answers", "Scoring-friendly structure.",
      "Teach in simple terms first, then give the exam-ready version: a direct definition, the key points, and a short example or diagram description. Match the marks asked (2-mark short, 10-mark detailed).")],
    commands: [command("explain", "Explain a topic for an exam", "Explain for my exam: {args}")],
    connectors: [],
  },
  {
    id: "flashcard-maker",
    name: "Flashcards",
    tagline: "Cards you can flip in the chat",
    description: "Turn a topic or your notes into flip cards for quick revision.",
    category: "Learning",
    icon: "cards",
    color: "#7c3aed",
    aliases: ["flashcards", "cards", "flashcard"],
    keywords: ["flashcards", "flash cards", "revise", "memorise", "memorize", "anki", "cards"],
    triggers: ["flashcards", "flash cards"],
    skills: [skill("cards", "Make flashcards", "A deck of flip cards.",
      "Make the cards as one ```flashcards block in the format given under [FLASHCARDS] (the app plays them as flip cards): 10 unless asked otherwise, one fact per card, short fronts, answers under 25 words. Never list the cards as text as well.")],
    commands: [command("cards", "Make flashcards on a topic", "Make flashcards on: {args}")],
    connectors: [],
  },
  {
    id: "quiz-master",
    name: "Quiz Me",
    tagline: "Test yourself, one question at a time",
    description: "A multiple-choice quiz on any topic, scored, with explanations for mistakes.",
    category: "Learning",
    icon: "quiz",
    color: "#db2777",
    aliases: ["quiz", "quiz me", "test me"],
    keywords: ["quiz", "test", "mcq", "practice questions", "exam practice", "trivia"],
    triggers: ["quiz me", "test me", "mcq"],
    skills: [skill("quiz", "Run a quiz", "An interactive scored quiz.",
      "Start the quiz straight away as one ```quiz block in the format given under [QUIZ] (the app plays it and scores it): 5 questions unless asked otherwise, four options each, one correct, a simple explanation per answer. Mix easy and hard. Never show the questions or answers outside the block.")],
    commands: [command("quiz", "Quiz me on a topic", "Quiz me on: {args}")],
    connectors: [],
  },
  {
    id: "explain-simply",
    name: "Explain Simply",
    tagline: "Explain it like I'm five",
    description: "Explain anything with everyday words, a familiar analogy and no jargon.",
    category: "Learning",
    icon: "bulb",
    color: "#f59e0b",
    aliases: ["eli5", "simple", "explain simply"],
    keywords: ["eli5", "simple", "simply", "beginner", "analogy", "kid", "easy explanation", "like i'm five"],
    triggers: ["eli5", "like i'm five", "like im 5", "in simple words"],
    skills: [skill("eli5", "Explain simply", "Plain words and one analogy.",
      "Explain with everyday words a 10-year-old knows and one analogy from daily life. Short sentences, no jargon (or explain it immediately). End with one sentence on why it matters.")],
    commands: [command("eli5", "Explain something simply", "Explain simply: {args}")],
    connectors: [],
  },

  // ── Creative, travel, career ────────────────────────────────────────────
  {
    id: "image-studio",
    name: "Image Studio",
    tagline: "Create and refine visuals",
    description: "Plan image prompts, generate visual concepts, and help refine creative assets.",
    category: "Creative",
    icon: "image",
    color: "#db2777",
    featured: true,
    permissions: ["Use prompts you provide", "Create image requests"],
    aliases: ["image", "images", "image studio"],
    keywords: ["image", "picture", "logo", "poster", "art", "illustration", "wallpaper", "generate"],
    triggers: ["generate image", "create image", "make image", "illustration", "logo", "poster", "wallpaper"],
    skills: [skill("image", "Make an image", "A detailed prompt and the image.",
      "Turn the request into a precise image prompt (subject, style, composition, lighting, colours) and create it. Ask only about details that change the result.")],
    commands: [command("image", "Create an image", "Create an image of {args}")],
    connectors: [],
  },
  {
    id: "maps",
    name: "Maps",
    tagline: "Places, routes, and local results",
    description: "Find places and present useful locations, route guidance, and clickable map links.",
    category: "Travel",
    icon: "map",
    color: "#ea580c",
    permissions: ["Use locations you provide", "Read public place data"],
    aliases: ["map", "maps", "places"],
    keywords: ["places", "route", "directions", "nearby", "travel", "trip", "restaurant", "hotel"],
    triggers: ["near me", "nearby", "directions", "route", "restaurant", "hotel"],
    skills: [skill("places", "Find places", "Places with map links.",
      "Give specific places with area and a map link each, and a map block when several are listed. When the places come from your own knowledge rather than search results, say in one line that they're worth checking on the map before going (places close or move). Don't claim opening hours, prices or availability unless they were fetched.")],
    commands: [command("near", "Find places nearby", "Find {args} near me")],
    connectors: [{ id: "google-maps", name: "Google Maps", env: "GOOGLE_MAPS_API_KEY", optional: true }],
  },
  {
    id: "jobs",
    // Listings come from a web search, never from memory.
    search: true,
    name: "Job Search",
    tagline: "Discover roles and prepare to apply",
    description: "Search relevant roles and improve resumes, applications, and interview preparation.",
    category: "Career",
    icon: "briefcase",
    color: "#0891b2",
    permissions: ["Use career details you provide", "Read public job listings"],
    aliases: ["jobs", "job", "job search"],
    keywords: ["jobs", "vacancy", "hiring", "career", "interview", "openings", "internship"],
    triggers: ["job", "vacancy", "career", "interview", "hiring"],
    skills: [skill("jobs", "Find jobs", "Relevant openings and how to apply.",
      "List openings only from the search results provided, each with company, role, location and link. If no results came through, say so plainly and point to where to search (with the exact search to type); don't name companies as currently hiring or quote salaries as fact without a source (say they're rough and need checking). Then give concrete next steps for applying and preparing.")],
    commands: [command("jobs", "Find job openings", "Find jobs: {args}")],
    connectors: [{ id: "jsearch", name: "Job listings", env: "JSEARCH_API_KEY", optional: true }],
  },

  // ── Role packs ──────────────────────────────────────────────────────────
  {
    id: "sales-pack",
    name: "Sales Pack",
    tagline: "Prospecting, outreach and deal reviews",
    description: "Account research, cold outreach, call prep, objection handling and deal reviews.",
    category: "Role packs",
    icon: "handshake",
    color: "#ea580c",
    aliases: ["sales", "sales pack"],
    keywords: ["sales", "prospect", "lead", "outreach", "cold email", "pipeline", "deal", "objection", "crm", "pitch"],
    triggers: ["cold email", "sales pitch", "objection handling", "prospect"],
    skills: [
      skill("outreach", "Outreach", "Short, specific first messages.",
        "Write outreach under 120 words: one line on why this person, the problem you solve for companies like theirs with a concrete result, and one low-effort ask. No flattery or buzzwords.", ["cold email", "outreach"]),
      skill("objections", "Objection handling", "Acknowledge, ask, answer.",
        "For each objection: acknowledge it, ask one question to find the real concern, answer with evidence, and check back. Give the words to say.", ["objection"]),
    ],
    commands: [command("outreach", "Write a prospecting message", "Write a sales outreach message: {args}")],
    connectors: [{ id: "crm", name: "CRM", optional: true, note: "Works from what you paste; CRM sync is not connected." }],
  },
  {
    id: "marketing-pack",
    name: "Marketing Pack",
    tagline: "Campaigns, copy and content plans",
    description: "Campaign plans, ad and landing-page copy, social posts, SEO briefs and content calendars.",
    category: "Role packs",
    icon: "megaphone",
    color: "#db2777",
    aliases: ["marketing", "marketing pack"],
    keywords: ["marketing", "campaign", "ad copy", "seo", "social media", "instagram", "content calendar", "brand", "landing page", "copywriting"],
    triggers: ["ad copy", "content calendar", "seo", "marketing plan", "social media post"],
    skills: [
      skill("copy", "Ad & page copy", "Headlines and copy variants.",
        "Write for one audience and one action: 3 headline options, body copy, and a call to action. Lead with the benefit, use the customer's words, keep claims provable.", ["ad copy", "landing page"]),
      skill("calendar", "Content calendar", "A month of posts in a table.",
        "Plan content as a table (Date | Channel | Topic | Hook | Format), mixing educational, proof and promotional posts.", ["content calendar"]),
    ],
    commands: [command("campaign", "Plan a marketing campaign", "Plan a marketing campaign for: {args}")],
    connectors: [],
  },
  {
    id: "legal-pack",
    name: "Legal Pack",
    tagline: "Contracts read in plain language",
    description: "Summarise contracts, flag risky clauses, draft simple agreements and explain legal terms. Not legal advice.",
    category: "Role packs",
    icon: "scale",
    color: "#475569",
    aliases: ["legal", "legal pack", "contract"],
    keywords: ["legal", "contract", "agreement", "nda", "clause", "terms", "lease", "compliance", "privacy policy"],
    triggers: ["contract", "nda", "agreement", "clause"],
    skills: [skill("contract-review", "Contract review", "Plain-language summary and risky clauses.",
      "Summarise the contract in plain language, then a table of clauses worth attention (Clause | What it means | Risk | Suggested change). Quote the clause text. Say clearly that this isn't legal advice and when a lawyer should look at it. Don't state jurisdiction-specific law as certain.")],
    commands: [command("contract", "Review a contract", "Review this contract: {args}")],
    connectors: [],
  },
  {
    id: "finance-pack",
    name: "Finance Pack",
    tagline: "Budgets, models and money questions",
    description: "Budgets, loan and EMI maths, financial statement reading, forecasts and investment basics. Not financial advice.",
    category: "Role packs",
    icon: "wallet",
    color: "#15803d",
    aliases: ["finance", "finance pack", "budget"],
    keywords: ["finance", "budget", "emi", "loan", "interest", "investment", "tax", "forecast", "cash flow", "balance sheet", "sip"],
    triggers: ["budget", "emi", "loan", "cash flow", "balance sheet"],
    skills: [skill("money-maths", "Money maths", "Exact calculations, shown.",
      "Do the calculation exactly and show the formula with the numbers in it (EMI, compound interest, CAGR). Put results in a table. State assumptions (rate, tenure, inflation). Not financial advice: say so when recommending.")],
    commands: [command("emi", "Work out a loan EMI", "Work out the EMI for: {args}"), command("budget", "Make a budget", "Make a monthly budget for: {args}")],
    connectors: [],
  },
  {
    id: "hr-pack",
    name: "People & HR Pack",
    tagline: "Hiring, policies and people questions",
    description: "Job descriptions, interview kits, onboarding plans, policies and tricky conversations.",
    category: "Role packs",
    icon: "people",
    color: "#7c3aed",
    aliases: ["hr", "people", "hr pack"],
    keywords: ["hr", "hiring", "job description", "interview questions", "onboarding", "policy", "performance review", "employee"],
    triggers: ["job description", "interview questions", "onboarding", "performance review"],
    skills: [skill("hiring", "Hiring kit", "JD, scorecard and interview questions.",
      "For a role: a job description (impact, responsibilities, must-haves vs nice-to-haves), a scorecard, and structured interview questions with what a good answer shows. Use inclusive, bias-free wording.")],
    commands: [command("jd", "Write a job description", "Write a job description for: {args}")],
    connectors: [],
  },
];

const BY_ID = new Map(PLUGIN_CATALOG.map((plugin) => [plugin.id, plugin]));
export const getPlugin = (id) => BY_ID.get(id) || null;

// ── Saved state ──────────────────────────────────────────────────────────
export function loadPluginState() {
  try {
    const saved = JSON.parse(localStorage.getItem(PLUGIN_STORAGE_KEY) || "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

export function savePluginState(state) {
  try { localStorage.setItem(PLUGIN_STORAGE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

export const isInstalled = (state, id) => Boolean(state?.[id]?.installed);
export const isEnabled = (state, id) => Boolean(state?.[id]?.installed) && state[id].enabled !== false;
export const installedCount = (state) => PLUGIN_CATALOG.filter((plugin) => isInstalled(state, plugin.id)).length;

// ── Search ───────────────────────────────────────────────────────────────
// Fuzzy, case-insensitive search over everything a plugin is known by:
// name, aliases, keywords, category, skills, commands and description.
// A query of several words matches when most of its words hit somewhere
// ("live sports cricket", "cricket", "crickt scores" all find Live Sports);
// a plugin's whole name inside the query always matches.

const STOP_WORDS = new Set(["a", "an", "the", "of", "for", "to", "in", "on", "and", "or", "me", "my", "i", "is", "what", "how", "with", "please"]);
const normalise = (text) => String(text || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
const wordsOf = (text) => normalise(text).split(/[^a-z0-9+#]+/).filter(Boolean);

// Edit distance, stopped early once it passes `max` (only small typos count).
function withinEdits(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, row[j]);
    }
    if (best > max) return false;
    prev = row;
  }
  return prev[b.length] <= max;
}

// How well one query word matches one word of a field: 1 exact, 0.85 a
// prefix ("crick" → cricket), 0.7 a typo ("crickt"), 0.5 inside a longer
// word ("sport" in "esports"), else 0.
function wordScore(q, w) {
  if (q === w) return 1;
  if (w.startsWith(q) && q.length >= 2) return 0.85;
  if (q.startsWith(w) && w.length >= 4) return 0.75;
  if (q.length >= 4 && withinEdits(q, w, q.length >= 7 ? 2 : 1)) return 0.7;
  if (q.length >= 4 && w.includes(q)) return 0.5;
  return 0;
}

// Fields and how much a hit in each counts.
function fieldsOf(plugin) {
  const skills = plugin.skills || [];
  const commands = plugin.commands || [];
  return [
    [6, [plugin.name]],
    [5, plugin.aliases || []],
    [4, plugin.keywords || []],
    [3, [plugin.category]],
    [3, skills.map((s) => s.name)],
    [2, commands.map((c) => c.name)],
    [1.5, [plugin.tagline]],
    [1, [plugin.description, ...skills.map((s) => s.description)]],
  ];
}

const indexCache = new WeakMap();
function indexOf(plugin) {
  if (!indexCache.has(plugin)) {
    indexCache.set(plugin, fieldsOf(plugin).map(([weight, values]) => [weight, [...new Set(values.flatMap(wordsOf))], values.map(normalise)]));
  }
  return indexCache.get(plugin);
}

/** How well `query` matches `plugin`: 0 for no match, higher is better. */
export function scorePlugin(plugin, query) {
  const q = normalise(query).trim();
  if (!q) return 1;
  const fields = indexOf(plugin);
  // The whole name (or an alias) in the query: "Live Sports cricket".
  // The full name anywhere as whole words; an alias only at the start, as
  // typed after "@" ("calendar" ending "content calendar" isn't Day Planner).
  const fullName = normalise(plugin.name);
  const phraseHit = (fullName.length >= 3 && ` ${q} `.includes(` ${fullName} `))
    || [fullName, ...(plugin.aliases || []).map(normalise)].some((name) => name.length >= 3 && (q === name || q.startsWith(`${name} `) || (name.includes(" ") && q.startsWith(name))));
  const allWords = wordsOf(q);
  const words = allWords.filter((w) => !STOP_WORDS.has(w));
  const queryWords = words.length ? words : allWords;
  let total = 0;
  let hits = 0;
  for (const qw of queryWords) {
    let best = 0;
    for (const [weight, fieldWords, phrases] of fields) {
      for (const fw of fieldWords) best = Math.max(best, wordScore(qw, fw) * weight);
      // A query word that is a multi-word keyword's start: "world" → "world cup".
      if (qw.length >= 3 && phrases.some((p) => p.startsWith(qw))) best = Math.max(best, 0.8 * weight);
    }
    if (best > 0) hits++;
    total += best;
  }
  const coverage = queryWords.length ? hits / queryWords.length : 0;
  // Most words have to hit: all of 1–2 words, 2 of 3, 3 of 4…
  const needed = queryWords.length <= 2 ? queryWords.length : Math.ceil(queryWords.length * 0.6);
  if (!phraseHit && hits < needed) return 0;
  return total * coverage + (phraseHit ? 20 : 0) + (normalise(plugin.name).startsWith(q) ? 10 : 0);
}

/**
 * Plugins matching `query`, best first, split into installed and available.
 * With no query: everything installed, then the featured ones to try.
 */
export function searchPlugins(query, state = {}, { limit = 8 } = {}) {
  const q = String(query || "").trim();
  const ranked = PLUGIN_CATALOG
    .map((plugin, order) => ({ plugin, score: scorePlugin(plugin, q), order }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order);
  const installed = ranked.filter((entry) => isInstalled(state, entry.plugin.id)).map((entry) => entry.plugin);
  let available = ranked.filter((entry) => !isInstalled(state, entry.plugin.id)).map((entry) => entry.plugin);
  if (!q) available = available.filter((plugin) => plugin.featured);
  return { installed: installed.slice(0, limit), available: available.slice(0, limit) };
}

/**
 * Slash commands of installed, enabled plugins matching `query` (the text
 * after "/"), best first: [{ plugin, command }].
 */
export function searchCommands(query, state = {}, { limit = 10 } = {}) {
  const q = normalise(query).trim();
  const rows = [];
  PLUGIN_CATALOG.forEach((plugin, order) => {
    if (!isEnabled(state, plugin.id)) return;
    for (const cmd of plugin.commands || []) {
      let score = 1;
      if (q) {
        const name = normalise(cmd.name);
        const head = q.split(/\s+/)[0];
        if (name === head) score = 100;
        else if (name.startsWith(head)) score = 80;
        else {
          // The description and the plugin count too: "/cricket" finds /score.
          const fake = { name: cmd.name, aliases: [plugin.name, ...(plugin.aliases || [])], keywords: plugin.keywords, category: plugin.category, tagline: cmd.description, description: "" };
          score = scorePlugin(fake, q);
        }
      }
      if (score > 0) rows.push({ plugin, command: cmd, score, order });
    }
  });
  return rows.sort((a, b) => b.score - a.score || a.order - b.order).slice(0, limit).map(({ plugin, command: cmd }) => ({ plugin, command: cmd }));
}

/**
 * "/score india vs australia" → the command's prompt with its arguments,
 * and the plugin it belongs to. null when the text isn't an installed command.
 */
export function expandSlashCommand(text, state = {}) {
  const match = /^\/([a-z0-9-]+)(?:\s+([\s\S]*))?$/i.exec(String(text || "").trim());
  if (!match) return null;
  const name = match[1].toLowerCase();
  const args = (match[2] || "").trim();
  for (const plugin of PLUGIN_CATALOG) {
    if (!isEnabled(state, plugin.id)) continue;
    const cmd = (plugin.commands || []).find((c) => c.name.toLowerCase() === name);
    if (cmd) {
      const prompt = cmd.prompt.includes("{args}")
        ? cmd.prompt.replace("{args}", args).replace(/[:\s]+$/, args ? "" : "").trim()
        : `${cmd.prompt} ${args}`.trim();
      return { pluginId: plugin.id, command: cmd.name, text: prompt || cmd.description, file: Boolean(cmd.file) };
    }
  }
  return null;
}

/**
 * The file formats a message's plugins make of the reply ("xlsx" for Sheets,
 * "docx" for Docs): the app adds the download card for them, as when a
 * message asks for "an Excel sheet" in words.
 */
export function pluginFileFormats(ids = []) {
  return [...new Set((ids || []).flatMap((id) => getPlugin(id)?.files || []))];
}

// ── Which plugins a message uses ─────────────────────────────────────────
// A trigger counts as a whole word (or with a plain ending: "matches",
// "studying"). Matched anywhere in the text, "live" set off Web Search for
// "are you alive" and "deliver", "exam" for "example", "graph" for "paragraph".
const triggerPatterns = new Map();
function triggerPattern(trigger) {
  if (!triggerPatterns.has(trigger)) {
    const word = trigger.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    triggerPatterns.set(trigger, new RegExp(`(?<![a-z0-9])${word}(?:s|es|ed|d|ing)?(?![a-z0-9])`, "i"));
  }
  return triggerPatterns.get(trigger);
}

const textMentions = (plugin, low) => [plugin.name, ...(plugin.aliases || [])].some((alias) => low.includes(`@${alias.toLowerCase()}`));

/**
 * Ids of the installed, enabled plugins a message uses: the ones mentioned
 * (as a chip, `mentioned`, or typed as "@name"), then those whose trigger
 * words appear in it. At most three come in by trigger alone.
 */
export function pluginsForPrompt(state, prompt = "", mentioned = []) {
  const low = String(prompt || "").toLowerCase();
  const picked = [];
  for (const plugin of PLUGIN_CATALOG) {
    if (!isEnabled(state, plugin.id)) continue;
    if (mentioned.includes(plugin.id) || textMentions(plugin, low)) picked.push(plugin.id);
  }
  const triggered = [];
  for (const plugin of PLUGIN_CATALOG) {
    if (triggered.length >= 3 || picked.includes(plugin.id) || !isEnabled(state, plugin.id)) continue;
    const skillHit = (plugin.skills || []).some((s) => (s.triggers || []).some((t) => triggerPattern(t).test(low)));
    if (skillHit || (plugin.triggers || []).some((t) => triggerPattern(t).test(low))) triggered.push(plugin.id);
  }
  // A plugin that brings its own data (Markets, Weather, a linked page…)
  // answers from it; a search plugin that only came in on a word ("price")
  // steps aside, so no unrelated web results are mixed in. Picked by name,
  // both stay.
  const all = [...picked, ...triggered];
  const bringsData = all.some((id) => getPlugin(id)?.live || getPlugin(id)?.readsLinks);
  return all.filter((id) => !(bringsData && triggered.includes(id) && getPlugin(id)?.search));
}

/**
 * What the backend adds to the system prompt for these plugins: each one's
 * name and its skills' instructions. A plugin brought in by one skill's own
 * trigger words sends just that skill; otherwise all its skills.
 */
export function pluginContext(ids, prompt = "") {
  const low = String(prompt || "").toLowerCase();
  return ids.map(getPlugin).filter(Boolean).map((plugin) => {
    const skills = plugin.skills || [];
    const triggered = skills.filter((s) => (s.triggers || []).some((t) => triggerPattern(t).test(low)));
    const chosen = triggered.length && !textMentions(plugin, low) ? triggered : skills;
    return {
      id: plugin.id,
      name: plugin.name,
      live: plugin.live || null,
      skills: chosen.map((s) => ({ name: s.name, instructions: s.instructions })),
    };
  });
}

export function pluginMentioned(state, prompt, pluginId, mentioned = []) {
  const plugin = getPlugin(pluginId);
  if (!plugin || !isEnabled(state, pluginId)) return false;
  return mentioned.includes(pluginId) || textMentions(plugin, String(prompt || "").toLowerCase());
}

export function removePluginMention(prompt, pluginId) {
  const plugin = getPlugin(pluginId);
  if (!plugin) return String(prompt || "").trim();
  return [plugin.name, ...(plugin.aliases || [])]
    .sort((a, b) => b.length - a.length)
    .reduce((text, alias) => text.replace(new RegExp(`@${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "ig"), ""), String(prompt || ""))
    .replace(/\s{2,}/g, " ")
    .trim();
}
