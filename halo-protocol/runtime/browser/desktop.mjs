import fs from 'node:fs';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {screenIsPublic} from './social-driver.mjs';
const execute=promisify(execFile);

/** One display inside one isolated workspace. No VNC, input socket or host desktop access. */
export async function startDesktop() {
  if(process.platform!=='linux'||process.getuid()!==1000)throw new Error('Desktop requires isolated Linux UID 1000');
  if(fs.existsSync('/tmp/.X11-unix/X99'))throw new Error('Desktop display is already occupied');
  const env={...process.env,DISPLAY:':99'},children=[];
  const launch=(binary,args)=>{const child=spawn(binary,args,{env,stdio:'ignore'});let failed=false;child.on('error',()=>{failed=true;});children.push(child);return()=>!failed&&child.exitCode===null;};
  const alive=launch('Xvfb',[':99','-screen','0','1280x800x24','-nolisten','tcp','-noreset']);
  async function close(){
    for(const child of [...children].reverse())if(child.exitCode===null)child.kill('SIGTERM');
    await Promise.all(children.map(child=>new Promise(resolve=>{
      if(child.exitCode!==null||!child.pid)return resolve();
      const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},2000);
      child.once('close',()=>{clearTimeout(timer);resolve();});
    })));
  }
  try {
    const deadline=Date.now()+5000;
    while(!fs.existsSync('/tmp/.X11-unix/X99')){
      if(!alive()||Date.now()>deadline)throw new Error('Desktop display did not become ready');
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    const wmAlive=launch('openbox',['--sm-disable']);
    // No model-selected process arguments or commands enter this capture boundary.
    return {env,width:1280,height:800,close,async capture(page,platform){
      if(!alive()||!wmAlive())throw new Error('Desktop is unavailable');
      if(!await desktopScreenIsPublic(page,platform))return undefined;
      const {stdout}=await execute('import',['-display',':99','-window','root','-quality','65','jpeg:-'],
        {env,encoding:'buffer',timeout:5000,maxBuffer:2000000});
      if(!await desktopScreenIsPublic(page,platform))return undefined;
      return stdout;
    }};
  }catch(error){await close();throw error;}
}

export async function desktopScreenIsPublic(page,platform){
  if(!await screenIsPublic(page,platform))return false;
  try{
    // Whole-desktop capture cannot apply Playwright's element masks. Hide the entire
    // frame whenever entered text or editable content could reveal private input.
    return !await page.locator('input,textarea,[contenteditable="true"],[data-private]').evaluateAll(nodes=>nodes.some(node=>
      node.hasAttribute('data-private')||('value' in node&&String(node.value).length>0)||(node.isContentEditable&&node.textContent?.trim())));
  }catch{return false;}
}
