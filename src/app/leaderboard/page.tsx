"use client";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/providers/AuthProvider";
import { Avatar, EmptyState, Notice, Panel, Spinner, cx } from "@/components/ui/primitives";
import { api, type LeaderboardRow, type MyRoom } from "@/lib/api";
import { toAppError } from "@/lib/errors";

export default function LeaderboardPage() {
  const { session } = useAuth();
  const [scope, setScope] = useState<string>("all");
  const [rooms, setRooms] = useState<MyRoom[]>([]);
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    api.myRooms().then(setRooms).catch(() => undefined);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    setRows(null);
    api
      .leaderboard(scope === "all" ? null : scope)
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((e) => setError(toAppError(e).message));
  }, [scope, session]);

  return (
    <AppShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-semibold">Classement</h1>
          <p className="mt-1 text-sm text-fog">Classement privé des joueurs de cette instance, par victoires puis score.</p>
        </div>
        {rooms.length ? (
          <label className="block space-y-2">
            <span className="text-sm">Périmètre</span>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="h-12 w-full rounded-[var(--radius-control)] bg-slate px-3 text-ivory outline-none focus:ring-1 focus:ring-volt"
            >
              <option value="all">Tous les joueurs</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  Membres de « {r.name} »
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {rows === null && !error ? (
          <Spinner />
        ) : rows && rows.length === 0 ? (
          <EmptyState title="Classement vide">Il se remplira après les premières parties terminées.</EmptyState>
        ) : rows ? (
          <Panel className="p-0 sm:p-0">
            <ol className="divide-y divide-line">
              {rows.map((r, i) => (
                <li key={r.id} className={cx("flex items-center gap-3 px-4 py-3", r.id === session?.user.id && "bg-volt-soft")}>
                  <span className={cx("num w-6 text-center", i < 3 ? "text-ivory" : "text-fog")}>{i + 1}</span>
                  <Avatar avatar={r.avatar} size={34} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{r.username}</p>
                    <p className="text-xs text-fog">
                      {r.games_played} parties · {r.win_rate} % de victoires · {r.captures} captures
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="num">{r.wins}</p>
                    <p className="text-xs text-fog">{r.total_score} pts</p>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        ) : null}
      </div>
    </AppShell>
  );
}
