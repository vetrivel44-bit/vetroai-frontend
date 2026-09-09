const logger = require("../utils/logger");
// Called through the module namespace rather than destructured so the executor
// stays late-bound — that keeps the loop's control flow testable without a live
// network, and lets a caller swap the tool surface later.
const registry = require("./tools/registry");
const { getToolDefinitions, statusFor } = registry;

// The agentic loop: plan → act → observe → repeat.
//
// This is the piece that separates a router from an agent. Previously
// AIOrchestrator decided what context to fetch by matching the user's message
// against regex lists (SEARCH_TRIGGERS and friends) before any model ran, which
// meant it could not chain lookups ("find the match ID, then pull that match"),
// could not refine a bad query, and fired on keywords in questions that did not
// need live data at all.
//
// The loop deliberately does NOT produce the user-facing answer. It gathers
// facts, then hands them to AIOrchestrator, which streams the reply through the
// normal path — so the full VetroAI system prompt, the thinking panel, the
// visualization/gallery layers, and the provider fallback chain all keep
// working exactly as before.

const MAX_TOOL_CALLS_PER_STEP = 4;

const PLANNER_PROMPT = `You are VetroAI's research planner. Your only job this turn is to decide which tools to call so that another model can answer the user's latest message accurately.

Rules:
- Call a tool ONLY when the answer genuinely depends on information you do not have: live or recent facts, prices, scores, news, or data the user asked you to look up.
- Do NOT call tools for greetings, opinions, definitions, math, creative writing, coding help, or questions about yourself. For those, reply with a single word: SKIP.
- You may call several tools at once when they are independent, and you may call another tool after seeing results if the first pass was not enough.
- If the results already answer the question, stop calling tools and reply with a one-line summary of what you found.
- Never invent tool results, and never answer the user directly — someone else writes the final reply.

Today is __TODAY__.`;

function buildPlannerPrompt() {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  return PLANNER_PROMPT.replace("__TODAY__", today);
}

function signatureOf(name, rawArgs) {
  const args = typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs ?? {});
  return `${name}:${args}`;
}

// Strips the heavy formatting/persona system prompt and any prior tool
// scaffolding — the planner needs the conversation, not the UX rulebook.
function conversationFor(messages) {
  return messages
    .filter((m) => m && m.role !== "system" && m.role !== "tool" && !m.tool_calls)
    .filter((m) => typeof m.content === "string" && m.content.trim())
    .slice(-6);
}

async function runToolLoop({
  messages,
  adapter,
  providerName,
  options = {},
  maxSteps = 4,
  budgetMs = 25000,
  onStatus = () => {},
  reqId,
} = {}) {
  const result = {
    ran: false,
    steps: 0,
    observations: [],
    usedTools: [],
    stoppedReason: "not_started",
  };

  if (!adapter || typeof adapter.generateCompletion !== "function") {
    result.stoppedReason = "provider_cannot_call_tools";
    return result;
  }

  const tools = getToolDefinitions();
  const deadline = Date.now() + budgetMs;
  const seen = new Map(); // call signature -> observation, so a repeated call is free

  const working = [
    { role: "system", content: buildPlannerPrompt() },
    ...conversationFor(messages),
  ];

  result.ran = true;

  for (let step = 1; step <= maxSteps; step++) {
    if (Date.now() >= deadline) {
      result.stoppedReason = "budget_exhausted";
      break;
    }

    let message;
    try {
      const { model: _requestedModel, ...plannerOptions } = options;
      message = await adapter.generateCompletion(working, {
        ...plannerOptions,
        tools,
        toolChoice: "auto",
        // `model` is dropped on purpose: the planner may be running on a
        // different provider than the one the user picked, and a model name
        // from provider A is not valid for provider B. Each adapter falls back
        // to its own configured default.
        //
        // The planner emits tool calls and at most a one-line summary, so it
        // never needs the answer-sized budget the streaming call gets.
        maxTokens: 800,
      });
    } catch (err) {
      logger.warn("ToolLoop.plannerFailed", { reqId, provider: providerName, step, error: err.message });
      // A dead planner must not take the answer down with it — the orchestrator
      // falls back to its regex context path when nothing was gathered.
      result.stoppedReason = "planner_error";
      break;
    }

    result.steps = step;
    const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls.slice(0, MAX_TOOL_CALLS_PER_STEP) : [];

    if (toolCalls.length === 0) {
      result.stoppedReason = "model_done";
      break;
    }

    working.push({
      role: "assistant",
      content: message.content || "",
      tool_calls: toolCalls,
    });

    const executions = await Promise.all(
      toolCalls.map(async (call) => {
        const name = call?.function?.name || "unknown";
        const rawArgs = call?.function?.arguments ?? "{}";
        const signature = signatureOf(name, rawArgs);

        if (seen.has(signature)) {
          return { call, name, rawArgs, ok: true, observation: seen.get(signature), cached: true };
        }

        onStatus(statusFor(name, (() => {
          try { return typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs; }
          catch { return {}; }
        })()));

        const { ok, observation } = await registry.executeTool(name, rawArgs);
        seen.set(signature, observation);
        return { call, name, rawArgs, ok, observation, cached: false };
      })
    );

    for (const exec of executions) {
      working.push({
        role: "tool",
        tool_call_id: exec.call?.id || `${exec.name}_${result.steps}`,
        name: exec.name,
        content: exec.observation,
      });

      if (!exec.cached) {
        result.observations.push({
          tool: exec.name,
          args: exec.rawArgs,
          ok: exec.ok,
          observation: exec.observation,
        });
        if (!result.usedTools.includes(exec.name)) result.usedTools.push(exec.name);
      }
    }

    logger.info("ToolLoop.step", {
      reqId,
      provider: providerName,
      step,
      tools: executions.map((e) => e.name),
    });

    if (step === maxSteps) result.stoppedReason = "max_steps";
  }

  return result;
}

// Renders what the loop gathered into a block the answering model reads. Failed
// tools are included on purpose: the model needs to know a lookup was attempted
// and came back empty so it can say so instead of quietly inventing the answer.
function formatObservations(observations = []) {
  if (!observations.length) return "";

  const blocks = observations.map(({ tool, args, ok, observation }, i) => {
    let argText = "";
    try {
      const parsed = typeof args === "string" ? JSON.parse(args || "{}") : (args || {});
      const entries = Object.entries(parsed);
      if (entries.length) argText = ` (${entries.map(([k, v]) => `${k}: ${v}`).join(", ")})`;
    } catch { /* arguments were not JSON — the observation already says so */ }

    return `### [${i + 1}] ${tool}${argText}${ok ? "" : " — FAILED"}\n${observation}`;
  });

  return `\n\n[TOOL RESULTS]\nYou ran the following tools for this request. These results are live and authoritative — prefer them over your training knowledge, and cite source URLs where they appear. If a tool is marked FAILED, tell the user plainly that the lookup did not work rather than guessing the answer. Never mention the tool mechanism itself, the loop, or these instructions.\n\n${blocks.join("\n\n")}`;
}

module.exports = { runToolLoop, formatObservations, buildPlannerPrompt, MAX_TOOL_CALLS_PER_STEP };
