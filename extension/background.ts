import {validateFields} from '../src/privacy';
import type {Profile,Snapshot} from '../src/types';
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(()=>{});
type Pending={id:string;tabId:number;origin:string;documentId:string;expires:number;values:{handle:string;key:string;type:string;value:string}[]};
async function active(){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id||!tab.url||!/^https?:/.test(tab.url))throw new Error('Open a regular website and click the ORVIA toolbar icon to grant access. Chrome internal pages are protected.');return tab as chrome.tabs.Tab&{id:number;url:string};}
async function observe(tabId:number){await chrome.scripting.executeScript({target:{tabId},files:['content.js']});const r=await chrome.tabs.sendMessage(tabId,{type:'CONTENT_OBSERVE'});if(!r.ok)throw new Error(r.error);return r.data as Snapshot;}
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
 if(sender.id!==chrome.runtime.id||sender.tab||sender.url!==chrome.runtime.getURL('sidepanel.html'))return;
 (async()=>{
  if(msg.type==='OBSERVE'){const tab=await active();return observe(tab.id);}
  if(msg.type==='PREPARE'){
   const tab=await active();const snapshot=await observe(tab.id);const profile=msg.profile as Record<string,any>;
   const values=snapshot.fields
     .filter(f => profile[f.key] !== undefined && profile[f.key] !== '' && profile[f.key] !== false)
     .map(f => {
       const val = profile[f.key];
       const strVal = Array.isArray(val) ? val.join(', ') : typeof val === 'boolean' ? (val ? 'Yes' : 'No') : String(val);
       return { ...f, value: strVal };
     });
   validateFields(values);
   const pending:Pending={id:crypto.randomUUID(),tabId:tab.id,origin:new URL(tab.url).origin,documentId:snapshot.documentId,expires:Date.now()+120000,values};
   await chrome.storage.session.set({pending});return {id:pending.id,origin:pending.origin,fields:values.map(({key})=>key)};
  }
  if(msg.type==='EXECUTE'){
   const {pending}=await chrome.storage.session.get('pending') as {pending?:Pending};await chrome.storage.session.remove('pending');
   if(!pending||pending.id!==msg.id||pending.expires<Date.now())throw new Error('Approval expired. Start a new run.');
   const tab=await active();if(tab.id!==pending.tabId||new URL(tab.url).origin!==pending.origin)throw new Error('Active page changed. Start a new run.');
   validateFields(pending.values);const r=await chrome.tabs.sendMessage(tab.id,{type:'CONTENT_FILL',...pending});if(!r.ok)throw new Error(r.error);return r.data;
  }
  if(msg.type==='CANCEL'){await chrome.storage.session.remove('pending');return {cancelled:true};}
  throw new Error('Unsupported command.');
 })().then(data=>respond({ok:true,data})).catch(e=>respond({ok:false,error:e.message||'Extension action failed.'}));return true;
});
