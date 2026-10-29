import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const cors={"Access-Control-Allow-Origin":"https://midnimoacademy.org","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json"};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:cors});
const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,"0")).join("");
const check=r=>{if(r.error)throw Error(r.error.message);return r.data};
const text="Welcome to Midnimo Academy!\n\nThank you for registering. Your free account gives you a place to access the academy's learning resources and student services.\n\nSign in: https://midnimoacademy.org/student.html\nStudent dashboard: https://midnimoacademy.org/dashboard.html\n\nTo access Blockchain Hub courses, sign in and complete the required learner details form: https://midnimoacademy.org/blockchain-hub.html\n\nIf you would like optional academy newsletters or personal progress summaries, choose your preferences here: https://midnimoacademy.org/email-preferences.html\n\nNeed help? Reply to this email or contact freemidnimoacademy@gmail.com.\n\nThe Midnimo Academy Team\nLearn. Understand. Grow.\n\nThis is a one-time welcome message because you registered for an academy account. It does not subscribe you to newsletters.";
const html="<div style='font:16px/1.7 Arial,sans-serif;max-width:640px;margin:auto;color:#172944'><h1 style='color:#071936'>Welcome to Midnimo Academy</h1>"+text.split("\n\n").slice(1).map(p=>"<p>"+p.replace(/\n/g,"<br>").replace(/https:\/\/midnimoacademy.org\/[a-z-]+\.html/g,url=>"<a href='"+url+"'>"+url+"</a>")+"</p>").join("")+"</div>";
Deno.serve(async req=>{
if(req.method==="OPTIONS")return new Response(null,{headers:cors});
if(req.method!=="POST")return reply({error:"POST required"},405);
try{
const bearer=(req.headers.get("Authorization")||"").replace(/^Bearer /i,"");
const db=createClient(Deno.env.get("SUPABASE_URL"),Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(12000)})}});
let allowed=false;
if(!allowed){const result=await db.auth.getUser(bearer);if(result.error||!result.data.user)return reply({error:"Administrator sign-in required."},401);const admin=check(await db.from("academy_admins").select("user_id").eq("user_id",result.data.user.id).maybeSingle());if(!admin)return reply({error:"Administrator access required."},403)}
const {action}=await req.json();
if(action==="summary"){const rows=check(await db.from("welcome_email_deliveries").select("status").limit(1000));return reply({counts:rows.reduce((counts,r)=>(counts[r.status]=(counts[r.status]||0)+1,counts),{})})}
if(action!=="process")return reply({error:"Unknown action"},400);
const key=Deno.env.get("BREVO_API_KEY");if(!key)return reply({error:"Brevo key missing."},503);
const rows=check(await db.from("welcome_email_deliveries").select("*").eq("status","pending").order("created_at").limit(1));
if(!rows.length)return reply({done:true});
const item=rows[0],claim=check(await db.from("welcome_email_deliveries").update({status:"sending",updated_at:new Date().toISOString()}).eq("id",item.id).eq("status","pending").select("id"));
if(!claim.length)return reply({done:false});
let attempted=false;
try{
const recipient=await db.auth.admin.getUserById(item.user_id);
if(recipient.error||recipient.data.user?.email?.toLowerCase()!==item.email){check(await db.from("welcome_email_deliveries").update({status:"skipped",error:"Account no longer matches registered address.",updated_at:new Date().toISOString()}).eq("id",item.id));return reply({done:false})}
attempted=true;
const response=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{"api-key":key,"Content-Type":"application/json"},body:JSON.stringify({sender:{email:"noreply@midnimoacademy.org",name:"Midnimo Academy"},replyTo:{email:"freemidnimoacademy@gmail.com",name:"Midnimo Academy"},to:[{email:item.email}],subject:"Welcome to Midnimo Academy",htmlContent:html,textContent:text,tags:["midnimo-welcome"],headers:{"IdempotencyKey":item.id}}),signal:AbortSignal.timeout(15000)});
const result=await response.json();
check(await db.from("welcome_email_deliveries").update({status:response.ok?"accepted":"failed",message_id:result.messageId||null,error:response.ok?null:"Brevo: "+(result.code||response.status),updated_at:new Date().toISOString()}).eq("id",item.id));
}catch{check(await db.from("welcome_email_deliveries").update({status:attempted?"unknown":"failed",error:attempted?"Provider result uncertain; check Brevo logs before retrying.":"Account verification failed.",updated_at:new Date().toISOString()}).eq("id",item.id))}
return reply({done:false});
}catch{return reply({error:"Welcome email operation failed."},500)}
});