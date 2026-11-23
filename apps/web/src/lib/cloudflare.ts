export type CfOperation='verify'|'list'|'getSubdomain'|'setSubdomain'|'getSettings'|'setSecret';
export type CfReply={success?:boolean;result?:unknown;errors?:{code?:number;message?:string}[]};
export async function cloudflareRequest(params:{workerUrl:string;adminToken:string;apiToken:string;accountId:string;operation:CfOperation;scriptName?:string;enabled?:boolean;secretName?:'PROXY_TOKEN'|'ADMIN_TOKEN';secretValue?:string}):Promise<CfReply>{
  const base=new URL(params.workerUrl);
  if(base.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(base.hostname))throw Error('HTTPS required for Cloudflare management');
  const endpoint=new URL('/admin/cloudflare',base);
  const response=await fetch(endpoint,{method:'POST',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000),
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${params.apiToken}`,'X-YouTV-Admin-Token':params.adminToken},
    body:JSON.stringify({operation:params.operation,accountId:params.accountId,scriptName:params.scriptName,enabled:params.enabled,secretName:params.secretName,secretValue:params.secretValue})});
  const data=await response.json() as CfReply;
  if(!response.ok||data.success===false)throw Error(data.errors?.map(e=>e.message).join('; ')||`Cloudflare HTTP ${response.status}`);
  return data;
}
export type CfScript={id:string};
export function parseCfScripts(reply:CfReply):CfScript[]{
  if(!Array.isArray(reply.result))return [];
  return reply.result.filter((v):v is CfScript=>Boolean(v)&&typeof v==='object'&&typeof v.id==='string');
}
