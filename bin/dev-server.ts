import * as fs from 'fs';
import * as path from 'path';
import { startServer } from '../src/server/index';
import { createDemoData } from './demo-data';

// Keep development ingestion separate from the installed dashboard's database.
const dataDir = path.resolve('.dev');
fs.mkdirSync(dataDir, { recursive: true });
const demo = process.argv.includes('--demo');
if (demo) process.env.OPENCLAW_HOME = createDemoData(dataDir);
startServer({
  port: 4242,
  clawHome: process.env.OPENCLAW_HOME,
  dbPath: path.join(dataDir, demo ? 'demo.db' : 'claw-lens.db'),
  open: false,
  serveUi: false,
}).catch(err => {
  console.error(err);
  process.exitCode = 1;
});
