"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

interface SelectContextValue {
  value: string;
  onValueChange: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

const SelectContext = React.createContext<SelectContextValue | undefined>(undefined);

function useSelect() {
  const context = React.useContext(SelectContext);
  if (!context) {
    throw new Error("Select components must be used within a Select provider");
  }
  return context;
}

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
}

export function Select({ value, onValueChange, children }: SelectProps) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  return (
    <SelectContext.Provider value={{ value, onValueChange, open, setOpen, triggerRef }}>
      <div className="relative">{children}</div>
    </SelectContext.Provider>
  );
}

interface SelectTriggerProps {
  children: React.ReactNode;
  className?: string;
  id?: string;
}

export function SelectTrigger({ children, className, id }: SelectTriggerProps) {
  const { open, setOpen, triggerRef } = useSelect();

  return (
    <button
      id={id}
      ref={triggerRef as React.RefObject<HTMLButtonElement>}
      type="button"
      onClick={() => setOpen(!open)}
      className={cn(
        "flex h-10 w-full items-center justify-between rounded-ds-control border border-ds-border-control bg-ds-background px-3 py-2 text-sm text-ds-text-primary ring-offset-ds-background transition-colors duration-100 placeholder:text-ds-text-muted hover:border-ds-text-secondary focus:outline-none focus-visible:border-ds-focus focus-visible:ring-1 focus-visible:ring-ds-focus disabled:cursor-not-allowed disabled:bg-ds-surface disabled:opacity-60",
        className
      )}
    >
      {children}
      <ChevronDown className="h-4 w-4 text-ds-text-secondary" aria-hidden="true" />
    </button>
  );
}

interface SelectValueProps {
  placeholder?: string;
}

export function SelectValue({ placeholder }: SelectValueProps) {
  const { value } = useSelect();
  return <span>{value || placeholder}</span>;
}

interface SelectContentProps {
  children: React.ReactNode;
  className?: string;
}

export function SelectContent({ children, className }: SelectContentProps) {
  const { open, setOpen, triggerRef } = useSelect();
  const ref = React.useRef<HTMLDivElement>(null);
  const [position, setPosition] = React.useState({ top: 0, left: 0, width: 0 });
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }
  }, [open, triggerRef]);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        ref.current &&
        !ref.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    function handleScroll() {
      if (open && triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setPosition({
          top: rect.bottom + window.scrollY + 4,
          left: rect.left + window.scrollX,
          width: rect.width,
        });
      }
    }

    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      window.addEventListener("scroll", handleScroll, true);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open, setOpen, triggerRef]);

  if (!open || !mounted) return null;

  const content = (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: position.top,
        left: position.left,
        width: position.width,
        minWidth: "8rem",
      }}
      className={cn(
        "z-[9999] overflow-hidden rounded-ds-popover border border-ds-border bg-ds-surface-elevated text-ds-text-primary shadow-ds-popover animate-in fade-in-0 zoom-in-95 duration-150",
        className
      )}
    >
      <div className="p-1 max-h-[200px] overflow-y-auto">{children}</div>
    </div>
  );

  return createPortal(content, document.body);
}

interface SelectItemProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

export function SelectItem({ value, children, className }: SelectItemProps) {
  const { value: selectedValue, onValueChange, setOpen } = useSelect();
  const isSelected = selectedValue === value;

  return (
    <div
      role="option"
      aria-selected={isSelected}
      onClick={() => {
        onValueChange(value);
        setOpen(false);
      }}
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center rounded-[4px] py-1.5 pl-8 pr-2 text-sm text-ds-text-primary outline-none transition-colors duration-100 hover:bg-ds-surface focus:bg-ds-surface",
        isSelected && "bg-ds-surface font-medium",
        className
      )}
    >
      {isSelected && (
        <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>
      )}
      {children}
    </div>
  );
}
