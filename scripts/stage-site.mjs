import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, join, extname, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { HOST_ORIGIN, hostHeaders, sandboxHeaders } from '../security.config.mjs';
const [kind, destination, input] = process.argv.slice(2);
if (!['app','sandbox'].includes(kind) || !destination) throw new Error('stage-site.mjs app|sandbox <output directory> [asset directory]');
const target = resolve(destination), source = resolve(input ?? `dist/${kind}`);
const manifestPath = join(dirname(target), '.openai', 'hosting.json');
let manifest;
if (kind === 'app' && basename(target) === 'dist') {
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (manifest && (!manifest.project_id || manifest.static || (manifest.d1 && manifest.d1 !== 'DECIDE_QUOTA'))) {
    throw new Error('The app Sites manifest must identify a Worker Site with the DECIDE_QUOTA D1 binding available');
  }
}
const temp = await mkdtemp(join(tmpdir(), 'forecast-site-'));
try {
  await cp(source, join(temp,'client'), { recursive:true });
  const htmlName = kind === 'app' ? 'index.html' : 'runtime.html';
  const html = await readFile(join(temp,'client',htmlName),'utf8');
  if (!html.includes('/guarded/assets/')) throw new Error('Build with FPA_ASSET_BASE=/guarded/ before staging');
  await rm(join(temp,'client',htmlName));
  const mime={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
  const assets={};
  async function scan(dir, prefix='') {
    for(const e of await readdir(dir,{withFileTypes:true})) {
      const rel=prefix+e.name, path=join(dir,e.name);
      if(e.isDirectory()) { await scan(path,rel+'/'); continue; }
      if(e.name.endsWith('.html')) throw new Error('Unprotected HTML in static assets');
      const gzip=e.name.endsWith('.wasm');
      if(gzip) await writeFile(path,gzipSync(await readFile(path),{level:9}));
      assets['/guarded/'+rel]={path:'/'+rel,type:mime[extname(e.name)]||'application/octet-stream',gzip};
    }
  }
  await scan(join(temp,'client'));
  const config={headers:kind==='app'?hostHeaders():sandboxHeaders(),html,assets,pages:kind==='app'?['/','/index.html']:['/','/runtime','/runtime.html']};
  await mkdir(join(temp,'server'));
  if (kind === 'app') {
    const { build } = await import('vite');
    const entry = 'virtual:forecast-sites-worker';
    const worker = resolve('worker/security-worker.mjs');
    const relay = resolve('worker/sites-decide.ts');
    const output = await build({
      configFile: false, envDir: false, publicDir: false, logLevel: 'warn',
      plugins: [{
        name: 'forecast-sites-entry',
        resolveId(id) { if (id === entry) return '\0' + entry; },
        load(id) {
          if (id !== '\0' + entry) return;
          return `import { createWorker } from ${JSON.stringify(worker)};
import { createSitesDecide } from ${JSON.stringify(relay)};
const config = ${JSON.stringify(config)};
export default createWorker(config, createSitesDecide(${JSON.stringify(HOST_ORIGIN)}, config.headers));`;
        },
      }],
      build: {
        write: false, target: 'es2022', modulePreload: false,
        rollupOptions: {
          input: entry, preserveEntrySignatures: 'strict',
          output: { format: 'es', codeSplitting: false },
        },
      },
    });
    if (Array.isArray(output) || output.output.length !== 1 || output.output[0].type !== 'chunk') {
      throw new Error('Expected a single server Worker module');
    }
    await writeFile(join(temp, 'server', 'index.js'), output.output[0].code);
    await cp(resolve('drizzle'), join(temp, '.openai', 'drizzle'), { recursive: true });
  } else {
    await writeFile(join(temp,'server','index.js'), (await readFile(resolve('worker/security-worker.mjs'),'utf8'))+'\nexport default createWorker('+JSON.stringify(config)+');\n');
  }
  await rm(target,{recursive:true,force:true});
  await cp(temp,target,{recursive:true});
  if (manifest && manifest.d1 !== 'DECIDE_QUOTA') {
    await writeFile(manifestPath, JSON.stringify({ ...manifest, d1: 'DECIDE_QUOTA' }, null, 2) + '\n');
  }
  console.log(`Staged ${kind}: header-enforcing Worker + ${Object.keys(assets).length} static assets`);
} finally { await rm(temp,{recursive:true,force:true}); }
