import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { root } from '../scripts/compile.mjs';
import { kuboReplica } from '../sdk/artifacts.mjs';

/** Separate real Kubo repositories on one test host. This is not independent-provider hosting evidence. */
export async function startLocalIpfs({ directory = path.join(root, 'test-results/ipfs'), portBase = 5101, count = 3 } = {}) {
  const binary = process.env.HALO_IPFS_BINARY ?? path.resolve(root, '../../work/toolchain/kubo-0.43.0/kubo', process.platform === 'win32' ? 'ipfs.exe' : 'ipfs');
  const processes = [], descriptors = [], replicas = [], endpoints = [];
  async function stop() {
    for (const child of processes) child.kill();
    await Promise.all(processes.filter(child => child.exitCode === null).map(child => new Promise(resolve => child.once('exit', resolve))));
    for (const fd of descriptors) fs.closeSync(fd);
  }
  try {
    for (let index = 0; index < count; index++) {
      const repo = path.resolve(directory, `peer-${index}`);
      fs.mkdirSync(repo, { recursive: true });
      const fd = fs.openSync(path.join(repo, 'daemon.log'), 'a'); descriptors.push(fd);
      const env = { ...process.env, IPFS_PATH: repo };
      if (!fs.existsSync(path.join(repo, 'config'))) {
        const initialized = spawnSync(binary, ['init', '--profile=test'], { env, stdio: ['ignore', fd, fd], windowsHide: true, timeout: 30000 });
        if (initialized.error || initialized.status !== 0) throw new Error('Could not initialize the local IPFS test repository');
      }
      const configPath = path.join(repo, 'config');
      const config = JSON.parse(fs.readFileSync(configPath));
      config.Addresses.API = `/ip4/127.0.0.1/tcp/${portBase + index}`;
      config.Addresses.Gateway = `/ip4/127.0.0.1/tcp/${portBase + index + 100}`;
      config.Addresses.Swarm = [];
      config.Bootstrap = [];
      fs.writeFileSync(configPath, JSON.stringify(config));
      const child = spawn(binary, ['daemon', '--offline', '--migrate=false'], { env, stdio: ['ignore', fd, fd], windowsHide: true });
      processes.push(child);
      child.on('error', () => {});
      const apiUrl = `http://127.0.0.1:${portBase + index}`;
      const replica = kuboReplica({ apiUrl });
      let ready = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        try { await replica.identity(); ready = true; break; } catch { }
        if (child.exitCode !== null) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (!ready) throw new Error(`Local IPFS peer ${index} did not start; inspect its daemon.log`);
      replicas.push(replica); endpoints.push(apiUrl);
    }
    return { replicas, endpoints, stop };
  } catch (error) { await stop(); throw error; }
}
