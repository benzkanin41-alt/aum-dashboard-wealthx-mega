import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const config = JSON.parse(readFileSync(new URL("../config/storage.json", import.meta.url), "utf8"));
export const DATA_ROOT = process.env.AUM_DATA_ROOT || (process.platform === "win32" ? config.windowsDataRoot : null);
if (!DATA_ROOT || !path.isAbsolute(DATA_ROOT)) throw new Error("Set AUM_DATA_ROOT to the migrated absolute data directory.");
if (!statSync(DATA_ROOT, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`Dashboard data drive is unavailable: ${DATA_ROOT}`);
export const DATA_DIR = path.join(DATA_ROOT, "local-data");
export const CACHE_DIR = path.join(DATA_ROOT, "cache");
export const DEV_STATE_DIR = path.join(DATA_ROOT, "dev-state");
export const dataPath = (name) => path.join(DATA_DIR, name);
export const cachePath = (name) => path.join(CACHE_DIR, name);
