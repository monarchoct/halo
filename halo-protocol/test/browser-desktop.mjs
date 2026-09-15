import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {desktopScreenIsPublic} from '../runtime/browser/desktop.mjs';
import {createReportWriter} from '../runtime/browser/report-writer.mjs';
import {browserReportSchema} from '../runtime/browser/schema.mjs';
import {frameSchema} from '../services/browser/server.mjs';
const passed=[];
const page={url:()=> 'https://fomo.family/',getByRole:()=>({allTextContents:async()=>[],count:async()=>0}),
  locator:selector=>({count:async()=>0,innerText:async()=> 'Public markets',evaluateAll:async()=>page.filled}),filled:false};
assert.equal(await desktopScreenIsPublic(page,'fomo'),true);page.filled=true;assert.equal(await desktopScreenIsPublic(page,'fomo'),false);
page.filled=false;page.url=()=> 'https://fomo.family/?private=token';assert.equal(await desktopScreenIsPublic(page,'fomo'),false);
passed.push('Desktop capture refuses populated editable controls and private URL parameters');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'halo-desktop-'));
const job={id:'d'.repeat(64),platform:'fomo',display:'desktop'};let release,entered;
const started=new Promise(resolve=>{entered=resolve;});
const writer=createReportWriter({page,job,directory,isPublic:async()=>true,captureDesktop:async()=>{entered();await new Promise(resolve=>{release=resolve;});return Buffer.from('private desktop bytes');}});
const capture=writer.report({activity:'Public desktop',state:'viewing'});await started;
const privateStep=writer.report({activity:'Private login',state:'private'});release();await capture;await privateStep;await writer.close();
assert(!fs.readdirSync(directory).some(file=>file.endsWith('.jpg')));
for(const file of fs.readdirSync(directory)){const report=browserReportSchema.parse(JSON.parse(fs.readFileSync(path.join(directory,file))));assert.equal(report.surface,'desktop');assert.equal(report.state,'private');fs.unlinkSync(path.join(directory,file));}
fs.rmdirSync(directory);passed.push('A transition to authentication discards a whole-desktop capture already in flight before public persistence');
const frame={version:'halo.browser-frame.v1',chainId:31337,registry:`0x${'1'.repeat(40)}`,agent:`0x${'2'.repeat(40)}`,operator:`0x${'3'.repeat(40)}`,
  sessionId:'12345678-1234-4234-8234-123456789012',sequence:0,previousHash:`0x${'0'.repeat(64)}`,timestamp:new Date().toISOString(),source:'local-browser-worker',
  siteOrigin:'https://fomo.family',activity:'Public desktop',state:'viewing',width:1280,height:800,mimeType:'image/jpeg',imageHash:`0x${'a'.repeat(64)}`};
assert.equal(frameSchema.parse(frame).surface,undefined);assert.equal(frameSchema.parse({...frame,surface:'desktop'}).surface,'desktop');
assert.throws(()=>frameSchema.parse({...frame,surface:'invented'}));passed.push('Relay preserves legacy signed records and validates the optional desktop surface without rewriting signatures');
const report={checkedAt:new Date().toISOString(),passed,scope:'Injected page and capture boundaries; no actual desktop process, external account or publication. Separate Linux headed-browser acceptance is required.'};
fs.writeFileSync(new URL('../test-results/browser-desktop.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
