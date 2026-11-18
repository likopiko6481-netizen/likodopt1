const $=id=>document.getElementById(id);
const ROOM='https://ntfy.sh';
const me='u_'+Math.random().toString(36).slice(2,10);
let pid=null,st='idle',mic=null,pc=null,muted=false,tInt=null,sInt=null,sec=0;
const seen=new Set();

if(document.cookie.includes('lk_ok=1'))$('ck').style.display='none';
$('ckX').onclick=()=>{document.cookie='lk_ok=1;max-age=2592000;path=/';$('ck').style.display='none'};

const log=(t,c='sys')=>{const d=document.createElement('div');d.className='m '+c;d.textContent=t;$('msgs').appendChild(d);$('msgs').scrollTop=99999};
const view=v=>{
  clearInterval(tInt);sec=0;
  $('vIdle').classList.toggle('on',v==='idle');
  $('vQueue').classList.toggle('on',v==='queue');
  $('vCall').classList.toggle('on',v==='call');
  if(v==='queue'||v==='call'){
    const el=$(v==='queue'?'tQueue':'tCall');
    const pref=v==='queue'?'Поиск: ':'● Разговор: ';
    el.textContent=pref+'00:00';
    tInt=setInterval(()=>{sec++;el.textContent=pref+String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0')},1000);
  }
};
const chatOn=on=>{$('inp').disabled=!on;$('bSend').disabled=!on};
const send=data=>{const mid=me+'_'+Date.now()+Math.random();fetch(ROOM,{method:'POST',body:JSON.stringify({mid,from:me,ts:Date.now(),...data})}).catch(()=>{})};

const stop=msg=>{
  clearInterval(sInt);if(pid)send({to:pid,type:'bye'});
  pid=null;st='idle';view('idle');chatOn(false);
  if(pc){try{pc.close()}catch(e){}pc=null}
  if(msg){$('bStop').disabled=true;$('stTxt').textContent=msg;log(msg)}
};

const call=async init=>{
  st='call';view('call');chatOn(true);$('msgs').innerHTML='';log('Собеседник найден! 👋');
  pc=new RTCPeerConnection({iceServers:[{urls:'stun:://google.com'},{urls:'turn:openrelay.metered.ca:443',username:'openrelayproject',credential:'openrelayproject'}]});
  if(mic)mic.getTracks().forEach(t=>pc.addTrack(t,mic));
  pc.ontrack=e=>{$('aud').srcObject=new MediaStream([e.track]);$('aud').play().catch(()=>{})};
  pc.onicecandidate=e=>{if(e.candidate&&pid)send({to:pid,type:'c',c:e.candidate})};
  if(init){const o=await pc.createOffer();await pc.setLocalDescription(o);send({to:pid,type:'o',o})}
};

$('bNext').onclick=()=>{
  stop(false);st='search';$('bStop').disabled=false;$('msgs').innerHTML='';view('queue');log('Ищем собеседника...');
  if(!mic&&navigator.mediaDevices)navigator.mediaDevices.getUserMedia({audio:true}).then(s=>{mic=s;$('bMute').disabled=false}).catch(()=>log('Микрофон отключен'));
  send({type:'seek'});sInt=setInterval(()=>{if(st==='search')send({type:'seek'})},1500);
};
$('bStop').onclick=()=>stop('Поиск остановлен');
$('bMute').onclick=()=>{if(!mic)return;muted=!muted;mic.getAudioTracks().forEach(t=>t.enabled=!muted);$('bMute').textContent=muted?'Включить микрофон':'Выключить микрофон'};
$('cForm').onsubmit=e=>{e.preventDefault();const v=$('inp').value.trim();if(!v||!pid)return;log(v,'me');send({to:pid,type:'txt',v});$('inp').value=''};

const poll=async()=>{
  try{
    const r=await fetch(ROOM+'/json?poll=1&since=12s');
    if(r.ok){
      const lines=(await r.text()).trim().split('\n');
      for(const l of lines){
        if(!l)continue;const w=JSON.parse(l);if(!w.message)continue;const m=JSON.parse(w.message);
        if(!m||m.from===me||seen.has(m.mid)||Date.now()-m.ts>15000)continue;seen.add(m.mid);
        if(m.type==='seek'&&st==='search'&&me>m.from){st='conn';pid=m.from;clearInterval(sInt);send({to:pid,type:'ok'});call(true)}
        else if(m.to===me&&m.type==='ok'&&st==='search'){st='conn';pid=m.from;clearInterval(sInt);call(false)}
        else if(m.to===me&&m.from===pid){
          if(m.type==='o'&&pc){await pc.setRemoteDescription(new RTCSessionDescription(m.o));const a=await pc.createAnswer();await pc.setLocalDescription(a);send({to:pid,type:'a',a})}
          else if(m.type==='a'&&pc)await pc.setRemoteDescription(new RTCSessionDescription(m.a));
          else if(m.type==='c'&&pc)try{await pc.addIceCandidate(new RTCIceCandidate(m.c))}catch(e){}
          else if(m.type==='txt')log(m.v,'he');
          else if(m.type==='bye')stop('Собеседник отключился');
        }
      }
    }
  }catch(e){}
  setTimeout(poll,1000);
};
poll();
