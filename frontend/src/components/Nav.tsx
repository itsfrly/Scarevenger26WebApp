import { NavLink } from "react-router-dom";
import { ClipboardList, Film, Gavel, Settings, Trophy } from "lucide-react";
import { cn } from "@/lib/cn";
import { useEventState } from "@/lib/queries";

const base =
  "flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition";

export default function Nav({ groups }: { groups: string[] }) {
  const isJudge = groups.includes("judges") || groups.includes("admins");
  const isAdmin = groups.includes("admins");
  // Only appears once the hunt is over, so it is not a dead tab all evening.
  const ended = useEventState().data?.phase === "ended";

  return (
    // Fixed bottom bar with safe-area padding: thumbs reach the bottom of a
    // phone, not the top.
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-800 bg-zinc-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto flex w-full max-w-lg">
        <Item to="/challenges" label="Hunt" icon={<ClipboardList className="size-5" />} />
        <Item to="/scoreboard" label="Scores" icon={<Trophy className="size-5" />} />
        {ended && <Item to="/slideshow" label="Replay" icon={<Film className="size-5" />} />}
        {isJudge && <Item to="/judge" label="Judge" icon={<Gavel className="size-5" />} />}
        {isAdmin && <Item to="/admin" label="Admin" icon={<Settings className="size-5" />} />}
      </div>
    </nav>
  );
}

function Item({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(base, isActive ? "text-orange-400" : "text-zinc-500")
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}
