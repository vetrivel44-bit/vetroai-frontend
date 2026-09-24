import test from "node:test";
import assert from "node:assert/strict";

import { pickCompanyHit, logoFromEntity, lookupCompanyLogo, normalizeCompany, searchTerm } from "../src/utils/companyLogos.js";

// Shapes as returned by wbsearchentities / wbgetentities.
const SEARCH_INFOSYS = { search: [
  { id: "Q1", label: "Infosys", description: "a song", match: { text: "Infosys" } },
  { id: "Q26536", label: "Infosys", description: "Indian multinational information technology company", match: { text: "Infosys" } },
] };
const ENTITY_INFOSYS = { entities: { Q26536: { claims: {
  P154: [{ rank: "normal", mainsnak: { datavalue: { value: "Infosys logo.svg", type: "string" } } }],
  P856: [{ rank: "normal", mainsnak: { datavalue: { value: "https://www.infosys.com/", type: "string" } } }],
} } } };

test("company names are compared without legal suffixes", () => {
  assert.equal(normalizeCompany("Tata Consultancy Services Ltd."), "tata consultancy");
  assert.equal(normalizeCompany("Infosys Limited"), "infosys");
});

test("the organisation hit is chosen over a same-named song or person", () => {
  assert.equal(pickCompanyHit("Infosys Limited", SEARCH_INFOSYS.search).id, "Q26536");
});

test("a hit with a different name is not trusted", () => {
  const hits = [{ id: "Q9", label: "Acme Corporation", description: "fictional company" }];
  assert.equal(pickCompanyHit("Acmeville Foods", hits), null);
  assert.equal(pickCompanyHit("A", hits), null);
});

test("the official logo becomes a Commons thumbnail and the website is kept", () => {
  const r = logoFromEntity(ENTITY_INFOSYS.entities.Q26536);
  assert.equal(r.logo, "https://commons.wikimedia.org/wiki/Special:FilePath/Infosys_logo.svg?width=128");
  assert.equal(r.website, "https://www.infosys.com/");
});

test("lookup goes search → entity and caches per company", async () => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    return { json: async () => (url.includes("wbsearchentities") ? SEARCH_INFOSYS : ENTITY_INFOSYS) };
  };
  const r = await lookupCompanyLogo("Infosys Ltd", fetchFn);
  assert.match(r.logo, /Infosys_logo\.svg/);
  assert.equal(calls.length, 2);
  await lookupCompanyLogo("INFOSYS", fetchFn);
  assert.equal(calls.length, 2, "second lookup for the same company is served from cache");
});

test("a failed lookup resolves to no logo instead of throwing", async () => {
  const r = await lookupCompanyLogo("Nonexistent Test Company", async () => { throw new Error("offline"); });
  assert.deepEqual(r, { logo: null, website: null });
});

test("the search term drops legal suffixes but keeps the real name", () => {
  assert.equal(searchTerm("Infosys Limited"), "Infosys");
  assert.equal(searchTerm("Zeta Analytics Pvt. Ltd."), "Zeta Analytics");
  assert.equal(searchTerm("Tata Consultancy Services"), "Tata Consultancy Services");
});
