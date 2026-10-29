"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Logo, LogoMark } from "@/components/logo";
import { MonthSelect } from "@/components/month-select";

type Slot = {
  id: string;
  provider: string;
  start: string;
  end: string;
  available: boolean;
};

type Booking = {
  id: string;
  slot_id: string;
  name: string;
  email: string;
  status: "confirmed" | "cancelled";
  created_at: string;
};

type Loaded = { slots: Slot[]; at: number; tz: string };
type Day = { key: string; start: Date; slots: Slot[] };
type Cell = { key: string; date: Date; day: Day | null };
type Week = { key: string; cells: Cell[] };

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString([], {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
const dayMonth = (d: Date) =>
  d.toLocaleDateString([], { day: "numeric", month: "short" });

export default function Home() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState("");
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [booking, setBooking] = useState<Booking | null>(null);
  const [bookedSlot, setBookedSlot] = useState<Slot | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [origin, setOrigin] = useState<"new" | "found" | "moved">("new");
  const [lookupRef, setLookupRef] = useState("");
  const [lookupError, setLookupError] = useState("");
  const panelRef = useRef<HTMLElement>(null);

  // One idempotency key per booking attempt, so a double click or a retry can
  // never create two bookings. Created in handlers only, never during render.
  const idemKey = useRef("");
  const newAttempt = () => {
    idemKey.current = crypto.randomUUID();
  };

  const loadSlots = useCallback(async () => {
    try {
      const res = await fetch("/ui/slots", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load times");
      setLoaded({
        slots: data.slots,
        at: Date.now(),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setLoadError("");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load times");
    }
  }, []);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  // Upcoming slots only, grouped by local calendar day.
  const days = useMemo<Day[]>(() => {
    if (!loaded) return [];
    const map = new Map<string, Day>();
    for (const s of loaded.slots) {
      const start = new Date(s.start);
      if (start.getTime() <= loaded.at) continue;
      const key = dayKey(start);
      const day = map.get(key) ?? { key, start, slots: [] };
      day.slots.push(s);
      map.set(key, day);
    }
    return [...map.values()].sort(
      (a, b) => a.start.getTime() - b.start.getTime(),
    );
  }, [loaded]);

  // Monday to Sunday weeks, skipping weeks with no upcoming slots at all.
  const weeks = useMemo<Week[]>(() => {
    const byKey = new Map(days.map((d) => [d.key, d]));
    const seen = new Set<string>();
    const out: Week[] = [];
    for (const d of days) {
      const offset = (d.start.getDay() + 6) % 7;
      const monday = new Date(
        d.start.getFullYear(),
        d.start.getMonth(),
        d.start.getDate() - offset,
      );
      const key = dayKey(monday);
      if (seen.has(key)) continue;
      seen.add(key);
      const cells: Cell[] = Array.from({ length: 7 }, (_, i) => {
        const date = new Date(
          monday.getFullYear(),
          monday.getMonth(),
          monday.getDate() + i,
        );
        const k = dayKey(date);
        return { key: k, date, day: byKey.get(k) ?? null };
      });
      out.push({ key, cells });
    }
    return out;
  }, [days]);

  const activeDay =
    days.find((d) => d.key === pickedDay) ??
    days.find((d) => d.slots.some((s) => s.available)) ??
    days[0];

  const weekIndex = Math.max(
    0,
    weeks.findIndex((w) => w.cells.some((c) => c.key === activeDay?.key)),
  );
  const activeWeek = weeks[weekIndex];

  const months = useMemo(() => {
    const seen = new Map<string, { value: string; label: string }>();
    for (const d of days) {
      const value = d.key.slice(0, 7);
      if (!seen.has(value)) {
        seen.set(value, {
          value,
          label: d.start.toLocaleDateString([], {
            month: "long",
            year: "numeric",
          }),
        });
      }
    }
    return [...seen.values()];
  }, [days]);

  const rows = useMemo(() => {
    const byProvider = new Map<string, Slot[]>();
    for (const s of activeDay?.slots ?? []) {
      const list = byProvider.get(s.provider) ?? [];
      list.push(s);
      byProvider.set(s.provider, list);
    }
    return [...byProvider.entries()];
  }, [activeDay]);

  // Jump to the first day in a group of days that still has free times.
  function firstBookable(group: Day[]) {
    return (group.find((d) => d.slots.some((s) => s.available)) ?? group[0])
      ?.key;
  }

  function goWeek(delta: number) {
    const w = weeks[weekIndex + delta];
    if (!w) return;
    const key = firstBookable(
      w.cells.flatMap((c) => (c.day ? [c.day] : [])),
    );
    if (key) setPickedDay(key);
  }

  function goMonth(value: string) {
    const key = firstBookable(days.filter((d) => d.key.startsWith(value)));
    if (key) setPickedDay(key);
  }

  function pick(slot: Slot) {
    if (!rescheduling) setBooking(null);
    setConfirmingCancel(false);
    setSelected(slot);
    setFormError("");
    setNotice("");
    newAttempt();
    if (window.matchMedia("(max-width: 1023px)").matches) {
      const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      panelRef.current?.scrollIntoView({
        behavior: calm ? "auto" : "smooth",
        block: "nearest",
      });
    }
  }

  async function book(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!selected || busy) return;
    if (!idemKey.current) newAttempt();
    setBusy(true);
    setFormError("");
    try {
      const res = await fetch("/ui/bookings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idemKey.current,
        },
        body: JSON.stringify({ slot_id: selected.id, name, email }),
      });
      const data = await res.json();
      if (res.status === 201) {
        setBooking(data);
        setBookedSlot(selected);
        setOrigin("new");
        setSelected(null);
        newAttempt();
        loadSlots();
      } else if (res.status === 409) {
        setSelected(null);
        setNotice("Someone just booked that time. Please pick another one.");
        newAttempt();
        loadSlots();
      } else if (res.status === 429) {
        const wait = res.headers.get("retry-after");
        setFormError(
          `Too many attempts for this email. Try again${wait ? ` in ${wait} seconds` : " shortly"}.`,
        );
      } else {
        setFormError(data.error ?? "Something went wrong. Please try again.");
      }
    } catch {
      setFormError(
        "We could not reach the server. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!booking || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/ui/bookings/${booking.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok) {
        setBooking(data);
        setConfirmingCancel(false);
      } else {
        setFormError(data.error ?? "Could not cancel the booking.");
      }
      loadSlots();
    } finally {
      setBusy(false);
    }
  }

  // Find an existing appointment from its reference.
  async function lookup(e: React.SyntheticEvent) {
    e.preventDefault();
    const ref = lookupRef.trim();
    if (!ref || busy) return;
    if (!loaded) {
      setLookupError("Times are still loading. Try again in a moment.");
      return;
    }
    setBusy(true);
    setLookupError("");
    try {
      const res = await fetch(`/ui/bookings/${encodeURIComponent(ref)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        setLookupError(
          res.status === 404
            ? "We could not find a booking with that reference."
            : (data.error ?? "Could not look up that booking."),
        );
        return;
      }
      const slot = loaded.slots.find((s) => s.id === data.slot_id);
      if (!slot) {
        setLookupError("We found the booking but not its time. Please try again.");
        return;
      }
      setSelected(null);
      setRescheduling(false);
      setConfirmingCancel(false);
      setFormError("");
      setNotice("");
      setBooking(data);
      setBookedSlot(slot);
      setOrigin("found");
      setLookupRef("");
    } catch {
      setLookupError(
        "We could not reach the server. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  function startReschedule() {
    setRescheduling(true);
    setSelected(null);
    setConfirmingCancel(false);
    setFormError("");
    setNotice("");
    if (window.matchMedia("(max-width: 1023px)").matches) {
      const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document
        .getElementById("times-heading")
        ?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
    }
  }

  function stopReschedule() {
    setRescheduling(false);
    setSelected(null);
    setFormError("");
    setNotice("");
  }

  async function reschedule(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!booking || !selected || busy) return;
    setBusy(true);
    setFormError("");
    try {
      const res = await fetch(`/ui/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slot_id: selected.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setBooking(data);
        setBookedSlot(selected);
        setOrigin("moved");
        setSelected(null);
        setRescheduling(false);
      } else if (res.status === 409 && data.error === "slot already booked") {
        setSelected(null);
        setNotice("Someone just booked that time. Please pick another one.");
      } else {
        setFormError(data.error ?? "Could not move the appointment.");
      }
      loadSlots();
    } catch {
      setFormError(
        "We could not reach the server. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 text-base text-ink placeholder:text-muted outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30";
  const quietButton =
    "rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition hover:border-brand disabled:opacity-50";

  const weekRange = activeWeek
    ? `${dayMonth(activeWeek.cells[0].date)} to ${dayMonth(activeWeek.cells[6].date)}`
    : "";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto w-full max-w-6xl px-5 py-5">
        <Logo />
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-16">
        <section className="max-w-2xl pb-8 pt-6 sm:pt-10">
          <h1 className="font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
            Find a time that works for you
          </h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-muted">
            Choose a day, pick an open time with one of our doctors, and
            confirm with your name and email.
          </p>
        </section>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
          <section aria-labelledby="times-heading">
            <h2 id="times-heading" className="sr-only">
              Available times
            </h2>

            {loadError && (
              <div
                role="alert"
                className="rounded-2xl border border-danger/40 p-4 text-sm"
              >
                <p className="text-danger">{loadError}</p>
                <button
                  onClick={loadSlots}
                  className="mt-2 font-medium underline underline-offset-4"
                >
                  Try again
                </button>
              </div>
            )}

            {!loaded && !loadError && (
              <div aria-hidden="true" className="space-y-5">
                <div className="h-11 w-72 animate-pulse rounded-full bg-line" />
                <div className="grid grid-cols-7 gap-2">
                  {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                    <div
                      key={i}
                      className="h-[88px] animate-pulse rounded-2xl bg-line"
                    />
                  ))}
                </div>
                <div className="h-9 w-2/3 animate-pulse rounded-full bg-line" />
              </div>
            )}
            {!loaded && !loadError && (
              <p role="status" className="sr-only">
                Loading available times
              </p>
            )}

            {loaded && days.length === 0 && (
              <p className="rounded-2xl bg-tint p-5 text-ink">
                There are no open times right now. Please check back soon.
              </p>
            )}

            {days.length > 0 && activeDay && activeWeek && (
              <>
                <div className="mb-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => goWeek(-1)}
                    disabled={weekIndex === 0}
                    aria-label="Previous week"
                    title="Previous week"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface transition hover:border-brand disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M15 6l-6 6 6 6" />
                    </svg>
                  </button>

                  <MonthSelect
                    value={activeDay.key.slice(0, 7)}
                    options={months}
                    onChange={goMonth}
                  />

                  <button
                    type="button"
                    onClick={() => goWeek(1)}
                    disabled={weekIndex === weeks.length - 1}
                    aria-label="Next week"
                    title="Next week"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface transition hover:border-brand disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </button>

                  <p className="ml-auto hidden text-sm text-muted sm:block">
                    {weekRange}
                  </p>
                </div>

                <ul className="grid grid-cols-7 gap-1.5 sm:gap-2">
                  {activeWeek.cells.map((c) => {
                    const free =
                      c.day?.slots.filter((s) => s.available).length ?? 0;
                    const active = c.key === activeDay.key;
                    const weekday = c.date.toLocaleDateString([], {
                      weekday: "short",
                    });
                    const label = c.day
                      ? `${c.date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}, ${free === 0 ? "fully booked" : `${free} times free`}`
                      : `${c.date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}, closed`;
                    return (
                      <li key={c.key} className="min-w-0">
                        <button
                          disabled={!c.day}
                          onClick={() => setPickedDay(c.key)}
                          aria-pressed={active}
                          aria-label={label}
                          className={`flex w-full flex-col items-center rounded-2xl border px-1 py-3 text-center transition sm:py-4 ${
                            active
                              ? "border-brand bg-brand text-on-brand"
                              : c.day
                                ? "border-line bg-surface hover:border-brand"
                                : "cursor-not-allowed border-dashed border-line text-muted opacity-60"
                          } ${c.day && free === 0 && !active ? "opacity-60" : ""}`}
                        >
                          <span className="text-xs sm:text-sm">{weekday}</span>
                          <span className="font-display text-2xl font-semibold leading-tight sm:text-3xl">
                            {c.date.getDate()}
                          </span>
                          <span
                            className={`mt-0.5 text-[11px] sm:text-xs ${active ? "" : "text-muted"}`}
                          >
                            {!c.day ? (
                              "Closed"
                            ) : free === 0 ? (
                              "Full"
                            ) : (
                              <>
                                {free}
                                <span className="hidden sm:inline"> free</span>
                              </>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>

                <div className="mt-8 space-y-7">
                  {rows.map(([provider, slots]) => {
                    const open = slots.filter((s) => s.available).length;
                    return (
                      <div key={provider}>
                        <div className="flex items-baseline justify-between gap-4">
                          <h3 className="font-display text-xl font-semibold">
                            {provider}
                          </h3>
                          <p className="text-sm text-muted">
                            {open === 0
                              ? "No open times"
                              : `${open} of ${slots.length} open`}
                          </p>
                        </div>
                        <ul className="mt-3 flex flex-wrap gap-2">
                          {slots.map((s) => {
                            const isSelected = selected?.id === s.id;
                            return (
                              <li key={s.id}>
                                <button
                                  disabled={!s.available}
                                  onClick={() => pick(s)}
                                  aria-pressed={isSelected}
                                  aria-label={
                                    s.available
                                      ? clock(s.start)
                                      : `${clock(s.start)}, already booked`
                                  }
                                  className={`rounded-full px-4 py-2 text-sm font-medium tabular-nums transition ${
                                    isSelected
                                      ? "bg-brand text-on-brand ring-2 ring-brand ring-offset-2 ring-offset-paper"
                                      : s.available
                                        ? "bg-tint text-ink hover:bg-brand hover:text-on-brand"
                                        : "cursor-not-allowed border border-line text-muted line-through"
                                  }`}
                                >
                                  {clock(s.start)}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>

          <aside
            ref={panelRef}
            aria-live="polite"
            className="rounded-3xl bg-surface p-6 ring-1 ring-line lg:sticky lg:top-6"
          >
            {rescheduling && booking && bookedSlot ? (
              <form onSubmit={reschedule} className="grid gap-4">
                <div>
                  <h2 className="font-display text-2xl font-semibold">
                    Move your appointment
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    Pick a new open time from the calendar.
                  </p>
                </div>

                <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm">
                  <dt className="text-muted">Now</dt>
                  <dd>
                    {bookedSlot.provider}
                    <br />
                    {longDate(bookedSlot.start)}
                    <br />
                    {clock(bookedSlot.start)} to {clock(bookedSlot.end)}
                  </dd>
                  <dt className="text-muted">New</dt>
                  <dd className="font-medium">
                    {selected ? (
                      <>
                        {selected.provider}
                        <br />
                        {longDate(selected.start)}
                        <br />
                        {clock(selected.start)} to {clock(selected.end)}
                      </>
                    ) : (
                      <span className="font-normal text-muted">
                        No time picked yet
                      </span>
                    )}
                  </dd>
                </dl>

                {notice && (
                  <p role="alert" className="text-sm font-medium text-danger">
                    {notice}
                  </p>
                )}
                {formError && (
                  <p role="alert" className="text-sm text-danger">
                    {formError}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    disabled={busy || !selected}
                    className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition hover:opacity-90 disabled:opacity-50"
                  >
                    {busy ? "Moving…" : "Confirm new time"}
                  </button>
                  <button
                    type="button"
                    onClick={stopReschedule}
                    disabled={busy}
                    className={quietButton}
                  >
                    Keep current time
                  </button>
                </div>
              </form>
            ) : booking && bookedSlot ? (
              <div>
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-full ${
                    booking.status === "confirmed"
                      ? "bg-brand text-on-brand"
                      : "bg-line text-muted"
                  }`}
                >
                  {booking.status === "confirmed" ? (
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path className="check-draw" d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  ) : (
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  )}
                </div>
                <h2 className="mt-4 font-display text-2xl font-semibold">
                  {booking.status === "cancelled"
                    ? "Booking cancelled"
                    : origin === "moved"
                      ? "Appointment moved"
                      : origin === "found"
                        ? "Your appointment"
                        : "You're booked"}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {booking.status === "confirmed"
                    ? "Keep your reference to cancel or reschedule later."
                    : "That time is open again for someone else."}
                </p>

                <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm">
                  <dt className="text-muted">Doctor</dt>
                  <dd className="font-medium">{bookedSlot.provider}</dd>
                  <dt className="text-muted">When</dt>
                  <dd className="font-medium">
                    {longDate(bookedSlot.start)}
                    <br />
                    {clock(bookedSlot.start)} to {clock(bookedSlot.end)}
                  </dd>
                  <dt className="text-muted">Name</dt>
                  <dd>{booking.name}</dd>
                  <dt className="text-muted">Email</dt>
                  <dd className="break-all">{booking.email}</dd>
                  <dt className="text-muted">Reference</dt>
                  <dd className="break-all text-xs tabular-nums">
                    {booking.id}
                  </dd>
                </dl>

                {formError && (
                  <p role="alert" className="mt-4 text-sm text-danger">
                    {formError}
                  </p>
                )}

                <div className="mt-6 flex flex-wrap items-center gap-2">
                  {booking.status === "confirmed" && !confirmingCancel && (
                    <button
                      onClick={startReschedule}
                      disabled={
                        busy ||
                        (!!loaded &&
                          new Date(bookedSlot.start).getTime() <= loaded.at)
                      }
                      className={quietButton}
                    >
                      Reschedule
                    </button>
                  )}
                  {booking.status === "confirmed" &&
                    (confirmingCancel ? (
                      <>
                        <span className="w-full text-sm">
                          Cancel this appointment?
                        </span>
                        <button
                          onClick={cancel}
                          disabled={busy}
                          className="rounded-full bg-danger px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
                        >
                          {busy ? "Cancelling…" : "Yes, cancel it"}
                        </button>
                        <button
                          onClick={() => setConfirmingCancel(false)}
                          className={quietButton}
                        >
                          Keep it
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmingCancel(true)}
                        className={quietButton}
                      >
                        Cancel booking
                      </button>
                    ))}
                  <button
                    onClick={() => {
                      setBooking(null);
                      setConfirmingCancel(false);
                      setFormError("");
                    }}
                    className="rounded-full px-4 py-2 text-sm font-medium text-brand underline underline-offset-4"
                  >
                    Book another time
                  </button>
                </div>
              </div>
            ) : selected ? (
              <form onSubmit={book} className="grid gap-4">
                <div>
                  <h2 className="font-display text-2xl font-semibold">
                    Your appointment
                  </h2>
                  <p className="mt-3 font-display text-lg font-semibold">
                    {selected.provider}
                  </p>
                  <p className="text-sm text-muted">
                    {longDate(selected.start)}
                    <br />
                    {clock(selected.start)} to {clock(selected.end)}
                  </p>
                </div>

                <label className="grid gap-1.5 text-sm font-medium">
                  Full name
                  <input
                    className={field}
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      newAttempt();
                    }}
                    required
                    autoComplete="name"
                    placeholder="Ada Obi"
                  />
                </label>
                <label className="grid gap-1.5 text-sm font-medium">
                  Email
                  <input
                    className={field}
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      newAttempt();
                    }}
                    required
                    autoComplete="email"
                    placeholder="ada@example.com"
                  />
                </label>

                {formError && (
                  <p role="alert" className="text-sm text-danger">
                    {formError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-full bg-brand px-5 py-3 text-base font-semibold text-on-brand transition hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? "Booking…" : "Confirm booking"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(null);
                    setFormError("");
                  }}
                  disabled={busy}
                  className="justify-self-center text-sm font-medium text-muted underline underline-offset-4 transition hover:text-ink disabled:opacity-50"
                >
                  Choose a different time
                </button>
              </form>
            ) : (
              <div className="flex flex-col items-start gap-3">
                <LogoMark size={40} className="opacity-90" />
                <h2 className="font-display text-xl font-semibold">
                  Pick a time to continue
                </h2>
                <p className="text-sm leading-relaxed text-muted">
                  Choose an open time and your details form will appear here.
                </p>
                {notice && (
                  <p role="alert" className="text-sm font-medium text-danger">
                    {notice}
                  </p>
                )}
              </div>
            )}

            {!rescheduling && (
              <form
                onSubmit={lookup}
                className="mt-6 grid gap-2 border-t border-line pt-5"
              >
                <label
                  htmlFor="lookup-ref"
                  className="font-display text-base font-semibold"
                >
                  Already booked?
                </label>
                <p className="text-sm text-muted">
                  Enter your reference to view, cancel or reschedule.
                </p>
                <input
                  id="lookup-ref"
                  className={field}
                  value={lookupRef}
                  onChange={(e) => {
                    setLookupRef(e.target.value);
                    setLookupError("");
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Paste your reference"
                />
                {lookupError && (
                  <p role="alert" className="text-sm text-danger">
                    {lookupError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={busy || !lookupRef.trim()}
                  className={`${quietButton} justify-self-start`}
                >
                  {busy ? "Looking…" : "Find my booking"}
                </button>
              </form>
            )}
          </aside>
        </div>
      </main>

      {loaded && (
        <footer className="mx-auto w-full max-w-6xl px-5 pb-8 text-sm text-muted">
          Times are shown in your local time zone ({loaded.tz}).
        </footer>
      )}
    </div>
  );
}
