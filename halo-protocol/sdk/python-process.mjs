import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function publicPythonEnvironment() {
  const environment = { PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1' };
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG']) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  return environment;
}

/** The child receives public files and an allowlisted environment, never the operator wallet environment. */
export async function runPublicPython({ python, script, args, directory, timeoutMs = 60000 }) {
  fs.mkdirSync(directory, { recursive: true });
  const logPath = path.join(directory, 'process.log');
  const log = fs.openSync(logPath, 'w');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(python, [script, ...args], { shell: false, windowsHide: true, cwd: directory,
        stdio: ['ignore', log, log], env: publicPythonEnvironment() });
      const timer = setTimeout(() => { child.kill(); reject(new Error('Public computation exceeded its deadline')); }, timeoutMs);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`Public computation failed (${code}); inspect ${logPath}`)); });
    });
  } finally { fs.closeSync(log); }
}
