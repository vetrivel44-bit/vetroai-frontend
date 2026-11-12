const test = require("node:test");
const assert = require("node:assert/strict");
const { readResume, explainFit, parseJsonObject } = require("../src/services/resumeService");

const RESUME = "Priya S — Data Analyst. 2 years at Acme Retail building Power BI dashboards, SQL reporting and Python (pandas) analysis. B.Sc Statistics, Chennai.";

test("resume: the model's JSON becomes a clean profile", async () => {
  const think = async () => "```json\n" + JSON.stringify({
    name: "Priya S", headline: "Data Analyst", titles: ["Data Analyst", "BI Analyst"], years: "2", level: "Mid-Level",
    skills: ["SQL", "Power BI", "Python", "sql", "Pandas"], education: "B.Sc Statistics", locations: ["Chennai"], summary: "Analyst.",
  }) + "\n```";
  const p = await readResume(RESUME, { think });
  assert.equal(p.headline, "Data Analyst");
  assert.equal(p.years, 2);
  assert.deepEqual(p.skills, ["SQL", "Power BI", "Python", "Pandas"], "duplicates dropped");
  assert.deepEqual(p.locations, ["Chennai"]);
});

test("resume: no model, too little text or a bad reply gives null", async () => {
  assert.equal(await readResume(RESUME, { think: null }), null);
  assert.equal(await readResume("short", { think: async () => "{}" }), null);
  assert.equal(await readResume(RESUME, { think: async () => "I can't read that." }), null);
  assert.equal(await readResume(RESUME, { think: async () => { throw new Error("down"); } }), null);
});

test("fit: advice is parsed and trimmed to three points each", async () => {
  const think = async (prompt) => {
    assert.match(prompt, /Data Analyst at Acme/);
    return JSON.stringify({ verdict: "Strong fit", strengths: ["SQL", "Power BI"], gaps: ["Tableau"], tips: ["a", "b", "c", "d"] });
  };
  const fit = await explainFit({ skills: ["SQL"] }, { title: "Data Analyst", company: "Acme", description: "SQL and Tableau" }, { think });
  assert.equal(fit.verdict, "Strong fit");
  assert.deepEqual(fit.tips, ["a", "b", "c"]);
});

test("parseJsonObject finds the object inside prose", () => {
  assert.deepEqual(parseJsonObject('Here you go: {"a": 1} thanks'), { a: 1 });
  assert.equal(parseJsonObject("no json"), null);
});
