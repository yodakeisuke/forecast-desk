import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { hostHeaders, sandboxHeaders } from '../security.config.mjs';
const [kind, destination] = process.argv.slice(2);
if (!['app','sandbox'].includes(kind) || !destination) throw new Error('stage-site.mjs app|sandbox <output directory>');
const target = resolve(destination), source = resolve(`dist/${kind}`);
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
  await writeFile(join(temp,'server','index.js'), (await readFile(resolve('worker/security-worker.mjs'),'utf8'))+'\nexport default createWorker('+JSON.stringify(config)+');\n');
  await rm(target,{recursive:true,force:true});
  await cp(temp,target,{recursive:true});
  console.log(`Staged ${kind}: header-enforcing Worker + ${Object.keys(assets).length} static assets`);
} finally { await rm(temp,{recursive:true,force:true}); }
