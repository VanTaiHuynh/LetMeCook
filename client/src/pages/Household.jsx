import PreferenceSharing from "../features/growth/PreferenceSharing";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import KitchenShell from "../components/KitchenShell";
import { useKitchen, useKitchenResource } from "../utils/useKitchen";

function SharedShopping() {
  const { mutate, busy, canEdit } = useKitchen();
  const resource = useKitchenResource("/shopping");
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [newItem, setNewItem] = useState({ ingredient: "", quantityText: "" });
  useEffect(() => { if (resource.data && !dirtyRef.current) setDraft(resource.data); }, [resource.data]);
  const change = value => { setDraft(value); dirtyRef.current = true; setDirty(true); };
  const save = async () => {
    const result = await mutate("Save shared shopping", "/shopping", { version: draft.version || 0, items: draft.items, planWeekStart: draft.planWeekStart || null }, "PUT");
    if (result) { setDraft(result); dirtyRef.current = false; setDirty(false); resource.reload(); }
  };
  return <section className="kitchen-panel kitchen-shopping-panel"><div className="kitchen-panel-heading"><div><h2>Shopping list</h2><p>Check off what you have or bought.</p></div>{dirty && <span className="kitchen-badge">Unsaved</span>}</div>
    {resource.loading && !draft ? <p role="status">Loading shopping list…</p> : resource.error ? <div className="kitchen-error"><p>{resource.error}</p><Button type="button" className="kitchen-secondary" onClick={resource.reload}>Retry shopping</Button></div> : draft && <>
      {draft.planWeekStart && <p className="kitchen-note">From the dinner plan starting {draft.planWeekStart}.</p>}
      {dirty && resource.data?.version !== draft.version && <div className="kitchen-note">Someone updated this list. Your edits are still here.<Button className="kitchen-text-button" type="button" disabled={!!busy} onClick={() => { setDraft(resource.data); dirtyRef.current = false; setDirty(false); }}>Replace my draft with latest list</Button></div>}
      <p className="kitchen-help">{draft.items.filter(item => item.checked).length} of {draft.items.length} checked</p>
      {draft.items.length ? <ul className="kitchen-shopping-list">{draft.items.map(item => <li key={item.key}><Field className="kitchen-checkbox"><input type="checkbox" disabled={!canEdit || !!busy} checked={item.checked} onChange={event => change({ ...draft, items: draft.items.map(row => row.key === item.key ? { ...row, checked: event.target.checked } : row) })} /><span><strong>{item.ingredient}</strong><small>{item.quantityText}</small></span></Field>{canEdit && <Button className="kitchen-text-button" type="button" disabled={!!busy} onClick={() => change({ ...draft, items: draft.items.filter(row => row.key !== item.key) })}>Remove</Button>}</li>)}</ul> : <p className="kitchen-empty-small">Add an item or share groceries from your dinner plan.</p>}
      {canEdit && <><form className="kitchen-inline-form" onSubmit={event => { event.preventDefault(); change({ ...draft, items: [...draft.items, { key: `manual:${crypto.randomUUID()}`, ingredient: newItem.ingredient.trim(), quantityText: newItem.quantityText.trim(), checked: false }] }); setNewItem({ ingredient: "", quantityText: "" }); }}><Field>Ingredient<input value={newItem.ingredient} maxLength="100" required disabled={!!busy} onChange={event => setNewItem({ ...newItem, ingredient: event.target.value })} /></Field><Field>Amount or note<input value={newItem.quantityText} maxLength="200" required disabled={!!busy} onChange={event => setNewItem({ ...newItem, quantityText: event.target.value })} placeholder="200 g, check recipe…" /></Field><Button className="kitchen-secondary" type="submit" disabled={!!busy}>Add item</Button></form><div className="kitchen-actions kitchen-action-bar"><Button type="button" className="kitchen-primary" disabled={!!busy || !dirty} onClick={save}>Save list</Button><Button type="button" className="kitchen-secondary" disabled={!!busy} onClick={resource.reload}>Check for updates</Button></div></>}
    </>}
  </section>;
}

function HouseholdContent() {
  const { data, householdId, mutate, busy, isOwner, collaborationEnabled, selectScope, setNotice } = useKitchen();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [inviteRole, setInviteRole] = useState("editor");
  const [invite, setInvite] = useState(null);
  const members = useKitchenResource(householdId ? `/households/${householdId}/members` : null);
  const create = async event => { event.preventDefault(); const result = await mutate("Create household", "/households", { name: name.trim() }); if (result) { setName(""); selectScope(result.id); } };
  const accept = async event => { event.preventDefault(); const result = await mutate("Accept invitation", "/invites/accept", { code: code.trim() }); if (result) { setCode(""); selectScope(result.id); } };
  const copy = async () => { try { await navigator.clipboard.writeText(invite.code); setNotice("Invite copied. Share it with the person you’re inviting."); } catch { setNotice("Select and copy the code below."); } };
  return <>
    {!collaborationEnabled && <p className="kitchen-note">Invitations and shared editing are paused. Members can view; owners can edit.</p>}
    <div className="kitchen-workspace kitchen-household-workspace"><div className="kitchen-task-main"><SharedShopping /></div><aside className="kitchen-context" aria-label="Household management">
      <section className="kitchen-panel kitchen-household-setup" id="household-setup"><details className="kitchen-disclosure" open={!data.households?.length}><summary>Create or join a household</summary><div className="kitchen-grid-two kitchen-setup-grid"><div className="kitchen-setup-form"><h3>Create a household</h3><p>Share a pantry and shopping list.</p><form onSubmit={create}><Field>Household name<input maxLength="100" value={name} required disabled={!!busy} onChange={event => setName(event.target.value)} placeholder="Our kitchen" /></Field><Button className="kitchen-primary" type="submit" disabled={!!busy}>Create household</Button></form></div><div className="kitchen-setup-form"><h3>Join with an invite</h3><p>Enter the code from your household’s owner.</p><form onSubmit={accept}><Field>Invite code<input value={code} maxLength="200" required disabled={!!busy || !collaborationEnabled} onChange={event => setCode(event.target.value)} autoComplete="off" /></Field><Button className="kitchen-primary" type="submit" disabled={!!busy || !collaborationEnabled}>Accept invitation</Button></form></div></div></details></section>
    {householdId ? <section className="kitchen-panel"><div className="kitchen-panel-heading"><div><h2>{data.scope?.name}</h2><p>Editors can change stock and lists. Viewers can read.</p></div><span className="kitchen-badge">{data.scope?.role}</span></div>
      {members.loading ? <p role="status">Loading members…</p> : members.error ? <div className="kitchen-error"><p>{members.error}</p><Button className="kitchen-secondary" type="button" onClick={members.reload}>Retry members</Button></div> : <ul className="kitchen-simple-list">{members.data?.members?.map(member => <li key={member.userId}><span><strong>{member.name || "Household member"}</strong><small>{member.role}</small></span>{isOwner && member.role !== "owner" && <Field>Access<select value={member.role} disabled={!!busy || !collaborationEnabled} onChange={async event => { await mutate("Update member role", `/households/${householdId}/members/${member.userId}`, { role: event.target.value }, "PATCH"); }}><option value="editor">Editor</option><option value="viewer">Viewer</option></select></Field>}</li>)}</ul>}
      {isOwner && <div className="kitchen-invite"><h3>Invite someone</h3><p>Share the code yourself. It works once and expires in seven days.</p><div className="kitchen-inline-form"><Field>New member access<select value={inviteRole} disabled={!!busy || !collaborationEnabled} onChange={event => setInviteRole(event.target.value)}><option value="editor">Editor</option><option value="viewer">Viewer</option></select></Field><Button type="button" className="kitchen-primary" disabled={!!busy || !collaborationEnabled} onClick={async () => { const result = await mutate("Create invite code", `/households/${householdId}/invites`, { role: inviteRole }, undefined, false); if (result) setInvite(result); }}>Create invite code</Button></div>{invite && <div className="kitchen-invite-code"><Field>Share this code<input readOnly value={invite.code} onFocus={event => event.target.select()} /></Field><p>Expires {new Date(invite.expiresAt).toLocaleString("en")}</p><Button className="kitchen-secondary" type="button" onClick={copy}>Copy code</Button></div>}</div>}
    </section> : <section className="kitchen-panel"><h2>Your personal kitchen</h2><p>Choose a household above to use its shared stock and list.</p></section>}
    <PreferenceSharing />
    </aside></div>
    <section className="kitchen-panel"><div className="kitchen-panel-heading"><h2>Recent cooking sessions</h2><Link className="kitchen-text-link" to="/recipes">Choose a recipe</Link></div>{data.recentSessions?.length ? <ul className="kitchen-simple-list">{data.recentSessions.map(session => <li key={session.id}><Link className="kitchen-text-link" to={`/cook-along/${session.id}${householdId ? `?householdId=${householdId}` : ""}`}>{session.recipeTitle || "Cooking session"}</Link><span className="kitchen-badge">{session.status}</span></li>)}</ul> : <p className="kitchen-empty-small">Choose a recipe to start cooking.</p>}</section>
  </>;
}

export default function Household() { return <KitchenShell title="Household" intro="Share stock, groceries and cooking with your household."><HouseholdContent /></KitchenShell>; }
