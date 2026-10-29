import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const headers = {"Access-Control-Allow-Origin":"https://midnimoacademy.org","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{headers});
 if(req.method!=="POST")return reply({error:"POST required"},405);
 try {
 const token=(req.headers.get("Authorization")||"").replace(/^Bearer /i,"");
 if(!token)return reply({error:"Sign in as an administrator."},401);
 const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:"Bearer "+token}},auth:{persistSession:false}});
 const {data:{user},error}=await db.auth.getUser(token);
 if(error||!user?.email)return reply({error:"Sign in as an administrator."},401);
 const {data:admin,error:adminError}=await db.from("academy_admins").select("user_id").eq("user_id",user.id).maybeSingle();
 if(adminError||!admin)return reply({error:"Administrator access required."},403);
 const key=Deno.env.get("BREVO_API_KEY");
 if(!key)return reply({error:"BREVO_API_KEY is missing from Secrets."},503);
 const payload=await req.json();
 if(payload.action!=="test")return reply({error:"Only administrator test emails are enabled."},400);
 const res=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{"api-key":key,"Content-Type":"application/json"},body:JSON.stringify({sender:{email:"freemidnimoacademy@gmail.com",name:"Midnimo Academy"},to:[{email:user.email}],subject:"Midnimo Academy email connection test",htmlContent:"<h1>Midnimo Academy</h1><p>Your Brevo email connection is working.</p><p>This is an administrator test. No student emails have been sent.</p>",tags:["midnimo-admin-test"]}),signal:AbortSignal.timeout(15000)});
 const result=await res.json();
 if(!res.ok)return reply({error:"Brevo rejected the test. Check sender verification, API permissions and authorised IP settings.",providerCode:result.code||null},502);
 return reply({message:"Brevo accepted the test email. Check your inbox and spam folder.",messageId:result.messageId});
 }catch{return reply({error:"Email test failed. Check Edge Function logs and try again."},500);}
});