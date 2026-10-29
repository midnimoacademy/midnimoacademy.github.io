import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const headers={"Access-Control-Allow-Origin":"https://midnimoacademy.org","Access-Control-Allow-Headers":"content-type,apikey,authorization,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json"};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
Deno.serve(async req=>{
if(req.method==="OPTIONS")return new Response(null,{headers});
if(req.method!=="POST")return reply({error:"POST required"},405);
try{
const {token}=await req.json();
if(typeof token!=="string"||!/^[a-f0-9-]{72}$/.test(token))return reply({error:"Invalid unsubscribe link."},400);
const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,"0")).join("");
const db=createClient(Deno.env.get("SUPABASE_URL"),Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false}});
const {data,error}=await db.from("newsletter_unsubscribe_tokens").select("user_id").eq("token_hash",digest).maybeSingle();
if(error)throw error;if(!data)return reply({error:"Invalid unsubscribe link. Use your email preferences instead."},400);
const saved=await db.from("newsletter_preferences").update({academy_updates:false,progress_emails:false,updated_at:new Date().toISOString()}).eq("user_id",data.user_id);
if(saved.error)throw saved.error;
return reply({message:"You have unsubscribed from optional Midnimo Academy newsletters and progress emails."});
}catch{return reply({error:"Could not unsubscribe. Please try again or use email preferences."},500);}
});