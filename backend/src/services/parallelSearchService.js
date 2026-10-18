const { randomUUID } = require("node:crypto");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

const ENDPOINT = "https://search.parallel.ai/mcp";
const USER_AGENT = "VetroAI/1.0 (+https://github.com/vetrivel44-bit/vetroai-frontend)";

function searchResults(reply) {
  if (reply.isError) throw new Error("Parallel search returned a tool error");
  const data = reply.structuredContent || JSON.parse(
    (reply.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n"),
  );
  if (!Array.isArray(data.results)) throw new Error("Invalid Parallel search response");
  return data.results.filter((r) => {
    try {
      const url = new URL(r.url);
      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
    } catch { return false; }
  }).slice(0, 8).map((r) => ({
    url: r.url,
    title: typeof r.title === "string" ? r.title : "",
    snippet: (Array.isArray(r.excerpts) ? r.excerpts : [])
      .filter((excerpt) => typeof excerpt === "string").join("\n\n").slice(0, 6000),
    // Excerpts are evidence, not full page text. DeepSearch's existing public-
    // host-only page reader still decides which pages to open.
    text: "",
    published: typeof r.publish_date === "string" ? r.publish_date : null,
  }));
}

async function searchParallel(query, { signal, timeoutMs = 9000, sessionId = randomUUID() } = {}) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new DOMException("Parallel search timed out", "TimeoutError")), timeoutMs);
  const operationSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  const client = new Client({ name: "vetroai", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    // Cover initialize/discovery as well as tools/call with the same budget.
    fetch: (url, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set("User-Agent", USER_AGENT);
      return fetch(url, {
        ...init, headers,
        signal: init.signal ? AbortSignal.any([init.signal, operationSignal]) : operationSignal,
      });
    },
  });
  try {
    operationSignal.throwIfAborted();
    await client.connect(transport);
    const { tools } = await client.listTools({}, { signal: operationSignal });
    if (!tools.some((tool) => tool.name === "web_search")) throw new Error("Parallel web_search is unavailable");
    const reply = await client.callTool({
      name: "web_search",
      arguments: { objective: query, search_queries: [query], session_id: sessionId },
    }, undefined, { signal: operationSignal });
    operationSignal.throwIfAborted();
    return searchResults(reply);
  } finally {
    clearTimeout(timer);
    await client.close();
  }
}

module.exports = { searchParallel, ENDPOINT, USER_AGENT };
