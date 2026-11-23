import {clsx,type ClassValue} from 'clsx';
import {twMerge} from 'tailwind-merge';
export function cn(...inputs:ClassValue[]) {return twMerge(clsx(inputs));}
export function normalizeError(error:unknown):string {return error instanceof Error?error.message:String(error);}
export function formatWhen(value:number,locale:string):string {
  return new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(value);
}
