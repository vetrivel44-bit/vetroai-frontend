import test from "node:test";
import assert from "node:assert/strict";

import { normalizeJob, closedReason, isOpen, deadlineLabel, isInternshipQuery, experienceFor, searchParams, MAX_OPEN_DAYS } from "../src/utils/jobListings.js";

const NOW = Date.parse("2026-09-24T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (t) => new Date(t).toISOString();

test("a listing whose expiry date has passed is closed", () => {
  const job = normalizeJob({ job_title: "Data Intern", job_offer_expiration_datetime_utc: iso(NOW - DAY), job_posted_at_datetime_utc: iso(NOW - 10 * DAY) });
  assert.equal(closedReason(job, NOW), "expired");
  assert.equal(isOpen(job, NOW), false);
});

test("expiry given only as a unix timestamp is still honoured", () => {
  const job = normalizeJob({ job_title: "Intern", job_offer_expiration_timestamp: Math.floor((NOW - 3600e3) / 1000) });
  assert.equal(closedReason(job, NOW), "expired");
});

test("a listing that says it stopped taking applications is closed", () => {
  const job = normalizeJob({ job_title: "Marketing Intern", job_description: "Sorry, this position has been filled.", job_posted_at_datetime_utc: iso(NOW - DAY) });
  assert.equal(closedReason(job, NOW), "closed");
});

test("an undated listing is only stale past the cut-off", () => {
  const fresh = normalizeJob({ job_title: "Intern", job_posted_at_datetime_utc: iso(NOW - (MAX_OPEN_DAYS - 1) * DAY) });
  const old = normalizeJob({ job_title: "Intern", job_posted_at_datetime_utc: iso(NOW - (MAX_OPEN_DAYS + 1) * DAY) });
  assert.equal(closedReason(fresh, NOW), null);
  assert.equal(closedReason(old, NOW), "stale");
});

test("a future expiry keeps an old posting open", () => {
  const job = normalizeJob({ job_title: "Intern", job_posted_at_datetime_utc: iso(NOW - 90 * DAY), job_offer_expiration_datetime_utc: iso(NOW + 5 * DAY) });
  assert.equal(closedReason(job, NOW), null);
  assert.equal(deadlineLabel(job, NOW), "Closes in 5 days");
});

test("internships are recognised from type, title or query", () => {
  assert.equal(experienceFor({ job_title: "Software Engineer", job_employment_type: "INTERN" }), "Internship");
  assert.equal(experienceFor({ job_title: "Summer Internship – Finance", job_employment_type: "FULLTIME" }), "Internship");
  assert.equal(experienceFor({ job_title: "Senior Backend Engineer" }), "Senior");
  assert.equal(experienceFor({ job_title: "Analyst", job_required_experience: { no_experience_required: true } }), "Entry Level");
  assert.equal(normalizeJob({ job_title: "Designer", job_employment_type: "INTERN" }).type, "Internship");
  assert.ok(isInternshipQuery("python internship bangalore"));
  assert.ok(isInternshipQuery("Marketing interns"));
  assert.ok(!isInternshipQuery("international sales manager"));
});

test("an unknown posting date is left unknown, not 'just now'", () => {
  assert.equal(normalizeJob({ job_title: "Intern" }).postedAt, null);
});

test("internship searches ask the API for INTERN listings in a date window", () => {
  assert.equal(searchParams({ internships: true, posted: "month" }), "&employment_types=INTERN&date_posted=month");
  assert.equal(searchParams({ posted: "all" }), "");
});

test("work-type switches widen the match and none means everything", async () => {
  const { matchesWorkType } = await import("../src/utils/jobListings.js");
  const remote = { remote: true, description: "" };
  const hybrid = { remote: false, description: "Hybrid: 3 days in office" };
  const onsite = { remote: false, description: "Work from our Pune office" };
  assert.ok([remote, hybrid, onsite].every((j) => matchesWorkType(j, {})));
  assert.deepEqual([remote, hybrid, onsite].map((j) => matchesWorkType(j, { hybrid: true })), [false, true, false]);
  assert.deepEqual([remote, hybrid, onsite].map((j) => matchesWorkType(j, { onsite: true })), [false, false, true]);
  assert.deepEqual([remote, hybrid, onsite].map((j) => matchesWorkType(j, { remote: true, hybrid: true })), [true, true, false]);
});

test("interns get a stipend line and pay shows its period", async () => {
  const { missingPayLabel, payPeriodSuffix } = await import("../src/utils/jobListings.js");
  const intern = normalizeJob({ job_title: "Design Intern", job_min_salary: 15000, job_salary_currency: "INR", job_salary_period: "MONTH" });
  assert.equal(intern.salary.currency, "₹");
  assert.equal(payPeriodSuffix(intern.salary.period), "/mo");
  assert.equal(missingPayLabel(intern), "Stipend TBD");
  assert.equal(missingPayLabel(normalizeJob({ job_title: "Engineer" })), "Salary TBD");
});
