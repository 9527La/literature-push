import pdfMake from "pdfmake/build/pdfmake.js";
import pdfFonts from "pdfmake/build/vfs_fonts.js";

// Initialize pdfmake with fonts
pdfMake.vfs = pdfFonts.pdfMake ? pdfFonts.pdfMake.vfs : pdfFonts.vfs || pdfFonts;

/**
 * Same brand language as the web app and the email: one accent colour, a
 * hairline rule, and the mark reproduced with vector primitives (pdfmake cannot
 * embed the SVG the browser uses, so the geometry is redrawn here).
 */
const BRAND = {
  accent: "#3157d5",
  ink: "#171b24",
  body: "#3f4653",
  muted: "#7d8592",
  line: "#e3e7ee"
};

const CONTENT_WIDTH = 515;

function brandMarkCanvas() {
  return {
    canvas: [
      { type: "rect", x: 0, y: 0, w: 24, h: 24, r: 6, color: BRAND.accent },
      { type: "line", x1: 8, y1: 8, x2: 16, y2: 8, lineWidth: 1.5, lineColor: "#ffffff" },
      { type: "line", x1: 8, y1: 8, x2: 8, y2: 17, lineWidth: 1.5, lineColor: "#ffffff" },
      { type: "line", x1: 16, y1: 8, x2: 16, y2: 17, lineWidth: 1.5, lineColor: "#ffffff" },
      { type: "line", x1: 6, y1: 17, x2: 18, y2: 17, lineWidth: 1.5, lineColor: "#ffffff" }
    ],
    width: 24
  };
}

export async function generatePdfFromMarkdown(markdown, title = "文献周报") {
  const stamp = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
  const docDefinition = {
    content: [
      {
        columns: [
          brandMarkCanvas(),
          {
            width: 12,
            text: ""
          },
          {
            width: "*",
            text: [
              { text: "电力文献", bold: true, fontSize: 14, color: BRAND.ink },
              { text: "  ·  ", color: BRAND.muted },
              { text: title, fontSize: 11, color: BRAND.body }
            ]
          },
          { width: 100, text: stamp, fontSize: 9, color: BRAND.muted, alignment: "right" }
        ],
        margin: [0, 0, 0, 10]
      },
      {
        canvas: [{ type: "line", x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0, lineWidth: 0.8, lineColor: BRAND.line }],
        margin: [0, 0, 0, 16]
      }
    ],
    defaultStyle: {
      fontSize: 10,
      color: BRAND.body,
      lineHeight: 1.4
    },
    pageMargins: [40, 44, 40, 52],
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: "电力文献 · 内部资料，引用前请核对原文", fontSize: 8, color: BRAND.muted },
        { text: `${currentPage} / ${pageCount}`, fontSize: 8, color: BRAND.muted, alignment: "right" }
      ],
      margin: [40, 12, 40, 0]
    })
  };

  // Parse markdown into pdfmake content
  const lines = markdown.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      docDefinition.content.push({ text: "", margin: [0, 5, 0, 5] });
      continue;
    }

    // Handle headers
    if (trimmed.startsWith("# ")) {
      docDefinition.content.push({
        text: trimmed.slice(2),
        style: "header1",
        margin: [0, 10, 0, 5]
      });
    } else if (trimmed.startsWith("## ")) {
      docDefinition.content.push({
        text: trimmed.slice(3),
        style: "header2",
        margin: [0, 14, 0, 5]
      });
    } else if (trimmed.startsWith("### ")) {
      docDefinition.content.push({
        text: trimmed.slice(4),
        style: "header3",
        margin: [0, 10, 0, 4]
      });
    } else if (/^-{3,}$/.test(trimmed)) {
      docDefinition.content.push({
        canvas: [{ type: "line", x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0, lineWidth: 0.5, lineColor: BRAND.line }],
        margin: [0, 12, 0, 12]
      });
    } else if (trimmed.startsWith("- ")) {
      docDefinition.content.push({
        text: trimmed.slice(2),
        margin: [15, 2, 0, 2]
      });
    } else {
      docDefinition.content.push({
        text: trimmed,
        margin: [0, 2, 0, 2]
      });
    }
  }

  docDefinition.styles = {
    header1: { fontSize: 17, bold: true, color: BRAND.accent, margin: [0, 10, 0, 6] },
    header2: { fontSize: 13, bold: true, color: BRAND.ink, margin: [0, 14, 0, 5] },
    header3: { fontSize: 11, bold: true, color: BRAND.ink, margin: [0, 10, 0, 4] }
  };

  return new Promise((resolve, reject) => {
    try {
      const pdfDoc = pdfMake.createPdf(docDefinition);
      pdfDoc.getBuffer((buffer) => {
        resolve(Buffer.from(buffer));
      });
    } catch (error) {
      reject(error);
    }
  });
}
