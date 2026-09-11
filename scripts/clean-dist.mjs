import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distPath = path.join(projectRoot, "dist");

function emptyDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  for (const entry of fs.readdirSync(directory)) {
    const entryPath = path.join(directory, entry);
    const stat = fs.lstatSync(entryPath);
    if (stat.isDirectory()) {
      emptyDirectory(entryPath);
      try { fs.rmdirSync(entryPath); } catch {}
    } else {
      fs.unlinkSync(entryPath);
    }
  }
}

// This checkout keeps the dist directory itself in a managed folder that may
// reject recursive directory removal. Empty its files explicitly instead.
emptyDirectory(distPath);
