'use strict';
const {execFile}=require('node:child_process');
module.exports=function createArchiveConflictIPC({getWebContents,expectedDocumentURL,resolveInstallation,exec=execFile}){
 return async(event,{mode,input}={})=>{
  const web=getWebContents();
  if(!web||web.isDestroyed()||event?.sender!==web||event.senderFrame!==web.mainFrame||event.senderFrame.url!==expectedDocumentURL||!expectedDocumentURL.startsWith('file://'))throw Error('ARCHIVE_UI_SENDER_REJECTED');
  const keys=mode==='conflicts'?[]:mode==='review-conflict'?['deviceId','operationId']:mode==='resolve-conflict'?['choice','currentRevision','reviewId']:null;
  if(!keys||!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!==keys.sort().join(',')||JSON.stringify(input).length>8192)throw Error('ARCHIVE_UI_ARGUMENT_INVALID');
  if(mode==='resolve-conflict'&&(!['proposed','current'].includes(input.choice)||typeof input.reviewId!=='string'||!Number.isSafeInteger(input.currentRevision)||input.currentRevision<0))throw Error('ARCHIVE_UI_ARGUMENT_INVALID');
  const config=resolveInstallation();if(!config)throw Error('ARCHIVE_RESOLUTION_NOT_ENABLED');
  return new Promise((resolve,reject)=>{
   const child=exec(config.nodePath,[config.helperPath,config.configPath,mode],{encoding:'utf8',timeout:45000,maxBuffer:32768},(error,stdout)=>{
    let result;try{result=JSON.parse(stdout)}catch{}
    if(error||!result||result.error)return reject(Error(/^ARCHIVE_[A-Z_]+$/.test(result?.error??'')?result.error:'ARCHIVE_CONFLICT_HELPER_UNAVAILABLE'));
    resolve(result);
   });
   child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
  });
 };
};
