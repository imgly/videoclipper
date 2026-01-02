import { promises as fs } from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceDir = path.join(root, "node_modules", "face-api.js", "weights");
const targetDir = path.join(root, "public", "models");
const weightsBaseUrl =
  "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights";

const files = [
  "tiny_face_detector_model-weights_manifest.json",
  "tiny_face_detector_model-shard1",
];

const copyFile = async (file) => {
  const source = path.join(sourceDir, file);
  const dest = path.join(targetDir, file);
  await fs.copyFile(source, dest);
};

const downloadFile = async (file) => {
  const dest = path.join(targetDir, file);
  const response = await fetch(`${weightsBaseUrl}/${file}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${file}: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(dest, buffer);
};

const ensureFile = async (file) => {
  const dest = path.join(targetDir, file);
  try {
    await fs.access(dest);
    return { file, status: "present" };
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
  }

  try {
    await copyFile(file);
    return { file, status: "copied" };
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
  }

  try {
    await downloadFile(file);
    return { file, status: "downloaded" };
  } catch (error) {
    return { file, status: "missing", error };
  }
};

const main = async () => {
  await fs.mkdir(targetDir, { recursive: true });

  const missing = [];
  const results = [];
  for (const file of files) {
    const result = await ensureFile(file);
    results.push(result);
    if (result.status === "missing") {
      missing.push(file);
    }
  }

  if (missing.length) {
    console.warn(
      `Missing face-api.js weights: ${missing.join(", ")}. ` +
        "Download them from the face-api.js repo if network access is restricted."
    );
  } else {
    const summary = results
      .map(({ file, status }) => `${file} (${status})`)
      .join(", ");
    console.log(`face-api.js Tiny Face Detector ready: ${summary}`);
  }
};

main().catch((error) => {
  console.error("Failed to prepare face-api.js weights.", error);
  process.exitCode = 1;
});
