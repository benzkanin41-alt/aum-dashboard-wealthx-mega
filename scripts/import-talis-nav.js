import fs from "node:fs/promises";
import path from "node:path";
import { fetchTalisPublicNav, mergeTalisRowsIntoHistory, purgeEstimatedHistory } from "../server-lib/talis-public.js";

const ROOT = process.cwd();
const configPath = path.join(ROOT, "config", "funds.json");
const historyPath = path.join(ROOT, "data", "nav-history.json");

const config = JSON.parse(await fs.readFile(configPath, "utf8"));
let history = {};
try {
  history = JSON.parse(await fs.readFile(historyPath, "utf8"));
} catch {
  history = {};
}

const rows = await fetchTalisPublicNav();
const removedEstimatedRows = purgeEstimatedHistory(history);
const result = mergeTalisRowsIntoHistory({ config, history, rows });
await fs.mkdir(path.dirname(historyPath), { recursive: true });
await fs.writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ ...result, removedEstimatedRows }, null, 2));
