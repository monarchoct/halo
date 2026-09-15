import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { openDatabase, migrate } from './database.mjs';
if (!process.argv[2]) throw new Error('Usage: node services/persistence/migrate-cli.mjs database.json [--local-test]');
const file = path.resolve(process.argv[2]);
const config = z.object({ connectionEnvironment: z.string().regex(/^[A-Z][A-Z0-9_]*$/), caFile: z.string().optional() }).strict().parse(JSON.parse(fs.readFileSync(file)));
const url = process.env[config.connectionEnvironment];
if (!url) throw new Error('Database connection environment is unavailable');
const database = openDatabase({ url, local: process.argv.includes('--local-test'),
  ...(config.caFile ? { ca: fs.readFileSync(path.resolve(path.dirname(file), config.caFile), 'utf8') } : {}) });
try { console.log(JSON.stringify(await migrate(database))); } finally { await database.close(); }
