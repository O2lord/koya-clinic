export function LogoMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
    >
      <rect width="64" height="64" rx="16" fill="#0B6E6E" />
      <rect x="26" y="10" width="12" height="15" rx="4" fill="#FFFFFF" />
      <rect x="26" y="39" width="12" height="15" rx="4" fill="#FFFFFF" />
      <rect x="10" y="26" width="15" height="12" rx="4" fill="#FFFFFF" />
      <rect x="39" y="26" width="15" height="12" rx="4" fill="#FFFFFF" />
      <circle cx="32" cy="32" r="4.5" fill="#F0A33A" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={36} />
      <span className="font-display text-xl font-semibold tracking-tight">
        Koya Clinic
      </span>
    </span>
  );
}
