import {protect} from './privacy';
import type {Snapshot} from './types';
export function demoSnapshot():Snapshot{
 const raw='Meridian Research Fellowship\nBuild what comes next.\nA paid 12-week research internship for ambitious undergraduate students.\nStipend: INR 25,000 per month.\nLocation: Bengaluru / Hybrid.\nApplications close 30 November 2026.\nEligibility: undergraduate students in computer science, design or related disciplines.\nWork alongside our research team on responsible AI, human-computer interaction and tools that help people do more.\nSelection: application review, portfolio discussion, team conversation.\nContact: fellowships@example.com\nPhone: +91 80000 00000';
 const clean=protect(raw);
 return {title:'Meridian Research Fellowship',origin:'https://meridian.example',text:clean.text,headings:['Meridian Research Fellowship','About the fellowship','Your application'],fields:[{handle:'name',label:'Full name',type:'text',key:'name'},{handle:'email',label:'Email address',type:'email',key:'email'},{handle:'phone',label:'Phone number',type:'tel',key:'phone'},{handle:'university',label:'University',type:'text',key:'university'}],findings:clean.findings,blocked:1,documentId:'demo-document',observedAt:Date.now()};
}
export async function extensionMessage<T>(type:string,extra:Record<string,unknown>={}):Promise<T>{const result=await chrome.runtime.sendMessage({type,...extra});if(!result?.ok)throw new Error(result?.error||'Unable to reach ORVIA. Reload the extension.');return result.data;}
