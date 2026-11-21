import test from "node:test";
import assert from "node:assert/strict";

import {
  PLUGIN_CATALOG, PLUGIN_CATEGORIES, searchPlugins, searchCommands, scorePlugin,
  expandSlashCommand, pluginsForPrompt, pluginContext, installedCount,
} from "../src/plugins/catalog.js";

const first = (query, state = {}) => {
  const { installed, available } = searchPlugins(query, state);
  return [...installed, ...available][0]?.id;
};

test("'Live Sports cricket' finds Live Sports, installed or not", () => {
  assert.equal(first("Live Sports cricket"), "sports-live");
  assert.equal(first("live sports cricket", { "sports-live": { installed: true } }), "sports-live");
  assert.deepEqual(searchPlugins("Live Sports cricket", {}).installed, [], "nothing installed yet");
  assert.equal(searchPlugins("Live Sports cricket", {}).available[0].id, "sports-live");
});

test("one keyword, a prefix or a typo still finds the plugin", () => {
  assert.equal(first("cricket"), "sports-live");
  assert.equal(first("crick"), "sports-live");
  assert.equal(first("crickt scores"), "sports-live");
  assert.equal(first("FOOTBALL"), "sports-live");
  assert.equal(first("weather"), "weather-now");
  assert.equal(first("bitcoin"), "markets");
  assert.equal(first("usd to inr"), "currency-convert");
  assert.equal(first("regex"), "regex-lab");
  assert.equal(first("eli5"), "explain-simply");
  assert.equal(first("cover letter"), "resume-builder");
  assert.equal(first("pull request review"), "code-review");
});

test("category and skill names are searched too", () => {
  const live = searchPlugins("live info").available.map((p) => p.id);
  for (const id of ["sports-live", "weather-now", "news-brief", "markets", "currency-convert"]) assert.ok(live.includes(id), id);
  assert.equal(first("objection handling"), "sales-pack");
  assert.equal(first("content calendar"), "marketing-pack");
});

test("a query with most words matching counts; one stray word doesn't sink it", () => {
  assert.equal(first("show me live cricket scores today please"), "sports-live");
  assert.equal(scorePlugin(PLUGIN_CATALOG.find((p) => p.id === "weather-now"), "live sports cricket"), 0);
});

test("nothing matches gibberish", () => {
  const { installed, available } = searchPlugins("zzqx blorf");
  assert.equal(installed.length + available.length, 0);
});

test("installed plugins come first; an empty query lists installed then featured", () => {
  const state = { "regex-lab": { installed: true } };
  const empty = searchPlugins("", state);
  assert.deepEqual(empty.installed.map((p) => p.id), ["regex-lab"]);
  assert.ok(empty.available.length > 0 && empty.available.every((p) => p.featured));
  assert.equal(installedCount(state), 1);
});

test("every plugin is complete and uses a known category", () => {
  const ids = new Set();
  for (const plugin of PLUGIN_CATALOG) {
    assert.ok(!ids.has(plugin.id), `duplicate id ${plugin.id}`);
    ids.add(plugin.id);
    assert.ok(PLUGIN_CATEGORIES.includes(plugin.category), `${plugin.id}: ${plugin.category}`);
    for (const key of ["name", "description", "icon"]) assert.ok(plugin[key], `${plugin.id} has no ${key}`);
    assert.ok(plugin.keywords?.length, `${plugin.id} has keywords`);
    assert.ok(plugin.skills?.length, `${plugin.id} has skills`);
    for (const s of plugin.skills) assert.ok(s.name && s.instructions, `${plugin.id} skill`);
    assert.ok(Array.isArray(plugin.commands) && Array.isArray(plugin.connectors));
    assert.ok(!/anthropic|claude/i.test(JSON.stringify(plugin)), `${plugin.id} has no third-party AI branding`);
  }
  assert.ok(PLUGIN_CATALOG.length >= 40);
});

test("slash commands: installed plugins only, fuzzy, and expanded with their arguments", () => {
  const state = { "sports-live": { installed: true }, "weather-now": { installed: true }, "quiz-master": { installed: true, enabled: false } };
  assert.equal(searchCommands("sco", state)[0].command.name, "score");
  assert.equal(searchCommands("cricket", state)[0].plugin.id, "sports-live");
  assert.ok(!searchCommands("", state).some((row) => row.plugin.id === "quiz-master"), "disabled plugin's commands hidden");
  assert.deepEqual(expandSlashCommand("/score India vs Australia", state), { pluginId: "sports-live", command: "score", text: "Live score: India vs Australia" });
  assert.equal(expandSlashCommand("/weather Chennai", state).text, "Weather in Chennai");
  assert.equal(expandSlashCommand("/quiz physics", state), null, "disabled");
  assert.equal(expandSlashCommand("hello /score", state), null);
});

test("a chip mention, a typed @name or a trigger word brings a plugin's skills into the prompt", () => {
  const state = { "sports-live": { installed: true }, "sales-pack": { installed: true } };
  assert.deepEqual(pluginsForPrompt(state, "who is winning", ["sports-live"]), ["sports-live"]);
  assert.deepEqual(pluginsForPrompt(state, "@Live Sports who is winning"), ["sports-live"]);
  assert.deepEqual(pluginsForPrompt(state, "ipl score"), ["sports-live"]);
  assert.deepEqual(pluginsForPrompt({}, "ipl score", ["sports-live"]), [], "not installed: nothing");
  const [ctx] = pluginContext(["sales-pack"], "handle this objection: too expensive");
  assert.deepEqual(ctx.skills.map((s) => s.name), ["Objection handling"], "only the matching skill");
  const [sports] = pluginContext(["sports-live"], "score");
  assert.equal(sports.live, "sports");
  assert.match(sports.skills[0].instructions, /never invent/i);
});
