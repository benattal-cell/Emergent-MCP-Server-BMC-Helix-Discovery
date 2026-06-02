import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const source = path.resolve("src/data");
const destination = path.resolve("dist/data");

if (existsSync(source)) {
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true });
}
