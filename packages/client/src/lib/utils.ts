import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Склейка классов Tailwind с приоритетом последнего (стандарт shadcn/ui). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
