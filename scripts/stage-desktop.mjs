import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, "desktop-app");

await mkdir(appDir, { recursive: true });

const sourceMain = await readFile(path.join(root, "electron", "main.cjs"), "utf8");
const stagedMain = sourceMain.replace(
  'path.join(__dirname, "..", "desktop-dist", "index.html")',
  'path.join(__dirname, "renderer", "index.html")',
);

await writeFile(path.join(appDir, "main.cjs"), stagedMain, "utf8");
await cp(path.join(root, "electron", "preload.cjs"), path.join(appDir, "preload.cjs"), { force: true });
await cp(path.join(root, "desktop-dist"), path.join(appDir, "renderer"), {
  recursive: true,
  force: true,
});
