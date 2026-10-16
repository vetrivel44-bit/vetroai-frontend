import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import JSZip from "jszip";

import { decodeXml, extractOfficeText, looksLikeText, officeKind, sheetXmlToRows, wordXmlToText } from "../src/lib/officeText.js";
import { buildPptx, parseDeck } from "../src/lib/slides.js";

const PptxGenJS = createRequire(import.meta.url)("pptxgenjs");

const zipOf = async (files) => {
  const zip = new JSZip();
  for (const [path, text] of Object.entries(files)) zip.file(path, text);
  return zip.generateAsync({ type: "uint8array" });
};

test("recognises Office files by extension", () => {
  assert.equal(officeKind("Report.DOCX"), "word");
  assert.equal(officeKind("deck.pptx"), "powerpoint");
  assert.equal(officeKind("data.xlsx"), "excel");
  assert.equal(officeKind("old.doc"), "legacy");
  assert.equal(officeKind("notes.txt"), null);
});

test("decodes XML entities", () => {
  assert.equal(decodeXml("A &amp; B &lt;3 &#8364; &#x1F600; &quot;q&quot;"), "A & B <3 € 😀 \"q\"");
});

test("reads a Word document's paragraphs and tables", async () => {
  const xml = '<w:document><w:body>'
    + '<w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> world &amp; more</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>Line</w:t><w:br/><w:t>two</w:t></w:r></w:p>'
    + '<w:tbl><w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Age</w:t></w:r></w:p></w:tc></w:tr>'
    + '<w:tr><w:tc><w:p><w:r><w:t>Asha</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>30</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    + '</w:body></w:document>';
  assert.equal(wordXmlToText(xml), "Hello world & more\nLine\ntwo\nName | Age\nAsha | 30");
  const text = await extractOfficeText(await zipOf({ "word/document.xml": xml }), "word");
  assert.match(text, /^Hello world & more/);
});

test("reads an Excel workbook with shared strings, numbers and names", async () => {
  const sheet = '<worksheet><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>'
    + '<row r="2"><c r="A2" t="inlineStr"><is><t>Pens</t></is></c><c r="B2"><v>4</v></c><c r="C2"><v>2.5</v></c></row>'
    + '<row r="3"><c r="A3" t="b"><v>1</v></c><c r="B3"/></row>'
    + '</sheetData></worksheet>';
  assert.deepEqual(sheetXmlToRows(sheet, ["Item", "Price"]), ["Item |  | Price", "Pens | 4 | 2.5", "TRUE"]);
  const text = await extractOfficeText(await zipOf({
    "xl/workbook.xml": '<workbook><sheets><sheet name="Sales &amp; Costs" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/sharedStrings.xml": '<sst><si><t>Item</t></si><si><r><t>Pri</t></r><r><t>ce</t></r></si></sst>',
    "xl/worksheets/sheet1.xml": sheet,
  }), "excel");
  assert.equal(text, "Sheet: Sales & Costs\nItem |  | Price\nPens | 4 | 2.5\nTRUE");
});

test("reads a PowerPoint deck slide by slide, in order, with notes", async () => {
  const deck = parseDeck(JSON.stringify({ title: "Cells", slides: [
    { layout: "title", title: "Cells", subtitle: "Building blocks of life", notes: "Start with a microscope photo." },
    { layout: "bullets", title: "Parts of a cell", bullets: ["Nucleus", "Membrane"] },
    ...Array.from({ length: 9 }, (_, i) => ({ layout: "bullets", title: `Extra ${i + 3}`, bullets: ["x"] })),
  ] }));
  const buf = await buildPptx(deck, PptxGenJS).write({ outputType: "nodebuffer" });
  const text = await extractOfficeText(buf, "powerpoint");
  assert.match(text, /^Slide 1:\nCells\nBuilding blocks of life\nSpeaker notes: Start with a microscope photo\./);
  assert.match(text, /Slide 2:\nParts of a cell\nNucleus\nMembrane/);
  // slide10 sorts after slide9, not after slide1
  assert.ok(text.indexOf("Extra 9") < text.indexOf("Extra 10"));
});

test("a file that isn't the claimed kind is an error, not garbage", async () => {
  await assert.rejects(extractOfficeText(await zipOf({ "other.xml": "<x/>" }), "word"), /not a Word document/);
  await assert.rejects(extractOfficeText(new Uint8Array([1, 2, 3]), "excel"));
});

test("tells text from binary", () => {
  assert.ok(looksLikeText(new TextEncoder().encode("const x = 1;\n\tconsole.log('héllo');\n")));
  assert.ok(!looksLikeText(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])));
  assert.ok(!looksLikeText(new Uint8Array(Array.from({ length: 200 }, (_, i) => (i % 7) + 1))));
});
