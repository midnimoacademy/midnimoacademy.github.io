window.midnimoBlockchainAccess=(async()=>{
let timer;try{
const check=(async()=>{
const db=window.supabase.createClient('https://uecogftwdvpfhxkdgjel.supabase.co','sb_publishable_zFAX-W1T8Hj5HMKwkA5Tcw_yaIjr-Ff');
const {data:{user},error}=await db.auth.getUser();if(error||!user){location.replace('/student.html?next='+encodeURIComponent(location.pathname));return}
const result=await db.from('blockchain_learner_profiles').select('user_id').eq('user_id',user.id).maybeSingle();if(result.error)throw result.error;
if(!result.data){location.replace('/blockchain-learner-details.html?next='+encodeURIComponent(location.pathname));return}
document.body.classList.add('access-ready');
return user;
})();
return await Promise.race([check,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Please refresh and try again.')),15000))]);
}catch{
document.body.replaceChildren();const main=document.createElement('main');main.style.cssText='max-width:650px;margin:60px auto;padding:24px;font:18px/1.6 system-ui';
const h=document.createElement('h1');h.textContent='Unable to check learner details';const p=document.createElement('p');p.textContent='Please refresh to try again. Your account details have not changed.';const a=document.createElement('a');a.href='/blockchain-learner-details.html';a.textContent='Open learner details';main.append(h,p,a);document.body.append(main);document.body.classList.add('access-ready');
}finally{clearTimeout(timer)}
})();