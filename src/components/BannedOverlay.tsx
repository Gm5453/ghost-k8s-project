import { Ban, LogOut } from "lucide-react";

export function BannedOverlay({ username, onLogout }: { username: string; onLogout: () => void }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background/80 backdrop-blur-xl animate-fade-in">
      <div className="mx-4 w-full max-w-md rounded-2xl border border-destructive/30 bg-card/95 p-6 text-center shadow-elegant animate-scale-in">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/15 text-destructive">
          <Ban className="h-7 w-7" />
        </div>
        <h2 className="text-xl font-semibold">You are banned</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The account <span className="font-semibold text-foreground">{username}</span> has been banned
          from tt350. You can't read or post until an admin lifts the ban.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          This screen will disappear automatically the moment you're unbanned.
        </p>
        <button
          onClick={onLogout}
          className="mt-5 inline-flex items-center gap-2 rounded-md border border-border bg-muted px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted/70"
        >
          <LogOut className="h-4 w-4" /> Log out
        </button>
      </div>
    </div>
  );
}
