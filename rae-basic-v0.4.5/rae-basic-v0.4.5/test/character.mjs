// 物理だけのヘッドレス確認(ブラウザ・Three.js不要)。 実行: npm i @dimforge/rapier3d-compat && node test/character.mjs
// 期待値は各行の括弧内。段差・壁・坂・ジャンプ・天井を確認する。
import RAPIER from '@dimforge/rapier3d-compat';
import { Physics } from '../src/basic/physics.js';
import { CharacterController } from '../src/basic/character.js';
await RAPIER.init();
const q = (deg)=>{const r=deg*Math.PI/360;return [Math.sin(r),0,0,Math.cos(r)];}
const mkWorld = (build) => { const ph = new Physics(RAPIER); ph.addStaticBox({ position:[0,-1,0], size:[400,2,400] }); build(ph);
  const a = { position:{x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}}, heading:0, setMotion(){}, built:{bodyBox:{min:{y:0},max:{y:5.125}}} };
  const c = new CharacterController(ph,a,{engine:{yaw:0,on(){return ()=>{}}}}); return {ph,c}; };
const run=(ph,n)=>{for(let i=0;i<n;i++)ph.update(1/60);};
{ const {ph,c}=mkWorld(p=>p.addStaticBox({position:[40,0.4,0],size:[40,0.8,20]})); c.teleport(10,0.1,0); c.input.x=1; run(ph,120);
  console.log('autostep 0.8 → y=',c.pos.y.toFixed(2),'x=',c.pos.x.toFixed(1),'(y≈0.85)'); }
{ const {ph,c}=mkWorld(p=>p.addStaticBox({position:[40,0.75,0],size:[40,1.5,20]})); c.teleport(10,0.1,0); c.input.x=1; run(ph,120);
  console.log('step 1.5 blocked → x=',c.pos.x.toFixed(1),'y=',c.pos.y.toFixed(2),'(x≈18, y≈0.05)'); 
  c.input.jump=true; run(ph,2); c.input.jump=false; run(ph,90); console.log('jump onto 1.5 → x=',c.pos.x.toFixed(1),'y=',c.pos.y.toFixed(2),'(y≈1.55)'); }
{ const {ph,c}=mkWorld(p=>p.addStaticBox({position:[0,5,-30],size:[200,10,2]})); c.teleport(0,0.1,-10); c.input.x=1; c.input.y=1; run(ph,120);
  console.log('wall slide → x=',c.pos.x.toFixed(1),'z=',c.pos.z.toFixed(2),'(z≈-28.05, x≫0)'); }
for (const deg of [30,45,60]) { const L=30,t=1,r=deg*Math.PI/180;
  const {ph,c}=mkWorld(p=>p.addStaticBox({position:[0,(L/2)*Math.sin(r)-(t/2)*Math.cos(r),-20],size:[10,t,L],quaternion:q(deg)}));
  c.teleport(0,0.1,-3); c.input.y=1; run(ph,150); console.log(`slope ${deg}° → y=`,c.pos.y.toFixed(2),'z=',c.pos.z.toFixed(1)); }
{ const {ph,c}=mkWorld(()=>{}); c.teleport(0,0.1,0); c.input.jump=true; run(ph,1); c.input.jump=false; let apex=0; for(let i=0;i<100;i++){run(ph,1);apex=Math.max(apex,c.pos.y);} console.log('jump apex',apex.toFixed(2),'(≈7.25 incl. offset)'); }
{ const {ph,c}=mkWorld(p=>p.addStaticBox({position:[0,8,0],size:[20,1,20]})); c.teleport(0,1,0); c.input.jump=true; run(ph,200); console.log('ceiling at y=7.5 → still grounded?',c.grounded,'y',c.pos.y.toFixed(2),'(bumps, no stick)'); }
{ const {ph,c}=mkWorld(()=>{}); c.engine.yaw=0.7; c.teleport(0,0.1,0); c.faceCamera=true; run(ph,120);
  console.log('faceCamera → heading=',c.avatar.heading.toFixed(2),'(≈0.70。入力なしでもカメラの向き)');
  c.input.x=1; run(ph,120); console.log('faceCamera 横移動中も → heading=',c.avatar.heading.toFixed(2),'(≈0.70)'); }
