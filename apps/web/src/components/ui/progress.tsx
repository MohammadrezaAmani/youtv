export function ProgressBar({value,max=100,className='',style}:{value:number;max?:number;className?:string;style?:React.CSSProperties}){
  const fraction=max>0?Math.min(100,Math.max(0,value/max*100)):0;
  return <div className={`ui-progress ${className}`} style={style} role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.max(0,Math.min(value,max))}><div style={{width:`${fraction}%`}}/></div>;
}
