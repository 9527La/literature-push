import pdfMake from "pdfmake/build/pdfmake.js";
import pdfFonts from "pdfmake/build/vfs_fonts.js";

// Initialize pdfmake with fonts
pdfMake.vfs = pdfFonts.pdfMake ? pdfFonts.pdfMake.vfs : pdfFonts.vfs || pdfFonts;

export async function generatePdfFromMarkdown(markdown, title = "文献周报") {
  const docDefinition = {
    content: [],
    defaultStyle: {
      fontSize: 10
    }
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
        margin: [0, 8, 0, 4]
      });
    } else if (trimmed.startsWith("### ")) {
      docDefinition.content.push({
        text: trimmed.slice(4),
        style: "header3",
        margin: [0, 6, 0, 3]
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
    header1: { fontSize: 18, bold: true, margin: [0, 10, 0, 5] },
    header2: { fontSize: 15, bold: true, margin: [0, 8, 0, 4] },
    header3: { fontSize: 12, bold: true, margin: [0, 6, 0, 3] }
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
