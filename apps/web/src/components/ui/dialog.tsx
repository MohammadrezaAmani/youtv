import * as DialogPrimitive from '@radix-ui/react-dialog';
import {X} from 'lucide-react';
import {cn} from '@/lib/utils';
export const Dialog=DialogPrimitive.Root;
export const DialogTrigger=DialogPrimitive.Trigger;
export const DialogClose=DialogPrimitive.Close;
export function DialogContent({className,children,...props}:React.ComponentProps<typeof DialogPrimitive.Content>){
  return <DialogPrimitive.Portal><DialogPrimitive.Overlay className="modal-overlay"/><DialogPrimitive.Content className={cn('modal-content',className)} {...props}>
    {children}<DialogPrimitive.Close className="modal-close" aria-label="Close"><X size={19}/></DialogPrimitive.Close>
  </DialogPrimitive.Content></DialogPrimitive.Portal>;
}
export const DialogTitle=DialogPrimitive.Title;
export const DialogDescription=DialogPrimitive.Description;
