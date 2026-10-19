import { random, digest, seal, unseal } from './security.mjs';
const scope = 'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly';
const assets = new Set(['/about.html','/privacy.html','/embed.html','/embed.css','/embed.mjs','/cloud-embed.mjs','/fonts/Figtree-Variable.woff2','/fonts/Cabin-Variable.woff2']);
const routes = new Set(['/','/login','/connect','/callback','/disconnect','/cloud-reading']);
const cookie = (name, value, seconds, sameSite='Strict') => `${name}=${value}; HttpOnly; Secure; SameSite=${sameSite}; Path=/; Max-Age=${seconds}`;
function cookies(request) { return Object.fromEntries((request.headers.get('Cookie')||'').split(';').map(x=>x.trim().split('='))); }
function response(body, status=200, type='text/plain', extra={}) {
  return new Response(body,{status,headers:{'Content-Type':`${type}; charset=utf-8`,'Cache-Control':'no-store','Referrer-Policy':'same-origin','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'; base-uri 'none'",...extra}});
}
const redirect = (url, extra={}) => response('',303,'text/plain',{Location:url,...extra});
function page(authorized, connected) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pulse connection</title><style>body{font:16px system-ui;background:#f3efff;color:#1d1830;max-width:32rem;margin:12vh auto;padding:24px}h1{font-weight:500}p{line-height:1.6;color:#655d78}button,input{font:inherit;padding:12px;border:1px solid #655d78;border-radius:6px}button{cursor:pointer;background:#1d1830;color:#f3efff}input{max-width:90%;margin:0 0 16px}a{color:inherit}</style><h1>pulse</h1>${!authorized ? '<p>Enter your private owner key to manage this feed.</p><form method="post" action="/login"><input name="key" type="password" autocomplete="current-password" required aria-label="Owner key"><br><button>unlock</button></form>' : `<p>${connected?'Google is connected. Your latest measured heart rate is shared publicly.':'Connect Google Health to publish your latest measured heart rate and its age.'}</p><form method="post" action="/connect"><button>${connected?'reconnect Google Health':'connect Google Health'}</button></form>${connected?'<p><a href="/embed.html?feed=FEED&source=cloud">preview widget</a></p><form method="post" action="/disconnect"><button>stop sharing &amp; disconnect</button></form>':''}<p>This is the latest synced measurement, not a live stream. Google apps in Testing require reconnecting after seven days.</p>`}</html>`;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (assets.has(url.pathname) && ['GET','HEAD'].includes(request.method)) {
      const result = await env.ASSETS.fetch(request);
      const headers = new Headers(result.headers);
      headers.set('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors *");
      headers.set('Referrer-Policy','no-referrer');
      headers.set('X-Content-Type-Options','nosniff');
      return new Response(result.body,{status:result.status,headers});
    }
    if (!routes.has(url.pathname)) return response('Not found',404);
    if (!env.ADMIN_KEY || !env.TOKEN_KEY || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return response('Connection setup is not complete.',503);
    return env.ACCOUNT.get(env.ACCOUNT.idFromName('owner')).fetch(request);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(env.ACCOUNT.get(env.ACCOUNT.idFromName('owner')).fetch('https://internal/_poll'));
  }
};
export class PulseAccount {
  constructor(ctx, env) { this.storage=ctx.storage; this.env=env; this.queue=Promise.resolve(); }
  fetch(request) {
    if(request.method==='GET' && new URL(request.url).pathname==='/cloud-reading') return this.handle(request);
    // All account mutations and refreshes are serialized, including across network awaits.
    const result=this.queue.then(()=>this.handle(request));
    this.queue=result.catch(()=>{});
    return result.catch(()=>response('Unable to complete this request. Please try again.',502));
  }
  async authorized(request) {
    const token=cookies(request).pulse_session;
    const session=await this.storage.get('session');
    return Boolean(token && session && session.expires>Date.now() && await digest(token)===session.hash);
  }
  async handle(request) {
    const url=new URL(request.url), path=url.pathname;
    if (path==='/_poll') { await this.poll(); return response(null,204); }
    if (request.method==='GET' && path==='/cloud-reading') {
      if(url.searchParams.get('feed')!==this.env.FEED) return response('Not found',404);
      const account=await this.storage.get('account'), now=Date.now();
      const latest=account?.tokens && account.latest;
      const valid=latest && Number.isInteger(latest.bpm) && latest.bpm>=1 && latest.bpm<=300 && Number.isFinite(latest.measuredAt) && latest.measuredAt>0 && latest.measuredAt<=now;
      return response(JSON.stringify({status:!valid?'waiting':account.error || !account.checkedAt || now-account.checkedAt>120000?'paused':'latest',reading:valid?{bpm:latest.bpm,measuredAt:latest.measuredAt}:null,serverTime:now}),200,'application/json');
    }
    if(request.method==='GET' && path==='/') return response(page(await this.authorized(request),Boolean((await this.storage.get('account'))?.tokens)).replace('feed=FEED',`feed=${encodeURIComponent(this.env.FEED)}`),200,'text/html');
    if(request.method==='POST') {
      if(request.headers.get('Origin')!==url.origin) return response('Invalid origin',403);
      if(path==='/login') {
        if(Number(request.headers.get('Content-Length'))>4096) return response('Request too large',413);
        const form=await request.formData();
        if(typeof form.get('key')!=='string' || await digest(form.get('key'))!==await digest(this.env.ADMIN_KEY)) return response('Invalid owner key',403);
        const token=random();
        await this.storage.put('session',{hash:await digest(token),expires:Date.now()+86400000});
        return redirect('/',{'Set-Cookie':cookie('pulse_session',token,86400)});
      }
      if(!await this.authorized(request)) return response('Owner sign-in required',403);
      if(path==='/connect') {
        const pending={state:random(),verifier:random(),browser:random(),expires:Date.now()+600000,origin:url.origin};
        await this.storage.put('pending',pending);
        const auth=new URL('https://accounts.google.com/o/oauth2/v2/auth');
        auth.search=new URLSearchParams({client_id:this.env.GOOGLE_CLIENT_ID,redirect_uri:url.origin+'/callback',response_type:'code',scope,state:pending.state,access_type:'offline',prompt:'consent',code_challenge:await digest(pending.verifier),code_challenge_method:'S256'}).toString();
        return redirect(auth.href,{'Set-Cookie':cookie('pulse_auth',pending.browser,600,'Lax')});
      }
      if(path==='/disconnect') {
        await this.storage.delete('account'); await this.storage.delete('pending');
        return redirect('/');
      }
    }
    if(request.method==='GET' && path==='/callback') {
      const pending=await this.storage.get('pending');
      if(!pending || pending.expires<Date.now() || pending.origin!==url.origin || pending.browser!==cookies(request).pulse_auth || pending.state!==url.searchParams.get('state')) return response('Expired or invalid sign-in. Return to Pulse and reconnect.',403);
      await this.storage.delete('pending');
      if(!url.searchParams.get('code')) return response('Permission was not granted. Return to Pulse to retry.',400);
      const tokens=await this.tokenRequest({grant_type:'authorization_code',code:url.searchParams.get('code'),code_verifier:pending.verifier,redirect_uri:pending.origin+'/callback'});
      if(!tokens.refresh_token) return response('Google did not grant background access. Please reconnect.',400);
      await this.google('https://health.googleapis.com/v4/users/me/identity',{headers:{Authorization:`Bearer ${tokens.access_token}`}});
      await this.storage.put('account',{tokens:await seal(tokens,this.env.TOKEN_KEY),latest:null,checkedAt:null,error:false});
      await this.poll();
      return redirect('/',{'Set-Cookie':cookie('pulse_auth','',0,'Lax')});
    }
    return response('Not found',404);
  }
  async google(url,options={}) {
    const res=await fetch(url,{...options,signal:AbortSignal.timeout(15000)});
    if(!res.ok) throw new Error('Google unavailable');
    return res.json();
  }
  async tokenRequest(fields) {
    const data=await this.google('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:this.env.GOOGLE_CLIENT_ID,client_secret:this.env.GOOGLE_CLIENT_SECRET,...fields})});
    if(!data.access_token || !Number.isFinite(Number(data.expires_in))) throw new Error('Invalid token response');
    return {...data,expiresAt:Date.now()+Number(data.expires_in)*1000};
  }
  async poll() {
    const account=await this.storage.get('account');
    if(!account?.tokens || account.nextCheck>Date.now()) return;
    try {
      let tokens=await unseal(account.tokens,this.env.TOKEN_KEY);
      if(tokens.expiresAt<Date.now()+60000) {
        tokens={...tokens,...await this.tokenRequest({grant_type:'refresh_token',refresh_token:tokens.refresh_token})};
        account.tokens=await seal(tokens,this.env.TOKEN_KEY);
      }
      const now=Date.now();
      const url=new URL('https://health.googleapis.com/v4/users/me/dataTypes/heart-rate/dataPoints');
      url.searchParams.set('dataSourceFamily','users/me/dataSourceFamilies/all-sources');
      url.searchParams.set('pageSize','10000');
      url.searchParams.set('filter',`heart_rate.sample_time.physical_time >= "${new Date(now-86400000).toISOString()}" AND heart_rate.sample_time.physical_time < "${new Date(now).toISOString()}"`);
      let newest=account.latest, pages=0;
      do {
        const data=await this.google(url,{headers:{Authorization:`Bearer ${tokens.access_token}`}});
        for(const point of data.dataPoints||[]) {
          const bpm=Number(point.heartRate?.beatsPerMinute),measuredAt=Date.parse(point.heartRate?.sampleTime?.physicalTime);
          if(Number.isInteger(bpm)&&bpm>=1&&bpm<=300&&Number.isFinite(measuredAt)&&measuredAt>0&&measuredAt<=now&&(!newest||measuredAt>newest.measuredAt)) newest={bpm,measuredAt};
        }
        url.searchParams.set('pageToken',data.nextPageToken||'');
        if(++pages>=6 && data.nextPageToken) throw new Error('Incomplete response');
      } while(url.searchParams.get('pageToken'));
      Object.assign(account,{latest:newest||null,checkedAt:Date.now(),error:false,failures:0,nextCheck:0});
    } catch {
      const failures=Math.min((account.failures||0)+1,8);
      Object.assign(account,{error:true,failures,nextCheck:Date.now()+Math.min(3600000,60000*2**(failures-1))});
    }
    await this.storage.put('account',account);
  }
}
