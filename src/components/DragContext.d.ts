import type { ComponentType, ReactNode } from "react";

export const DragProvider: ComponentType<{ children?: ReactNode }>;
export const DropZone: ComponentType<{
  onDrop: (item: any) => void;
  children?: ReactNode;
  className?: string;
  activeClassName?: string;
}>;
export function useDrag(): any;

