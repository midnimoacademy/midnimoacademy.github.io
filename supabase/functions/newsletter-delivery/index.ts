import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const cors={"Access-Control-Allow-Origin":"https://midnimoacademy.org","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json"};
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:cors});
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,"0")).join("");
function checked(result){if(result.error)throw Error(result.error.message);return result.data}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{headers:cors});
 if(req.method!=="POST")return reply({error:"POST required"},405);
 try{
 const token=(req.headers.get("Authorization")||"").replace(/^Bearer /i,"");
 const db=createClient(Deno.env.get("SUPABASE_URL"),Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(12000)})}});
 const {data:{user},error}=await db.auth.getUser(token);
 if(error||!user)return reply({error:"Administrator sign-in required."},401);
 const admin=checked(await db.from("academy_admins").select("user_id").eq("user_id",user.id).maybeSingle());
 if(!admin)return reply({error:"Administrator access required."},403);
 const input=await req.json();
 const getPrefs=async kind=>checked(await db.from("newsletter_preferences").select("user_id").eq(kind==="progress"?"progress_emails":"academy_updates",true).limit(1001));
 if(input.action==="summary"){
 const prefs=checked(await db.from("newsletter_preferences").select("academy_updates,progress_emails").limit(1001));
 const runs=checked(await db.from("newsletter_runs").select("*").order("created_at",{ascending:false}).limit(20));
 const deliveries=runs.length?checked(await db.from("newsletter_deliveries").select("run_id,status,message_id,error,updated_at").in("run_id",runs.map(r=>r.id)).limit(10000)):[];
 return reply({subscribers:prefs.filter(p=>p.academy_updates).length,progressSubscribers:prefs.filter(p=>p.progress_emails).length,runs:runs.map(r=>({...r,deliveries:deliveries.filter(d=>d.run_id===r.id)}))});
 }
 if(input.action==="start"){
 const kind=input.kind==="progress"?"progress":"newsletter";
 const recipients=await getPrefs(kind);
 if(!recipients.length)return reply({error:"No students have opted in to this email type yet."},400);
 if(recipients.length>1000)return reply({error:"Audience exceeds the supported limit. Contact the academy developer."},400);
 let subject,body,key;
 if(kind==="newsletter"){
 const draft=checked(await db.from("newsletter_drafts").select("id,subject,body").eq("id",String(input.draftId)).single());
 subject=draft.subject;body=draft.body;key="draft:"+draft.id;
 }else{subject="Your Midnimo Academy learning progress";body="";key="progress:"+new Date().toISOString().slice(0,10);}
 if(!subject.trim()||subject.length>160||body.length>20000)return reply({error:"Use a subject up to 160 characters and a message up to 20,000 characters."},400);
 let run=checked(await db.from("newsletter_runs").select("*").eq("run_key",key).maybeSingle());
 if(!run){
 const result=await db.from("newsletter_runs").insert({run_key:key,kind,subject,body,created_by:user.id}).select("*").single();
 if(result.error?.code==="23505")run=checked(await db.from("newsletter_runs").select("*").eq("run_key",key).single());else run=checked(result);
 }
 // Repeated start requests repair an interrupted queue without resetting any existing delivery.
 checked(await db.from("newsletter_deliveries").upsert(recipients.map(r=>({run_id:run.id,user_id:r.user_id})),{onConflict:"run_id,user_id",ignoreDuplicates:true}));
 return reply({runId:run.id,message:"Email queue ready."});
 }
 if(input.action!=="process")return reply({error:"Unknown action."},400);
 const key=Deno.env.get("BREVO_API_KEY");
 if(!key)return reply({error:"Brevo API key is missing."},503);
 const run=checked(await db.from("newsletter_runs").select("*").eq("id",input.runId).single());
 // One recipient per request keeps the operation within a short request timeout.
 const pending=checked(await db.from("newsletter_deliveries").select("*").eq("run_id",run.id).eq("status","pending").order("id").limit(1));
 if(!pending.length)return reply({done:true,message:"Queue processed. Review accepted, failed and uncertain records."});
 const item=pending[0];
 const claimed=checked(await db.from("newsletter_deliveries").update({status:"sending",updated_at:new Date().toISOString()}).eq("id",item.id).eq("status","pending").select("id"));
 if(!claimed.length)return reply({done:false});
 let attempted=false;
 try{
 const pref=checked(await db.from("newsletter_preferences").select("academy_updates,progress_emails").eq("user_id",item.user_id).maybeSingle());
 if(!pref?.[run.kind==="progress"?"progress_emails":"academy_updates"]){
 checked(await db.from("newsletter_deliveries").update({status:"skipped",error:"Student unsubscribed before sending.",updated_at:new Date().toISOString()}).eq("id",item.id));
 return reply({done:false});
 }
 const recipient=await db.auth.admin.getUserById(item.user_id);
 if(recipient.error||!recipient.data.user?.email_confirmed_at)throw Error("No verified student email address.");
 let message=run.body;
 if(run.kind==="progress"){
 const lessons=checked(await db.from("lesson_progress").select("course_slug,lesson_number").eq("user_id",item.user_id).limit(10000));
 const counts={};for(const lesson of lessons)counts[lesson.course_slug]=(counts[lesson.course_slug]||0)+1;
 message=lessons.length?"Your recorded completed lessons:\n"+Object.entries(counts).map(([course,count])=>course+": "+count+" completed lesson(s)").join("\n")+"\n\nContinue your learning in your dashboard: https://midnimoacademy.org/my-learning.html":"You have no completed lessons recorded yet. Start learning here: https://midnimoacademy.org/my-learning.html";
 }
 const unsubscribeToken=crypto.randomUUID()+crypto.randomUUID();
 checked(await db.from("newsletter_unsubscribe_tokens").insert({token_hash:await hash(unsubscribeToken),user_id:item.user_id}));
 const unsubscribe="https://midnimoacademy.org/unsubscribe.html#"+unsubscribeToken;
 const html="<h1>Midnimo Academy</h1><h2>"+esc(run.subject)+"</h2><p>"+esc(message).replace(/\n/g,"<br>")+"</p><hr><p>You opted in to these emails. <a href='"+unsubscribe+"'>Unsubscribe from optional academy emails</a> | <a href='https://midnimoacademy.org/email-preferences.html'>Email preferences</a></p>";
 attempted=true;
 const response=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{"api-key":key,"Content-Type":"application/json"},body:JSON.stringify({sender:{email:"noreply@midnimoacademy.org",name:"Midnimo Academy"},replyTo:{email:"freemidnimoacademy@gmail.com",name:"Midnimo Academy"},to:[{email:recipient.data.user.email}],subject:run.subject,htmlContent:html,textContent:message+"\n\nUnsubscribe: "+unsubscribe,tags:["midnimo-"+run.kind],headers:{"IdempotencyKey":item.id}}),signal:AbortSignal.timeout(15000)});
 const result=await response.json();
 checked(await db.from("newsletter_deliveries").update({status:response.ok?"accepted":"failed",message_id:result.messageId||null,error:response.ok?null:"Brevo: "+(result.code||response.status),updated_at:new Date().toISOString()}).eq("id",item.id));
 }catch(error){
 // Never automatically retry an uncertain send: Brevo may already have accepted it.
 checked(await db.from("newsletter_deliveries").update({status:attempted?"unknown":"failed",error:attempted?"Sending result uncertain; check Brevo logs before any retry.":String(error.message).slice(0,200),updated_at:new Date().toISOString()}).eq("id",item.id));
 }
 return reply({done:false});
 }catch(error){console.error("newsletter operation failed",error.message);return reply({error:"Newsletter operation failed. Check function logs. No automatic retry was attempted."},500);}
});
