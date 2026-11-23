import * as React from 'react';
/** Reusable semantic button base used by controls with bespoke player/navigation styling. */
export const ActionButton=React.forwardRef<HTMLButtonElement,React.ButtonHTMLAttributes<HTMLButtonElement>>(({type='button',...props},ref)=><button ref={ref} type={type} {...props}/>);
ActionButton.displayName='ActionButton';
