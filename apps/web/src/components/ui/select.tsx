import * as React from 'react';
import * as Primitive from '@radix-ui/react-select';
import {Check,ChevronDown,ChevronUp} from 'lucide-react';
import {cn} from '@/lib/utils';

/** Declarative option descriptors; never render native <option> elements. */
export function SelectOption(_props:{value:string|number;children:React.ReactNode;disabled?:boolean}){return null;}
export type SelectChange={target:{value:string}};
const encode=(value:string)=>value===''?'__youtv_empty_option__':value;
const decode=(value:string)=>value==='__youtv_empty_option__'?'':value;
type Props={
  value?:string|number;defaultValue?:string|number;disabled?:boolean;required?:boolean;
  name?:string;id?:string;className?:string;style?:React.CSSProperties;
  'aria-label'?:string;children:React.ReactNode;placeholder?:string;
  onChange?:(event:SelectChange)=>void;
};
export function Select({value,defaultValue,disabled,required,name,id,className,style,children,placeholder,onChange,...other}:Props){
  const options=React.Children.toArray(children).filter((node):node is React.ReactElement<React.ComponentProps<typeof SelectOption>>=>React.isValidElement(node)&&node.type===SelectOption);
  const first=options[0];
  const textFor=(id:string)=>options.find(node=>String(node.props.value)===id)?.props.children??placeholder??'—';
  const selected=value===undefined?defaultValue===undefined?undefined:String(defaultValue):String(value);
  return <Primitive.Root value={value===undefined?undefined:encode(String(value))} defaultValue={value===undefined?(defaultValue===undefined?undefined:encode(String(defaultValue))):undefined}
    disabled={disabled} required={required} name={name} onValueChange={next=>onChange?.({target:{value:decode(next)}})}>
    <Primitive.Trigger id={id} className={cn('ui-select-trigger',className)} style={style} aria-label={other['aria-label']}>
      <Primitive.Value placeholder={placeholder||String(textFor(selected??String(first?.props.value??'')))} />
      <Primitive.Icon className="ui-select-chevron"><ChevronDown size={16}/></Primitive.Icon>
    </Primitive.Trigger>
    <Primitive.Portal><Primitive.Content className="ui-select-content" position="popper" sideOffset={5} collisionPadding={8}>
      <Primitive.ScrollUpButton className="ui-select-scroll"><ChevronUp size={16}/></Primitive.ScrollUpButton>
      <Primitive.Viewport className="ui-select-viewport">
        {options.map(item=><Primitive.Item className="ui-select-option" key={String(item.props.value)} value={encode(String(item.props.value))} disabled={item.props.disabled}>
          <Primitive.ItemText>{item.props.children}</Primitive.ItemText>
          <Primitive.ItemIndicator className="ui-select-selected"><Check size={15}/></Primitive.ItemIndicator>
        </Primitive.Item>)}
      </Primitive.Viewport>
      <Primitive.ScrollDownButton className="ui-select-scroll"><ChevronDown size={16}/></Primitive.ScrollDownButton>
    </Primitive.Content></Primitive.Portal>
  </Primitive.Root>;
}
