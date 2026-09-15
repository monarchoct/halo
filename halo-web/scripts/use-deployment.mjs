#!/usr/bin/env node
// Point the website at a deployment before building: node scripts/use-deployment.mjs testnet|local
// Copies halo-protocol/deploy/<env>/deployment.json to public/deployment.json (the file the app fetches at runtime).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const env = process.argv[2];
if (!["testnet", "local", "mainnet"].includes(env ?? "")) { console.error("Usage: node scripts/use-deployment.mjs testnet|local|mainnet"); process.exit(1); }
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = env === "local" ? path.join(web, "../halo-protocol/test-results/local-deployment.json") : path.join(web, `../halo-protocol/deploy/${env}/deployment.json`);
if (!fs.existsSync(source)) { console.error(`No deployment file at ${source}`); process.exit(1); }
const deployment = JSON.parse(fs.readFileSync(source, "utf8"));
if (deployment.environment !== env) { console.error(`${source} is a ${deployment.environment} deployment, not ${env}`); process.exit(1); }
fs.writeFileSync(path.join(web, "public/deployment.json"), JSON.stringify(deployment, null, 2) + "\n");
console.log(`public/deployment.json → ${env} (chain ${deployment.chainId}, api ${deployment.apiUrl})`);
