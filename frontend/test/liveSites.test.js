import { test } from "node:test";
import assert from "node:assert/strict";
import { isLiveSiteRequest } from "../src/lib/liveSites.js";

test("acting on a shopping or food site needs the live page", () => {
  for (const p of [
    "Open flipkart.com, search 'smartwatch under ₹3000', and compare the top 5 by rating and reviews in a table. Don't add anything to the cart.",
    "go to amazon.in and find wireless earbuds under 2000",
    "Search Myntra for white sneakers size 9",
    "compare the price of iPhone 16 on Flipkart and Amazon",
    "order a veg biryani from Swiggy",
    "check what's available on Blinkit near me",
  ]) assert.equal(isLiveSiteRequest(p), true, p);
});

test("questions about a company are ordinary answers", () => {
  for (const p of [
    "Who founded Flipkart?",
    "Write an essay about Amazon rainforest deforestation",
    "What is Zomato's business model?",
    "build a website like Flipkart for my shop",
  ]) assert.equal(isLiveSiteRequest(p), false, p);
});
