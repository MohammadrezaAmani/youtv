import {allowedOrigin, ProxyError, type ProxyEnv} from './security.ts';

type AdminEnv=ProxyEnv & {ADMIN_TOKEN?:string};
type Operation='verify'|'list'|'getSubdomain'|'setSubdomain'|'getSettings'|'setSecret';
type Body={operation:Operation;accountId?:string;scriptName?:string;enabled?:boolean;secretName?:string;secretValue?:string};
function validateName(value:string|undefined){if(!value||!/^[a-zA-Z0-9_-]{1,64}$/.test(value))throw new ProxyError(400,'invalid_script','Invalid Worker script name');return value;}
function validateAccount(value:string|undefined){if(!value||!/^[a-f0-9]{32}$/i.test(value))throw new ProxyError(400,'invalid_account','Account ID must be a 32-character hexadecimal ID');return value;}
function equalsToken(a:string,b:string){let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0;}

/** Narrow, authenticated Cloudflare API bridge. No generic URL, method or body passthrough. */
export async function cloudflareAdmin(request:Request,env:AdminEnv):Promise<Response>{
  const origin=request.headers.get('Origin');
  // Admin operations require a concrete browser origin; wildcard is explicitly forbidden.
  if(!origin||!allowedOrigin(request,env)||(env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).includes('*'))
    throw new ProxyError(403,'admin_origin','Configure an explicit ALLOWED_ORIGINS for the admin interface');
  const adminSecret=env.ADMIN_TOKEN||'';
  const candidate=request.headers.get('X-YouTV-Admin-Token')||'';
  if(adminSecret.length<32||!equalsToken(candidate,adminSecret)||equalsToken(adminSecret,env.PROXY_TOKEN||''))
    throw new ProxyError(401,'admin_unauthorized','Admin authorization failed');
  const cfToken=request.headers.get('Authorization')?.match(/^Bearer\s+([\w.-]{20,})$/)?.[1];
  if(!cfToken)throw new ProxyError(401,'cloudflare_token_missing','A scoped Cloudflare API Token is required');
  const length=Number(request.headers.get('content-length')||'0');
  if(length>4000)throw new ProxyError(413,'admin_request_too_large','Admin request too large');
  let body:Body;
  try{
    const data=await request.text();
    if(data.length>4000)throw new ProxyError(413,'admin_request_too_large','Admin request too large');
    body=JSON.parse(data) as Body;
    if(!body||typeof body!=='object')throw Error('Body must be an object');
  }catch(error){
    if(error instanceof ProxyError)throw error;
    throw new ProxyError(400,'invalid_json','Invalid admin JSON');
  }
  const {operation}=body;
  let path:string, method:'GET'|'POST'|'PUT'='GET', data:object|undefined;
  if(operation==='verify'){path='/user/tokens/verify';}
  else{
    const account=validateAccount(body.accountId);
    const root=`/accounts/${account}/workers/scripts`;
    switch(operation){
      case 'list':path=root;break;
      case 'getSubdomain':path=`${root}/${encodeURIComponent(validateName(body.scriptName))}/subdomain`;break;
      case 'getSettings':path=`${root}/${encodeURIComponent(validateName(body.scriptName))}/settings`;break;
      case 'setSecret':{
        if(body.secretName!=='PROXY_TOKEN'&&body.secretName!=='ADMIN_TOKEN')throw new ProxyError(400,'invalid_secret_name','Only YouTV PROXY_TOKEN and ADMIN_TOKEN can be changed');
        const min=body.secretName==='ADMIN_TOKEN'?32:24;
        if(typeof body.secretValue!=='string'||body.secretValue.length<min||body.secretValue.length>256)throw new ProxyError(400,'invalid_secret_value',`Secret must be ${min}-256 characters`);
        if(equalsToken(body.secretValue,env.ADMIN_TOKEN||'')&&body.secretName==='PROXY_TOKEN')throw new ProxyError(400,'same_secret','PROXY_TOKEN must be different from ADMIN_TOKEN');
        if(equalsToken(body.secretValue,env.PROXY_TOKEN||'')&&body.secretName==='ADMIN_TOKEN')throw new ProxyError(400,'same_secret','ADMIN_TOKEN must be different from PROXY_TOKEN');
        path=`${root}/${encodeURIComponent(validateName(body.scriptName))}/secrets`;
        method='PUT';data={name:body.secretName,type:'secret_text',text:body.secretValue};break;
      }
      case 'setSubdomain':
        if(typeof body.enabled!=='boolean')throw new ProxyError(400,'invalid_enabled','enabled must be boolean');
        path=`${root}/${encodeURIComponent(validateName(body.scriptName))}/subdomain`;
        method='POST';data={enabled:body.enabled};break;
      default:throw new ProxyError(400,'invalid_operation','Operation not allowed');
    }
  }
  const timeout=AbortSignal.timeout(12000);
  let response:Response;
  try{
    response=await fetch('https://api.cloudflare.com/client/v4'+path,{method,headers:{Authorization:`Bearer ${cfToken}`,Accept:'application/json',...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined,signal:timeout,redirect:'error'});
  }catch{throw new ProxyError(502,'cloudflare_unreachable','Cloudflare API could not be reached');}
  // Bound response; never return request headers or tokens.
  const responseText=(await response.text()).slice(0,600_000);
  let result:unknown;
  try{result=JSON.parse(responseText);}catch{throw new ProxyError(502,'cloudflare_invalid_response','Unexpected Cloudflare API response');}
  const headers=new Headers({'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');
  // Strip a secret text if the upstream echoes it, including errors.
  if(operation==='setSecret'){
    const serialized=JSON.stringify(result);
    result=JSON.parse(serialized.replaceAll(body.secretValue||'', '[REDACTED]')) as unknown;
  }
  return new Response(JSON.stringify(result),{status:response.ok?200:response.status,headers});
}
