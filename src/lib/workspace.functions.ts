/**
 * Server-side workspace invite lifecycle and permission-gated workspace
 * actions. Every privileged action is verified against the caller's real
 * membership role in the database and writes an audit_logs row.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PRIVILEGED_ROLES = ["owner", "admin"];

async function getAdmin() {
  const mod = await import("@/integrations/supabase/client.server");
  return mod.supabaseAdmin as any;
}

async function getActor(context: any) {
  const admin = await getAdmin();
  const { userId } = context;
  const { data: profile } = await admin
    .from("profiles")
    .select("id, email, display_name, username")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (!profile) throw new Error("We couldn't find your profile.");
  return { admin, profile };
}

async function requireMembership(admin: any, workspaceId: string, profileId: string) {
  const { data: member } = await admin
    .from("workspace_members")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", profileId)
    .eq("status", "active")
    .maybeSingle();
  if (!member) throw new Error("You're not an active member of this workspace.");
  return member;
}

function isPrivileged(role: string) {
  return PRIVILEGED_ROLES.includes(String(role || "").toLowerCase());
}

async function requirePrivileged(admin: any, workspaceId: string, profileId: string) {
  const member = await requireMembership(admin, workspaceId, profileId);
  if (!isPrivileged(member.role)) {
    throw new Error("Only the workspace owner or admin can do that.");
  }
  return member;
}

async function audit(
  admin: any,
  actor: { id: string; name: string },
  action: string,
  targetType: string,
  targetId: string,
  details: string,
  severity: "info" | "warning" | "danger" = "info",
) {
  await admin.from("audit_logs").insert({
    actor_id: actor.id,
    actor_name: actor.name,
    actor_role: "workspace_member",
    action,
    target_type: targetType,
    target_id: targetId,
    details,
    severity,
  });
}

/** Invite someone to a workspace. Owners/admins only, respects seat limits. */
export const inviteWorkspaceMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        email: z.string().email(),
        role: z.enum(["Owner", "Admin", "Editor", "Analyst", "Contributor"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { admin, profile } = await getActor(context);
    await requirePrivileged(admin, data.workspaceId, profile.id);

    const { data: workspace } = await admin
      .from("workspaces")
      .select("*")
      .eq("id", data.workspaceId)
      .maybeSingle();
    if (!workspace) throw new Error("That workspace no longer exists.");

    const { data: existingMembers } = await admin
      .from("workspace_members")
      .select("id, email, status")
      .eq("workspace_id", data.workspaceId)
      .in("status", ["active", "invited"]);

    const seatCount = (existingMembers ?? []).length;
    if (seatCount >= Number(workspace.seats_total ?? 3)) {
      throw new Error(`This workspace is full (${workspace.seats_total} seats). Remove a member or upgrade seats first.`);
    }

    const email = data.email.trim().toLowerCase();
    if ((existingMembers ?? []).some((m: any) => String(m.email).toLowerCase() === email)) {
      throw new Error("That person is already a member or has a pending invite.");
    }

    const inviteToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

    const { data: created, error } = await admin
      .from("workspace_members")
      .insert({
        workspace_id: data.workspaceId,
        email,
        name: email.split("@")[0] || "Teammate",
        role: data.role,
        status: "invited",
        invite_token: inviteToken,
        invited_by: profile.id,
        invited_at: new Date().toISOString(),
        expires_at: expiresAt,
      })
      .select("*")
      .maybeSingle();
    if (error || !created) throw new Error(error?.message ?? "Couldn't create that invite.");

    const { data: recipient } = await admin
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .maybeSingle();

    if (recipient?.id) {
      await admin.from("notifications").insert({
        recipient_id: recipient.id,
        actor_id: profile.id,
        type: "workspace_invite",
        entity_type: "workspace_member",
        entity_id: created.id,
        body: `${profile.display_name || profile.username || "Someone"} invited you to join ${workspace.name} as ${data.role}.`,
      });
    }

    await audit(
      admin,
      { id: profile.id, name: profile.display_name || profile.username },
      "workspace.invite",
      "workspace_member",
      created.id,
      `Invited ${email} as ${data.role} to ${workspace.name}`,
    );

    return created;
  });

/** Invites addressed to the signed-in person's own email. */
export const listMyWorkspaceInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { admin, profile } = await getActor(context);
    if (!profile.email) return [];

    const { data: invites } = await admin
      .from("workspace_members")
      .select("*, workspaces(id, name, logo_emoji)")
      .ilike("email", profile.email)
      .eq("status", "invited");

    return (invites ?? []).filter((row: any) => !row.expires_at || new Date(row.expires_at) > new Date());
  });

/** Accept or decline a pending workspace invite addressed to you. */
export const respondToWorkspaceInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ memberId: z.string().uuid(), accept: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { admin, profile } = await getActor(context);

    const { data: member } = await admin
      .from("workspace_members")
      .select("*")
      .eq("id", data.memberId)
      .maybeSingle();
    if (!member) throw new Error("That invite no longer exists.");
    if (String(member.email).toLowerCase() !== String(profile.email ?? "").toLowerCase()) {
      throw new Error("This invite isn't addressed to your account.");
    }
    if (member.status !== "invited") throw new Error("This invite has already been responded to.");
    if (member.expires_at && new Date(member.expires_at) < new Date()) {
      throw new Error("This invite has expired.");
    }

    const patch: Record<string, any> = {
      status: data.accept ? "active" : "declined",
      responded_at: new Date().toISOString(),
    };
    if (data.accept) {
      patch.user_id = profile.id;
      patch.name = profile.display_name || profile.username || member.name;
    }

    const { data: updated, error } = await admin
      .from("workspace_members")
      .update(patch)
      .eq("id", data.memberId)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);

    await admin
      .from("notifications")
      .update({ read: true })
      .eq("entity_type", "workspace_member")
      .eq("entity_id", data.memberId);

    await audit(
      admin,
      { id: profile.id, name: profile.display_name || profile.username },
      data.accept ? "workspace_member.accept" : "workspace_member.decline",
      "workspace_member",
      data.memberId,
      data.accept ? "Accepted workspace invite" : "Declined workspace invite",
    );

    return updated;
  });

/** Change a member's role. Owner/admin only. */
export const updateWorkspaceMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        memberId: z.string().uuid(),
        role: z.enum(["Owner", "Admin", "Editor", "Analyst", "Contributor"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { admin, profile } = await getActor(context);
    await requirePrivileged(admin, data.workspaceId, profile.id);

    const { data: target } = await admin
      .from("workspace_members")
      .select("*")
      .eq("id", data.memberId)
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();
    if (!target) throw new Error("That member no longer exists.");
    if (String(target.role).toLowerCase() === "owner") {
      throw new Error("The workspace owner's role can't be changed here.");
    }

    const { error } = await admin.from("workspace_members").update({ role: data.role }).eq("id", data.memberId);
    if (error) throw new Error(error.message);

    await audit(
      admin,
      { id: profile.id, name: profile.display_name || profile.username },
      "workspace_member.role_change",
      "workspace_member",
      data.memberId,
      `Role changed to ${data.role}`,
    );
    return { ok: true };
  });

/** Remove a member. Owner/admin only; the owner can't be removed this way. */
export const removeWorkspaceMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ workspaceId: z.string().uuid(), memberId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { admin, profile } = await getActor(context);
    await requirePrivileged(admin, data.workspaceId, profile.id);

    const { data: target } = await admin
      .from("workspace_members")
      .select("*")
      .eq("id", data.memberId)
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();
    if (!target) throw new Error("That member no longer exists.");
    if (String(target.role).toLowerCase() === "owner") {
      throw new Error("The workspace owner can't be removed.");
    }

    const { error } = await admin.from("workspace_members").delete().eq("id", data.memberId);
    if (error) throw new Error(error.message);

    await audit(
      admin,
      { id: profile.id, name: profile.display_name || profile.username },
      "workspace_member.remove",
      "workspace_member",
      data.memberId,
      `Removed ${target.email} from workspace`,
      "warning",
    );
    return { ok: true };
  });

/**
 * A workspace's account profile: its details, roster and the owning
 * account's recent posts as a stand-in for workspace-scoped content
 * (see note in the phase report — posts have no workspace_id column).
 */
export const getWorkspaceProfile = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ workspaceId: z.string().uuid() }).parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { admin, profile } = await getActor(context);
    await requireMembership(admin, data.workspaceId, profile.id);

    const [{ data: workspace }, { data: members }] = await Promise.all([
      admin.from("workspaces").select("*").eq("id", data.workspaceId).maybeSingle(),
      admin.from("workspace_members").select("*").eq("workspace_id", data.workspaceId),
    ]);
    if (!workspace) throw new Error("That workspace no longer exists.");

    const { data: posts } = await admin
      .from("posts")
      .select("id, content, created_at, likes_count, comments_count, reposts_count")
      .eq("author_id", workspace.owner_id)
      .order("created_at", { ascending: false })
      .limit(20);

    const analytics = (posts ?? []).reduce(
      (acc: any, p: any) => ({
        likes: acc.likes + Number(p.likes_count ?? 0),
        comments: acc.comments + Number(p.comments_count ?? 0),
        reposts: acc.reposts + Number(p.reposts_count ?? 0),
      }),
      { likes: 0, comments: 0, reposts: 0 },
    );

    return { workspace, members: members ?? [], posts: posts ?? [], analytics };
  });
