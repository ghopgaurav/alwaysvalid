
const n=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const clamp=(value,low,high)=>Math.min(high,Math.max(low,value));
const round=(value,digits=2)=>Number(value.toFixed(digits));
const mean=values=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:0;
const parseJSON=(value,fallback=[])=>{try{return JSON.parse(value)}catch{return fallback}};
const valuesFrom=value=>String(value).split(/[\s,]+/).map(Number).filter(Number.isFinite);
const result=(status,summary,metrics,rows,detail='')=>({status,summary,metrics,rows,detail});
const erf=x=>{const sign=x<0?-1:1,a=Math.abs(x),t=1/(1+0.3275911*a);const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-a*a);return sign*y};
const normalCdf=z=>0.5*(1+erf(z/Math.sqrt(2)));
const wilson=(successes,total)=>{if(!total)return[0,0];const z=1.96,p=successes/total,d=1+z*z/total,c=(p+z*z/(2*total))/d,h=z*Math.sqrt((p*(1-p)+z*z/(4*total))/total)/d;return[clamp(c-h,0,1),clamp(c+h,0,1)]};
const sha256=async value=>{const bytes=new TextEncoder().encode(String(value));const digest=await crypto.subtle.digest('SHA-256',bytes);return[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')};
const tag=(xml,name)=>xml.match(new RegExp('<'+name+'[^>]*>([\\s\\S]*?)<\\/'+name+'>','i'))?.[1]?.trim()??'';
const similarity=(a,b)=>{const x=String(a).toLowerCase(),y=String(b).toLowerCase();if(x===y)return 1;const A=new Set(x.split(/\W+/).filter(Boolean)),B=new Set(y.split(/\W+/).filter(Boolean));const inter=[...A].filter(v=>B.has(v)).length;return inter/Math.max(1,new Set([...A,...B]).size)};

export const meta={"slug":"alwaysvalid","name":"Always Valid","eyebrow":"Sequential A/B decision","description":"Compare fixed-horizon and always-valid evidence while the experiment is still running.","fields":[{"name":"controlVisitors","label":"Control visitors","type":"number","min":50,"max":100000,"step":1,"help":""},{"name":"controlConversions","label":"Control conversions","type":"number","min":0,"max":100000,"step":1,"help":""},{"name":"variantVisitors","label":"Variant visitors","type":"number","min":50,"max":100000,"step":1,"help":""},{"name":"variantConversions","label":"Variant conversions","type":"number","min":0,"max":100000,"step":1,"help":""},{"name":"alpha","label":"False-positive budget","type":"number","min":0.001,"max":0.2,"step":0.001,"help":""},{"name":"looks","label":"Interim looks","type":"number","min":1,"max":100,"step":1,"help":""}]};
export const initialState={"controlVisitors":5000,"controlConversions":510,"variantVisitors":5000,"variantConversions":600,"alpha":0.05,"looks":8};
export const alternateState={"controlVisitors":5000,"controlConversions":510,"variantVisitors":5000,"variantConversions":525,"alpha":0.05,"looks":8};
export async function compute(i){const cn=n(i.controlVisitors),vn=n(i.variantVisitors),cc=clamp(n(i.controlConversions),0,cn),vc=clamp(n(i.variantConversions),0,vn),a=n(i.alpha,.05),looks=Math.max(1,n(i.looks,1)),pc=cc/cn,pv=vc/vn,pool=(cc+vc)/(cn+vn),se=Math.sqrt(pool*(1-pool)*(1/cn+1/vn)),z=se?(pv-pc)/se:0,pFixed=2*(1-normalCdf(Math.abs(z))),pAny=Math.min(1,pFixed*looks),ship=pAny<a&&pv>pc;return result(ship?'Ship variant':'Keep running',`${ship?'Always-valid evidence clears':'Evidence does not clear'} the ${round(a*100,1)}% error budget.`,[{label:'Control rate',value:`${round(pc*100)}%`},{label:'Variant rate',value:`${round(pv*100)}%`},{label:'Always-valid p',value:round(pAny,4)},{label:'Relative lift',value:`${round((pv/pc-1)*100)}%`}],[{method:'Fixed horizon',pValue:round(pFixed,4),validAtInterim:'No'},{method:'Always-valid correction',pValue:round(pAny,4),validAtInterim:'Yes'}],`z = ${round(z,3)} across ${looks} planned looks.`)}
