import React, {useEffect,useState} from 'react';
const labels={queued:'Saved locally and queued. Waiting for cloud confirmation.',cloud_receipt_applied:'Cloud receipt confirms the choice. Other devices may still be syncing.',review_stale:'The cloud field changed. Review the conflict again.',local_confirmation_pending:'Local confirmation is incomplete. Review again before retrying.'};
export default function ArchiveConflictPanel(){
 const [open,setOpen]=useState(false),[data,setData]=useState(null),[review,setReview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const call=(mode,input)=>window.api.archiveConflicts(mode,input);
 const refresh=()=>call('conflicts',{}).then(setData);
 useEffect(()=>{if(!open)return;let live=true;const poll=()=>call('conflicts',{}).then(d=>{if(live)setData(d)}).catch(()=>{if(live)setError('Conflict review is unavailable. Check the enrolled archive helper configuration.')});poll();const id=setInterval(poll,10000);return()=>{live=false;clearInterval(id)}},[open]);
 async function inspect(c){setBusy(true);setError('');try{setReview(await call('review-conflict',{deviceId:c.deviceId,operationId:c.operationId}))}catch{setError('Could not read a current conflict. Refresh and try again.')}finally{setBusy(false)}}
 async function choose(choice){setBusy(true);setError('');try{const r=await call('resolve-conflict',{reviewId:review.reviewId,choice,currentRevision:review.currentRevision});setMessage(labels[r.status]??'Confirmation is pending.');setReview(null);await refresh()}catch{setError('The choice was not confirmed. Refresh and review again; a field may have changed.')}finally{setBusy(false)}}
 return <section style={{padding:12,borderTop:'1px solid #8884',maxHeight:420,overflow:'auto'}}><button type="button" onClick={()=>setOpen(!open)} aria-expanded={open}>Archive sync conflicts</button>{open&&<div>
 <p>Choose which archive or mute value to keep. This changes only local inbox metadata and queues signed synchronization. It never marks a Slack message read.</p>
 {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 <button type="button" disabled={busy} onClick={()=>{setReview(null);setError('');refresh().catch(()=>setError('Refresh failed.'))}}>Refresh conflicts</button>
 {data?.attempts?.map(a=><p key={a.reviewId} role="status">{labels[a.status]??'Confirmation is pending.'}</p>)}
 {data?.conflicts?.length===0&&<p>No unresolved conflicts in the current cloud response.</p>}
 {data?.conflicts?.map(c=><div key={c.deviceId+':'+c.operationId} style={{padding:'8px 0',overflowWrap:'anywhere'}}><strong>{c.nativeId}</strong><div>{c.field} · cloud revision {c.currentRevision}</div><button type="button" disabled={busy} onClick={()=>inspect(c)}>Review these values</button></div>)}
 {data?.hasMore&&<p>Showing the first conflicts. Resolve these and refresh for more.</p>}
 {review&&<div role="group" aria-label="Choose archive conflict value" style={{border:'1px solid #8888',padding:10,overflowWrap:'anywhere'}}><strong>{review.nativeId}</strong><p>{review.field} · reviewed cloud revision {review.currentRevision}</p><p>Proposed value: {JSON.stringify(review.proposedValue)}</p><p>Current cloud value: {review.currentPresent?JSON.stringify(review.currentValue):'No field value'}</p><button type="button" disabled={busy} onClick={()=>choose('proposed')}>Use proposed value</button>{' '}<button type="button" disabled={busy} onClick={()=>choose('current')}>Keep current cloud value</button>{' '}<button type="button" disabled={busy} onClick={()=>setReview(null)}>Cancel</button></div>}
 </div>}</section>;
}
