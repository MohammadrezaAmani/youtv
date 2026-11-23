import {useMemo,useState} from 'react';
import {CalendarDays,ChevronLeft,ChevronRight} from 'lucide-react';
import {ActionButton} from './action-button';
/** Local date picker, ISO date value; no browser-dependent native date-input UI. */
export function DatePicker({value,onChange,min,max,locale='en',disabled=false}:{value?:string;onChange:(date:string)=>void;min?:string;max?:string;locale?:string;disabled?:boolean}){
  const initial=()=>{const parsed=value?new Date(`${value}T12:00:00`):new Date();return Number.isNaN(parsed.getTime())?new Date():parsed;};
  const [month,setMonth]=useState(()=>{const d=initial();return new Date(d.getFullYear(),d.getMonth(),1);});
  const [open,setOpen]=useState(false);
  const days=useMemo(()=>{const offset=month.getDay();const count=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();return [...Array(offset).fill(null),...Array.from({length:count},(_,i)=>i+1)] as (number|null)[];},[month]);
  const stamp=(day:number)=>`${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  return <div className="ui-date-root"><ActionButton className="ui-input ui-date-trigger" disabled={disabled} aria-expanded={open} onClick={()=>setOpen(v=>!v)}><CalendarDays size={16}/>{value||'Select date'}</ActionButton>
    {open&&<div className="ui-date-popover"><div className="ui-date-header"><ActionButton aria-label="Previous month" onClick={()=>setMonth(m=>new Date(m.getFullYear(),m.getMonth()-1,1))}><ChevronLeft size={17}/></ActionButton><strong>{new Intl.DateTimeFormat(locale,{month:'long',year:'numeric'}).format(month)}</strong><ActionButton aria-label="Next month" onClick={()=>setMonth(m=>new Date(m.getFullYear(),m.getMonth()+1,1))}><ChevronRight size={17}/></ActionButton></div><div className="ui-date-grid">{['S','M','T','W','T','F','S'].map((day,i)=><span key={i}>{day}</span>)}{days.map((day,i)=>day===null?<span key={`blank-${i}`}/>:<ActionButton key={day} className={stamp(day)===value?'selected':''} disabled={Boolean((min&&stamp(day)<min)||(max&&stamp(day)>max))} onClick={()=>{onChange(stamp(day));setOpen(false);}}>{day}</ActionButton>)}</div></div>}
  </div>;
}
