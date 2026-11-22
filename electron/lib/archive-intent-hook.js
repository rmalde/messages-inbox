'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
function privateJson(file){const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o077)||st.size>32768)throw Error('ARCHIVE_INSTALL_INVALID');return JSON.parse(fs.readFileSync(file,'utf8'))}
function installedHelper(storePath){
 const home=os.homedir(),base=path.join(home,'Library/Application Support/PersonalTaskArchive'),state=path.join(base,'imessage');
 if(storePath!==path.join(home,'Library/Application Support/Messages Inbox/inbox-store.json'))throw Error('ARCHIVE_STORE_PATH_MISMATCH');
 let install;try{install=privateJson(path.join(state,'installation.json'))}catch(e){if(e.code==='ENOENT')return null;throw e}
 const configPath=path.join(state,'config.json'),config=privateJson(configPath),release=path.join(base,'releases');
 if(install.schema!==1||install.provider!=='imessage'||install.configPath!==configPath||config.provider!=='imessage'||install.deviceId!==config.deviceId||!path.isAbsolute(install.nodePath??'')||path.dirname(install.release??'')!==release||! /^[0-9a-f]{64}$/.test(path.basename(install.release)))throw Error('ARCHIVE_INSTALL_INVALID');
 const helperPath=path.join(install.release,'scripts/archive-intent-helper.mjs');
 if(fs.realpathSync(helperPath)!==helperPath||!fs.statSync(helperPath).isFile())throw Error('ARCHIVE_INSTALL_INVALID');
 return {nodePath:install.nodePath,helperPath,configPath};
}
/** Only explicit trusted renderer IPC enters here. Watchers/remote application never sign. */
function createArchiveIntentHook({getWebContents,expectedDocumentURL,enabled=true,chatExists=()=>false,onError=()=>{},resolveInstallation=installedHelper,spawn=spawnSync}){
 return {run(event,store,command,guid,now=Date.now()){
  const web=getWebContents();
  if(!web||web.isDestroyed()||event?.sender!==web||event.senderFrame!==web.mainFrame||event.senderFrame.url!==expectedDocumentURL)throw Error('ARCHIVE_UI_SENDER_REJECTED');
  if(!['chat:archive','chat:unarchive'].includes(command)||typeof guid!=='string'||! /^(?:iMessage|SMS|RCS|any);[+-];[^\x00-\x1f]{1,512}$/.test(guid)||!Number.isFinite(now)||now<0)throw Error('ARCHIVE_UI_ARGUMENT_INVALID');
  let config=null;try{if(enabled)config=resolveInstallation(store.filePath)}catch{onError('ARCHIVE_CAPTURE_CONFIGURATION_INVALID')}
  const envelopes=[],original=store._mutate;
  const call=(mode,input)=>{
   const out=spawn(config.nodePath,[config.helperPath,config.configPath,mode],{input:JSON.stringify(input),encoding:'utf8',stdio:['pipe','pipe','ignore'],timeout:15000,maxBuffer:16384});
   let result;try{result=JSON.parse(out.stdout)}catch{}
   if(out.status!==0||!result||result.error)throw Error('ARCHIVE_CAPTURE_UNAVAILABLE');return result;
  };
  store._mutate=function(fn){return original.call(this,()=>{
   // A visible conversation may have no app metadata until the first gesture.
   if(!Object.hasOwn(this.data.chats,guid)&&!chatExists(guid))throw Error('ARCHIVE_CHAT_NOT_KNOWN');
   fn();
   if(config)for(const field of command==='chat:archive'?['archivedAt']:['archivedAt','mutedAt']){
    try{const result=call('begin',{nativeId:guid,field,value:this.data.chats[guid][field]});
     if(typeof result.operation?.operationId!=='string')throw Error();envelopes.push(result.operation.operationId);
    }catch{onError('ARCHIVE_CAPTURE_PENDING')}
   }
  })};
  try{if(command==='chat:archive')store.archive(guid,now);else store.unarchive(guid)}finally{store._mutate=original}
  // Independent signed readback occurs after flock release + fsync. Failure never undoes user intent.
  for(const operationId of envelopes)try{call('confirm',{operationId})}catch{onError('ARCHIVE_READBACK_PENDING')}
  return true;
 }};
}
module.exports={createArchiveIntentHook,installedHelper};
