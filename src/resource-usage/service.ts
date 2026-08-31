import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ResourceUsage, ResourceUsageResponse } from '../types.ts'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const DATA_ROOT = resolve(process.env.LAB_RESOURCE_USAGE_DATA_DIR ?? join(MODULE_DIR, '..', 'data', 'resource-usage'))
const USAGE_FILE = join(DATA_ROOT, 'active.json')
const AUDIT_FILE = join(DATA_ROOT, 'audit.jsonl')
const MAX_PURPOSE_LENGTH = 160

interface UsageStore { version: 1; usages: ResourceUsage[] }
interface UsageAudit { id:string; action:'start'|'stop'; actor:string; usage:ResourceUsage; at:number }
let operationQueue: Promise<void> = Promise.resolve()

const normalizePurpose=(value:string|undefined):string|undefined=>{const clean=value?.replace(/[\r\n\0]+/g,' ').trim().slice(0,MAX_PURPOSE_LENGTH);return clean||undefined}
const validateResource=(switchId:string,portName?:string):void=>{if(!/^sw[1-9][0-9]*$/i.test(switchId))throw new Error('invalid switch id');if(portName!==undefined&&!/^Ethernet(?:[0-9]|[12][0-9]|3[01])$/.test(portName))throw new Error('invalid physical port')}
const readStore=async():Promise<UsageStore>=>{try{const parsed=JSON.parse(await readFile(USAGE_FILE,'utf8')) as Partial<UsageStore>;return{version:1,usages:Array.isArray(parsed.usages)?parsed.usages:[]}}catch{return{version:1,usages:[]}}}
const writeStore=async(store:UsageStore):Promise<void>=>{await mkdir(DATA_ROOT,{recursive:true});const temporary=USAGE_FILE+'.tmp-'+process.pid+'-'+Date.now();await writeFile(temporary,JSON.stringify(store,null,2),'utf8');await rename(temporary,USAGE_FILE)}
const audit=async(event:UsageAudit):Promise<void>=>{await mkdir(DATA_ROOT,{recursive:true});await appendFile(AUDIT_FILE,JSON.stringify(event)+'\n','utf8')}
const exclusive=async<T>(work:()=>Promise<T>):Promise<T>=>{let release:()=>void=()=>undefined;const previous=operationQueue;operationQueue=new Promise<void>((resolve)=>{release=resolve});await previous;try{return await work()}finally{release()}}

export async function listResourceUsage():Promise<ResourceUsageResponse>{const store=await readStore();return{fetchedAt:Date.now(),mode:'shared',usages:store.usages.sort((a,b)=>a.switchId.localeCompare(b.switchId)||String(a.portName??'').localeCompare(String(b.portName??''))||a.startedAt-b.startedAt)}}

export async function startResourceUsage(username:string,input:{switchId:string;portName?:string;purpose?:string}):Promise<ResourceUsageResponse>{return await exclusive(async()=>{const switchId=input.switchId.trim().toLowerCase();const portName=input.portName?.trim();validateResource(switchId,portName);const store=await readStore();const existing=store.usages.find((item)=>item.username===username&&item.switchId===switchId&&item.portName===portName);if(existing!==undefined){existing.purpose=normalizePurpose(input.purpose)??existing.purpose;existing.updatedAt=Date.now();await writeStore(store);return{fetchedAt:Date.now(),mode:'shared',usages:store.usages}}const now=Date.now();const usage:ResourceUsage={id:'usage_'+randomUUID(),username,switchId,portName,purpose:normalizePurpose(input.purpose),startedAt:now,updatedAt:now};store.usages.push(usage);await writeStore(store);await audit({id:randomUUID(),action:'start',actor:username,usage,at:now});return{fetchedAt:Date.now(),mode:'shared',usages:store.usages}})}

export async function stopResourceUsage(username:string,id:string):Promise<ResourceUsageResponse>{return await exclusive(async()=>{if(!/^usage_[a-f0-9-]+$/.test(id))throw new Error('invalid usage id');const store=await readStore();const index=store.usages.findIndex((item)=>item.id===id);if(index<0)throw new Error('usage not found');const usage=store.usages[index];if(usage===undefined||usage.username!==username)throw new Error('only the current user can end this usage');store.usages.splice(index,1);await writeStore(store);await audit({id:randomUUID(),action:'stop',actor:username,usage,at:Date.now()});return{fetchedAt:Date.now(),mode:'shared',usages:store.usages}})}
