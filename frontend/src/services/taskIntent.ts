import {createTaskRequest,object} from '../types/validation';
import type {CreateTaskRequest} from '../types/api';
const STORAGE_KEY='testpilot-task-intent-v1';
export interface TaskIntent {key:string;body:CreateTaskRequest}
let memory:TaskIntent|null=null;
// Only supported task fields are stored, never tested-request headers or bodies.
export function readTaskIntent():TaskIntent|null {
  try{const raw=sessionStorage.getItem(STORAGE_KEY);if(raw){const o=object(JSON.parse(raw));if(typeof o.key==='string'&&/^[\w-]{1,100}$/.test(o.key))return {key:o.key,body:createTaskRequest(o.body)};}}catch{/* Invalid session state is ignored. */}
  return memory;
}
export function saveTaskIntent(intent:TaskIntent){memory=intent;try{sessionStorage.setItem(STORAGE_KEY,JSON.stringify(intent));}catch{/* Session memory remains available. */}}
export function clearTaskIntent(key:string){if(readTaskIntent()?.key!==key)return;memory=null;try{sessionStorage.removeItem(STORAGE_KEY);}catch{/* No diagnostics include the stored body. */}}
