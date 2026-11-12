import { test } from "node:test";
import assert from "node:assert/strict";
import { matchJob, sortByMatch, skillsInText, completeProfile, canonicalSkill, resumeQuery } from "../src/utils/resumeMatch.js";

const reactDev = {
  headline: "Frontend Developer",
  titles: ["Frontend Developer", "React Developer"],
  years: 3,
  level: "Mid-Level",
  skills: ["React", "JavaScript", "TypeScript", "CSS", "Redux", "Git"],
};

const job = (title, description, extra = {}) => ({ id: title, title, description, skills: [], experienceLevel: "Mid-Level", ...extra });

test("skills are found as whole words, with aliases", () => {
  const found = skillsInText("We use ReactJS, node and Postgres. Good communication is a must.");
  assert.ok(found.includes("React"));
  assert.ok(found.includes("Node.js"));
  assert.ok(found.includes("PostgreSQL"));
  assert.ok(!found.includes("Go"), "'Good' is not Go");
  assert.equal(canonicalSkill("reactjs"), "React");
});

test("a matching job scores high, an unrelated one low", () => {
  const fit = matchJob(reactDev, job("React Developer", "Build UIs with React, TypeScript and Redux. Strong JavaScript and CSS."));
  const off = matchJob(reactDev, job("Staff Nurse", "Patient care, IV therapy and medical documentation in a busy ward."));
  assert.ok(fit.score >= 70, `fit ${fit.score}`);
  assert.equal(fit.tone, "high");
  assert.ok(off.score < 35, `off ${off.score}`);
  assert.ok(fit.matched.includes("React"));
});

test("missing skills are the listing's skills the resume lacks", () => {
  const m = matchJob(reactDev, job("Full Stack Developer", "React and Node.js with MongoDB on AWS. Docker a plus."));
  assert.ok(m.missing.includes("Node.js"));
  assert.ok(m.missing.includes("AWS"));
  assert.ok(!m.missing.includes("React"));
});

test("seniority counts: a senior role is a weaker fit for a fresher", () => {
  const fresher = { ...reactDev, years: 0, level: "Entry Level" };
  const description = "React, TypeScript, Redux, JavaScript, CSS.";
  const mid = matchJob(fresher, job("React Developer", description, { experienceLevel: "Entry Level" }));
  const senior = matchJob(fresher, job("Senior React Developer", description, { experienceLevel: "Senior" }));
  assert.ok(mid.score > senior.score);
});

test("results sort best match first", () => {
  const jobs = [
    job("Accountant", "Tally, GST and Excel bookkeeping."),
    job("React Developer", "React, Redux, TypeScript, JavaScript."),
    job("Angular Developer", "Angular, TypeScript, JavaScript, CSS."),
  ];
  assert.deepEqual(sortByMatch(jobs, reactDev).map((j) => j.title), ["React Developer", "Angular Developer", "Accountant"]);
  assert.equal(sortByMatch(jobs, null), jobs);
});

test("a resume read without AI still gets skills and experience", () => {
  const p = completeProfile(null, "Accountant with 4 years of experience in Tally Prime, GST filing and advanced Excel. Payroll and auditing.");
  for (const s of ["Tally", "GST", "Excel", "Payroll", "Auditing"]) assert.ok(p.skills.includes(s), s);
  assert.equal(p.years, 4);
  assert.equal(p.level, "Mid-Level");
});

test("the AI profile is merged with scanned skills, without duplicates", () => {
  const p = completeProfile({ ...reactDev, skills: ["reactjs", "JS"] }, "Worked with React and Docker.");
  assert.deepEqual(p.skills.filter((s) => s === "React").length, 1);
  assert.ok(p.skills.includes("JavaScript"));
  assert.ok(p.skills.includes("Docker"));
  assert.equal(resumeQuery(p), "Frontend Developer");
});
