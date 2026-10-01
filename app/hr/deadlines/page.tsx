import { PowerAppsShell } from "@/components/hr-deadlines/power-apps-shell";
import { DashboardToolbar } from "@/components/hr-deadlines/dashboard-toolbar";
import {
  KanbanPanel,
  type KanbanRowLeave,
  type KanbanRowEmployment,
} from "@/components/hr-deadlines/kanban-panel";

const SICK_LEAVES_ROWS: KanbanRowLeave[] = [
  { type: "leave", id: "1", days: "1.0 d", label: "Sick", status: "In Progress", avatarNumber: 1 },
  { type: "leave", id: "2", days: "2.0 d", label: "Sick", status: "In Progress", avatarNumber: 2 },
  { type: "leave", id: "3", days: "0.5 d", label: "Sick", status: "In Progress", avatarNumber: 3 },
];

const VACATION_ROWS: KanbanRowLeave[] = [
  { type: "leave", id: "v1", days: "2.0 d", label: "Vacation", status: "Pending", avatarNumber: 1 },
  { type: "leave", id: "v2", days: "15.0 d", label: "Vacation", status: "Pending", avatarNumber: 2 },
  { type: "leave", id: "v3", days: "5.0 d", label: "Vacation", status: "Pending", avatarNumber: 3 },
];

const PROBATION_ROWS: KanbanRowEmployment[] = [
  {
    type: "employment",
    id: "e1",
    name: "Palmer, Novea",
    date: "Jan 15, 2026",
    subtitle: "Contract worker · Full time",
    avatarInitials: "NP",
    avatarColorIndex: 0,
  },
  {
    type: "employment",
    id: "e2",
    name: "Chen, Wei",
    date: "Feb 1, 2026",
    subtitle: "Full time",
    avatarInitials: "WC",
    avatarColorIndex: 1,
  },
];

const ENDING_ROWS: KanbanRowEmployment[] = [
  {
    type: "employment",
    id: "end1",
    name: "Smith, John",
    date: "Mar 31, 2026",
    subtitle: "Contract end",
    avatarInitials: "JS",
    avatarColorIndex: 2,
    value: "40.00",
  },
  {
    type: "employment",
    id: "end2",
    name: "Davis, Sarah",
    date: "Mar 15, 2026",
    subtitle: "Contract end",
    avatarInitials: "SD",
    avatarColorIndex: 3,
    value: "40.00",
  },
];

export default function HRDeadlinesPage() {
  return (
    <PowerAppsShell>
      <div className="rounded-sm bg-white border border-ms-border overflow-hidden">
        <div className="border-b border-ms-border px-4 py-3">
          <h1 className="text-[20px] font-semibold text-ms-text flex items-center gap-1">
            HR Deadline Dashboard
            <button
              type="button"
              className="p-1 rounded hover:bg-ms-hover"
              aria-label="Dashboard options"
            >
              <svg
                className="h-4 w-4 text-ms-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
          </h1>
        </div>
        <DashboardToolbar />
      </div>

      <div className="mt-4 flex gap-4 overflow-x-auto pb-4 min-h-[400px]">
        <KanbanPanel
          title="Sick Leaves - Not Yet Returned E..."
          filtered
          count={25}
          sortLabel="Modified On"
          variant="leave"
          rows={SICK_LEAVES_ROWS}
          activeBorder
        />
        <KanbanPanel
          title="Leave Requests - Vacation - Pen..."
          filtered
          count={63}
          sortLabel="Modified On"
          variant="leave"
          rows={VACATION_ROWS}
        />
        <KanbanPanel
          title="Employment Terms - Probatio..."
          filtered={false}
          count={4}
          sortLabel="Modified On"
          variant="employment"
          rows={PROBATION_ROWS}
          activeBorder
        />
        <KanbanPanel
          title="Employment Terms - Ending i..."
          filtered={false}
          count={12}
          sortLabel="Modified On"
          variant="employment"
          rows={ENDING_ROWS}
        />
        <KanbanPanel
          title="Employees leaving next 6 months"
          filtered={false}
          count={0}
          variant="empty"
          rows={[]}
        />
      </div>
    </PowerAppsShell>
  );
}
