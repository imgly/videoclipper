import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "public");

const ensureDir = (dir) => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
};

const copyAssets = (srcRelative, destRelative) => {
  const src = path.join(projectRoot, srcRelative);
  const dest = path.join(publicDir, destRelative);
  if (!existsSync(src)) {
    console.warn(`Skipping ${srcRelative}, source not found.`);
    return;
  }
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  console.log(`Copied ${srcRelative} -> public/${destRelative}`);
};

ensureDir(publicDir);
copyAssets("node_modules/@cesdk/engine/assets", "cesdk-engine");
copyAssets("node_modules/@cesdk/cesdk-js/assets", "cesdk-js/assets");
