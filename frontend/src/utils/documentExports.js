import { downloadBlob } from "./mediaDownloads";
import { jsPDF } from "jspdf";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, BorderStyle, WidthType, convertInchesToTwip } from "docx";
import * as XLSX from "xlsx";

const clean = (value) => String(value ?? "").trim();
const safeName = (name) => (clean(name) || "vetroai-response").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "");
const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Parse markdown headers (# ## ###)
const parseMarkdownHeaders = (text) => {
  const lines = text.split(/\r?\n/);
  return lines.map((line) => {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      return { type: "heading", level, text: match[2] };
    }
    return { type: "text", text: line };
  });
};

// Extract markdown tables
const extractMarkdownTables = (text) => {
  const tableRegex = /\|(.+)\|[\r\n]+\|[\s\-:|]+\|[\r\n]+((?:\|.+\|[\r\n]*)*)/g;
  const tables = [];
  let match;
  while ((match = tableRegex.exec(text)) !== null) {
    const headerRow = match[1].split("|").map((cell) => clean(cell));
    const bodyRows = match[2]
      .split(/\r?\n/)
      .filter((row) => row.includes("|"))
      .map((row) => row.split("|").map((cell) => clean(cell)));
    tables.push({ headers: headerRow, rows: bodyRows });
  }
  return tables;
};

// Export to PDF using jsPDF
const exportToPdf = async (content, filename) => {
  const text = clean(content);
  if (!text) throw new Error("There is no response content to export.");
  
  const doc = new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const maxWidth = pageWidth - 2 * margin;
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  
  let yPosition = margin;
  const lineHeight = 7;
  const pageMarginBottom = pageHeight - margin;
  
  // Split text into lines and wrap them
  const lines = doc.splitTextToSize(text, maxWidth);
  
  for (const line of lines) {
    if (yPosition + lineHeight > pageMarginBottom) {
      doc.addPage();
      yPosition = margin;
    }
    doc.text(line, margin, yPosition);
    yPosition += lineHeight;
  }
  
  const blob = doc.output("blob");
  downloadBlob(blob, `${filename}.pdf`);
};

// Export to DOCX using docx library
const exportToDocx = async (content, filename) => {
  const text = clean(content);
  if (!text) throw new Error("There is no response content to export.");
  
  const parsed = parseMarkdownHeaders(text);
  const sections = [];
  let currentSection = [];
  
  for (const item of parsed) {
    if (item.type === "heading") {
      if (currentSection.length > 0) {
        sections.push({ type: "text", items: currentSection });
        currentSection = [];
      }
      sections.push({ type: "heading", level: item.level, text: item.text });
    } else if (item.text.trim()) {
      currentSection.push(item.text);
    }
  }
  if (currentSection.length > 0) {
    sections.push({ type: "text", items: currentSection });
  }
  
  const paragraphs = sections.map((section) => {
    if (section.type === "heading") {
      return new Paragraph({
        text: section.text,
        heading: HeadingLevel[`HEADING_${Math.min(section.level, 6)}`],
        spacing: { before: 240, after: 120 },
      });
    } else {
      return section.items.map(
        (item) => new Paragraph({
          text: item,
          spacing: { after: 200 },
        })
      );
    }
  }).flat();
  
  const doc = new Document({ sections: [{ children: paragraphs }] });
  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `${filename}.docx`);
};

// Export to XLSX using xlsx library
const exportToXlsx = async (content, filename) => {
  const text = clean(content);
  if (!text) throw new Error("There is no response content to export.");
  
  const tables = extractMarkdownTables(text);
  
  if (tables.length > 0) {
    const workbook = XLSX.utils.book_new();
    tables.forEach((table, idx) => {
      const sheetData = [table.headers, ...table.rows];
      const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
      
      // Auto-size columns
      const colWidths = table.headers.map((_, i) => {
        const maxLen = Math.max(...sheetData.map((row) => String(row[i] || "").length));
        return { wch: Math.min(maxLen + 2, 50) };
      });
      worksheet["!cols"] = colWidths;
      
      XLSX.utils.book_append_sheet(workbook, worksheet, `Table ${idx + 1}`);
    });
    
    XLSX.writeFile(workbook, `${filename}.xlsx`);
  } else {
    // No tables, put content into a simple worksheet
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    const sheetData = [["Content"], ...lines.map((line) => [line])];
    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
    worksheet["!cols"] = [{ wch: 80 }];
    
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Response");
    XLSX.writeFile(workbook, `${filename}.xlsx`);
  }
};

export const exportResponse = async ({ content, format, filename = "vetroai-response" }) => {
  const text = clean(content);
  if (!text) throw new Error("There is no response content to export.");
  const base = safeName(filename);
  const kind = String(format || "txt").toLowerCase();

  try {
    if (kind === "txt") {
      downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), `${base}.txt`);
    } else if (kind === "md" || kind === "markdown") {
      downloadBlob(new Blob([text], { type: "text/markdown;charset=utf-8" }), `${base}.md`);
    } else if (kind === "csv") {
      const rows = text.split(/\r?\n/).filter(Boolean).map((line) => `"${line.replace(/"/g, '""')}"`).join("\r\n");
      downloadBlob(new Blob([`Content\r\n${rows}`], { type: "text/csv;charset=utf-8" }), `${base}.csv`);
    } else if (kind === "pdf") {
      await exportToPdf(content, base);
    } else if (kind === "docx" || kind === "doc") {
      await exportToDocx(content, base);
    } else if (kind === "xlsx" || kind === "xls") {
      await exportToXlsx(content, base);
    } else {
      throw new Error(`Unsupported format: ${kind}`);
    }
  } catch (error) {
    console.error(`Export to ${kind.toUpperCase()} failed:`, error);
    throw new Error(`Could not create ${kind.toUpperCase()} export. ${error.message || ""}`);
  }
};
