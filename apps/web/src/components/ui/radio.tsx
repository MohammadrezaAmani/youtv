import {Circle} from 'lucide-react';
import {cn} from '@/lib/utils';
/** Custom UI built on an accessible native radio, so clicking label text works. */
export function RadioOption({checked,disabled,onChange,className,name='youtv-radio-group'}: {checked:boolean;disabled?:boolean;className?:string;name?:string;onChange?:()=>void}){
  return <span className={cn('ui-control-shell',className)}>
    <input type="radio" name={name} checked={checked} disabled={disabled} className="ui-control-native" onChange={onChange}/>
    <span aria-hidden="true" className="ui-radio">{checked&&<Circle size={9} fill="currentColor" stroke="none"/>}</span>
  </span>;
}
