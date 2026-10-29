"use client";

import { useEffect, useId, useRef, useState } from "react";

type Option = { value: string; label: string };

// A small accessible listbox, so the month picker matches the rest of the page
// instead of using the browser's native dropdown.
export function MonthSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value);

  // Close when clicking or tapping outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Keep the highlighted option visible while moving with the keyboard.
  useEffect(() => {
    if (open) {
      document
        .getElementById(`${listId}-${cursor}`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [open, cursor, listId]);

  function openList() {
    setCursor(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  function choose(i: number) {
    const o = options[i];
    if (o) onChange(o.value);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) openList();
        else setCursor((c) => Math.min(options.length - 1, c + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) openList();
        else setCursor((c) => Math.max(0, c - 1));
        break;
      case "Home":
        if (open) {
          e.preventDefault();
          setCursor(0);
        }
        break;
      case "End":
        if (open) {
          e.preventDefault();
          setCursor(options.length - 1);
        }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (open) choose(cursor);
        else openList();
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          setOpen(false);
        }
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label="Month"
        aria-activedescendant={open ? `${listId}-${cursor}` : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2.5 font-display text-lg font-semibold transition hover:border-brand"
      >
        {current?.label ?? "Choose month"}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Month"
          className="absolute left-0 top-full z-20 mt-2 max-h-72 min-w-full overflow-auto rounded-2xl bg-surface p-1.5 shadow-lg ring-1 ring-line"
        >
          {options.map((o, i) => {
            const selected = o.value === value;
            return (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={selected}
                onPointerEnter={() => setCursor(i)}
                onClick={() => choose(i)}
                className={`flex cursor-pointer items-center justify-between gap-6 whitespace-nowrap rounded-xl px-3 py-2 text-sm ${
                  cursor === i ? "bg-tint" : ""
                } ${selected ? "font-semibold" : ""}`}
              >
                {o.label}
                {selected && (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="text-brand"
                  >
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
