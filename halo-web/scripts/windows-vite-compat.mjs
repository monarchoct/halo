import fs from 'node:fs';

// Vite 8.0.13 assumes its optional mapped-drive discovery cannot fail synchronously.
// Restricted Windows hosts can reject spawning `net use`; native realpath remains valid
// for this checkout's local drive. Keep this narrow fallback reproducible after npm ci.
export function applyWindowsViteCompatibility() {
  if (process.platform !== 'win32') return;
  const packageFile = new URL('../node_modules/vite/package.json', import.meta.url);
  const version = JSON.parse(fs.readFileSync(packageFile, 'utf8')).version;
  if (version !== '8.0.13') return;
  const file = new URL('../node_modules/vite/dist/node/chunks/node.js', import.meta.url);
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes('HALO_WINDOWS_OPTIONAL_NET_USE')) return;
  const begin = '\texec("net use", (error, stdout) => {';
  const end = '\t\telse safeRealpathSync = windowsMappedRealpathSync;\n\t});';
  if (source.split(begin).length !== 2 || source.split(end).length !== 2) {
    throw new Error('Vite Windows compatibility patch no longer matches the pinned source');
  }
  fs.writeFileSync(file, source.replace(begin, '\t// HALO_WINDOWS_OPTIONAL_NET_USE\n\ttry {\n' + begin)
    .replace(end, end + '\n\t} catch (error) {\n\t\tif (error.code !== "EPERM" && error.code !== "ENOENT") throw error;\n\t\tsafeRealpathSync = fs.realpathSync.native;\n\t}'));
}
