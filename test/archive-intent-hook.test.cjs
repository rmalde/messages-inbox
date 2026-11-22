const test=require('node:test'),assert=require('node:assert/strict');
const {createArchiveIntentHook}=require('../electron/lib/archive-intent-hook');
const guid='any;+;chat123',url='file:///fixture/dist/index.html';
function fixture({fail=false,writeFail=false,chatExists}={}){
 const calls=[],frame={url},web={mainFrame:frame,isDestroyed:()=>false},event={sender:web,senderFrame:frame};let locked=false,written=false;
 const store={filePath:'/fixture/inbox-store.json',data:{chats:{[guid]:{archivedAt:null,mutedAt:1}}},_mutate(fn){locked=true;try{fn();if(writeFail)throw Error('WRITE_FAILED');written=true}finally{locked=false}},archive(g,t){this._mutate(()=>this.data.chats[g].archivedAt=t)},unarchive(g){this._mutate(()=>{this.data.chats[g].archivedAt=null;this.data.chats[g].mutedAt=null})}};
 const errors=[],hook=createArchiveIntentHook({chatExists,getWebContents:()=>web,expectedDocumentURL:url,onError:c=>errors.push(c),resolveInstallation:()=>({nodePath:'/node',helperPath:'/helper',configPath:'/config'}),spawn:(node,args,options)=>{const input=JSON.parse(options.input),mode=args[2];calls.push({mode,input});assert.equal(node,'/node');if(mode==='begin'){assert.equal(locked,true);assert.equal(input.nativeId,guid)}else{assert.equal(locked,false);assert.equal(written,true)}return fail?{status:1,stdout:'private error'}:{status:0,stdout:JSON.stringify(mode==='begin'?{operation:{operationId:'op'+calls.length}}:{status:'confirmed'})}}});
 return {hook,event,store,calls,errors,web};
}
test('explicit archive reserves exact GUID and value under lock, confirms only after write',()=>{const f=fixture();f.hook.run(f.event,f.store,'chat:archive',guid,123);assert.deepEqual(f.calls.map(c=>c.mode),['begin','confirm']);assert.deepEqual(f.calls[0].input,{nativeId:guid,field:'archivedAt',value:123})});
test('Move to Inbox signs both archive and mute clears',()=>{const f=fixture();f.hook.run(f.event,f.store,'chat:unarchive',guid);assert.deepEqual(f.calls.filter(c=>c.mode==='begin').map(c=>[c.input.field,c.input.value]),[['archivedAt',null],['mutedAt',null]])});
test('foreign renderer, child frame, navigation, row IDs and unrelated command fail before signing',()=>{for(const change of [f=>f.event.sender={},f=>f.event.senderFrame={url},f=>f.event.senderFrame.url='https://evil.example']){const f=fixture();change(f);assert.throws(()=>f.hook.run(f.event,f.store,'chat:archive',guid),/SENDER/);assert.equal(f.calls.length,0)}for(const [command,id] of [['chat:unknown',guid],['chat:archive','42'],['chat:archive','iMessage;+;unknown']]){const f=fixture();assert.throws(()=>f.hook.run(f.event,f.store,command,id));assert.equal(f.calls.length,0)}});
test('helper failure preserves explicit local action and reports only safe code',()=>{const f=fixture({fail:true});f.hook.run(f.event,f.store,'chat:archive',guid,123);assert.equal(f.store.data.chats[guid].archivedAt,123);assert.deepEqual(f.errors,['ARCHIVE_CAPTURE_PENDING'])});
test('failed local write never confirms; decorator always restored',()=>{const f=fixture({writeFail:true}),original=f.store._mutate;assert.throws(()=>f.hook.run(f.event,f.store,'chat:archive',guid,123),/WRITE_FAILED/);assert.deepEqual(f.calls.map(c=>c.mode),['begin']);assert.equal(f.store._mutate,original)});
test('watcher/remote-style store mutation does not sign',()=>{const f=fixture();f.store.archive(guid,12);assert.equal(f.calls.length,0)});

test('first archive creates metadata and signs only after verifying the local chat exists',()=>{
 const f=fixture({chatExists:id=>id===guid});
 delete f.store.data.chats[guid];
 f.store.archive=function(id,now){this._mutate(()=>{this.data.chats[id]={archivedAt:now}})};
 assert.equal(f.hook.run(f.event,f.store,'chat:archive',guid,123),true);
 assert.equal(f.store.data.chats[guid].archivedAt,123);
 assert.deepEqual(f.calls.map(call=>call.mode),['begin','confirm']);
});

test('mute and unmute capture only the mute field and preserve archive time',()=>{
 const f=fixture();
 f.store.data.chats[guid].archivedAt=456;
 f.store.mute=function(id,now){this._mutate(()=>{this.data.chats[id].mutedAt=now})};
 f.store.unmute=function(id){this._mutate(()=>{this.data.chats[id].mutedAt=null})};
 f.hook.run(f.event,f.store,'chat:mute',guid,123);
 f.hook.run(f.event,f.store,'chat:unmute',guid);
 assert.deepEqual(f.calls.filter(c=>c.mode==='begin').map(c=>[c.input.field,c.input.value]),[['mutedAt',123],['mutedAt',null]]);
 assert.equal(f.store.data.chats[guid].archivedAt,456);
});
