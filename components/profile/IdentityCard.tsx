"use client";

interface IdentityCardProps {
  fullName: string;
  email: string | null;
  employeeId: string;
  jobTitle: string | null;
}

const BadgeIcon = () => (
  <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 7V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2" />
    <path d="M3 7v10a2 2 0 0 0 2 2h6" />
    <circle cx="9" cy="10" r="2" />
    <path d="M7 17v-1.5a2.5 2.5 0 0 1 5 0V17" />
    <path d="M16 13h6" />
    <path d="M16 17h6" />
    <path d="M13 21h8" />
  </svg>
);

const ExternalLinkIcon = () => (
  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

interface FieldRowProps {
  label: string;
  children: React.ReactNode;
  isLast?: boolean;
}

function FieldRow({ label, children, isLast }: FieldRowProps) {
  return (
    <div
      className="flex items-start gap-3 px-[22px] py-2.5 transition-colors hover:bg-surface"
      style={{
        borderBottom: isLast ? undefined : "1px solid var(--border-color)",
      }}
    >
      <span
        className="shrink-0 text-[11.5px] font-semibold uppercase tracking-wide text-text-muted"
        style={{ minWidth: "110px", letterSpacing: "0.03em" }}
      >
        {label}
      </span>
      <div className="flex-1 text-[13.5px] text-text-primary">{children}</div>
    </div>
  );
}

export function IdentityCard({ fullName, email, employeeId, jobTitle }: IdentityCardProps) {
  return (
    <div
      className="overflow-hidden rounded-ds-panel bg-white"
      style={{
        boxShadow: "var(--shadow-card)",
        border: "1px solid var(--border-color)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-[22px] py-4"
        style={{ borderBottom: "1px solid var(--border-color)" }}
      >
        <div
          className="flex h-8 w-8 items-center justify-center rounded-[9px]"
          style={{ backgroundColor: "#f3f3f3" }}
        >
          <span style={{ color: "var(--accent)" }}>
            <BadgeIcon />
          </span>
        </div>
        <h2 className="font-display text-[15px] font-semibold text-text-primary">
          Identity &amp; Contact
        </h2>
      </div>

      {/* Fields */}
      <div>
        <FieldRow label="Full Name">
          <span className="font-semibold" style={{ color: "var(--navy)" }}>
            {fullName}
          </span>
        </FieldRow>
        <FieldRow label="Email">
          {email ? (
            <a
              href={`mailto:${email}`}
              className="inline-flex items-center gap-1.5 text-accent hover:underline"
            >
              {email}
              <ExternalLinkIcon />
            </a>
          ) : (
            <span className="text-text-muted italic">Not available</span>
          )}
        </FieldRow>
        <FieldRow label="Employee ID">
          <code
            className="rounded-[5px] px-2 py-0.5 text-[11.5px] font-mono"
            style={{
              backgroundColor: "#f3f3f3",
              border: "1px solid var(--border-color)",
            }}
          >
            {employeeId}
          </code>
        </FieldRow>
        <FieldRow label="Job Title" isLast>
          {jobTitle || <span className="text-text-muted italic">Not assigned</span>}
        </FieldRow>
      </div>
    </div>
  );
}
