import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState, lazy, Suspense } from "react";

import { AdminAuditLogsTab } from "@/components/admin/AdminAuditLogsTab";
import { AdminContentTab } from "@/components/admin/AdminContentTab";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { AdminModerationTab } from "@/components/admin/AdminModerationTab";
import { AdminPayoutsTab } from "@/components/admin/AdminPayoutsTab";
import { AdminSystemSettingsTab } from "@/components/admin/AdminSystemSettingsTab";
import { AdminUsersTab } from "@/components/admin/AdminUsersTab";
import { getAdminOverview } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-state";
import { supabase } from "@/integrations/supabase/client";
import { currentUser } from "@/lib/profile-service";
import type { AdminOverviewData, UserRole } from "@/lib/types";
import { cn } from "@/lib/utils";


const AdminOverviewTab = lazy(() => import("@/components/admin/AdminOverviewTab").then((m) => ({ default: m.AdminOverviewTab })));

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin Console — Spaces1" },
      { name: "description", content: "Moderation queue, user management, content review, audit logs and platform settings for Spaces administrators." },
      { property: "og:title", content: "Admin Console — Spaces1" },
      { property: "og:description", content: "Moderation, users, content, audit logs and platform settings." },
      { property: "og:type", content: "website" },
      { name: "robots", content: "noindex" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminPage,
});

const TABS = ["overview", "users", "content", "moderation", "withdrawals", "audit", "settings"] as const;

function AdminPage() {
  const { user } = useAuth();
  const profile = user || currentUser;
  const [activeRole, setActiveRole] = useState<UserRole>("moderator");
  const [tab, setTab] = useState<(typeof TABS)[number]>("overview");
  const [overview, setOverview] = useState<AdminOverviewData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [access, setAccess] = useState<"checking" | "granted" | "denied">("checking");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Access is decided by the account's real role on the server. There are
      // no name, email or "allow anyway" shortcuts.
      const { data: sessionData } = await supabase.auth.getUser();
      const authUserId = sessionData?.user?.id;
      if (!authUserId) {
        if (!cancelled) setAccess("denied");
        return;
      }

      try {
        const [{ data: isAdmin }, { data: isMod }] = await Promise.all([
          supabase.rpc("has_role", { _user_id: authUserId, _role: "admin" }),
          supabase.rpc("has_role", { _user_id: authUserId, _role: "moderator" }),
        ]);
        if (cancelled) return;
        if (isAdmin) {
          setActiveRole("admin");
          setAccess("granted");
        } else if (isMod) {
          setActiveRole("moderator");
          setAccess("granted");
        } else {
          setAccess("denied");
        }
      } catch {
        if (!cancelled) setAccess("denied");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setOverview(await getAdminOverview());
    } catch {
      setOverview(null);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (access === "granted") void load();
  }, [load, access]);

  if (access !== "granted") {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand/10 text-brand">
          <ShieldCheck className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-extrabold sm:text-3xl">
          {access === "checking" ? "Checking access…" : "Admin access required"}
        </h1>
        {access === "checking" ? (
          <div className="h-2 w-32 animate-pulse rounded-full bg-foreground/10" />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              This console is limited to Spaces1 administrators and moderators. Sign in with an
              account that has been given access to continue.
            </p>
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
              <Link
                to="/auth"
                className="min-h-[44px] rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90"
              >
                Sign in
              </Link>
              <Link
                to="/feed"
                className="min-h-[44px] rounded-full border border-border px-5 py-2.5 text-sm font-bold text-muted-foreground transition-colors hover:bg-foreground/5"
              >
                Back to feed
              </Link>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-3 py-5 sm:px-4 sm:py-6">
      <AdminHeader
        currentProfile={profile}
        activeRole={activeRole}
        onRoleChange={(next) => {
          // Staff can only preview access levels at or below their own; the
          // server re-checks the real role on every action regardless.
          if (activeRole === "admin") setActiveRole(next);
        }}
        systemHealth={overview?.stats.system_health}
        onRefresh={load}
        isRefreshing={refreshing}
      />

      <div className="mb-6 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "shrink-0 rounded-full border px-4 py-2 text-xs font-bold capitalize transition-colors min-h-[36px] cursor-pointer",
              tab === t ? "border-brand bg-brand/10 text-brand" : "border-border text-muted-foreground hover:bg-foreground/5",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "overview" && overview && (
        <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-muted/40" />}>
        <AdminOverviewTab overview={overview} activeRole={activeRole} onNavigateTab={(t) => setTab(t as any)} />
        </Suspense>
      )}
      {tab === "users" && <AdminUsersTab activeRole={activeRole} currentUserId={profile.id} />}
      {tab === "content" && <AdminContentTab activeRole={activeRole} currentUserId={profile.id} />}
      {tab === "moderation" && <AdminModerationTab activeRole={activeRole} currentUserId={profile.id} />}
      {tab === "withdrawals" && <AdminPayoutsTab />}
      {tab === "audit" && <AdminAuditLogsTab activeRole={activeRole} />}
      {tab === "settings" && <AdminSystemSettingsTab activeRole={activeRole} currentUserId={profile.id} />}
    </div>
  );
}
