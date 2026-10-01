export default function TeamReviewsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-ds-page-title text-ds-text-primary">Team Reviews</h1>
        <p className="text-muted-foreground">
          Review and approve appraisals for your direct reports.
        </p>
      </div>
      <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
        Team review queue and approval workflow will be implemented with Supabase
        and reporting lines from Dynamics 365.
      </div>
    </div>
  );
}
