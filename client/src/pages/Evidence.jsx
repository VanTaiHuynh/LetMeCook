import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import { useState } from "react";
import { FaCheck, FaDownload, FaRegChartBar } from "react-icons/fa";
import KitchenShell from "../components/KitchenShell";
import { useKitchen, useKitchenResource } from "../utils/useKitchen";

const count = value => Number.isFinite(value) ? String(value) : "—";

const cohortReasons = {
  notEnrolled: 'This household is not enrolled.',
  notMature: 'Week 4 results appear after 28 days.',
  withdrawn: 'This study was withdrawn. Its activity rate is unavailable.',
  incomplete: 'Missing consent or records. The rate is unknown, rather than zero.',
  expired: 'This study expired. New activity cannot rebuild its results.',
};

function NamedCohort({ consent }) {
  const { data, householdId, isOwner, mutate, busy, setError } = useKitchen();
  const [name, setName] = useState('');
  const [selectedName, setSelectedName] = useState('');
  const [enrollConfirmed, setEnrollConfirmed] = useState(false);
  const [withdrawConfirmed, setWithdrawConfirmed] = useState(false);
  const resource = useKitchenResource(householdId ? `/evidence${selectedName ? `?cohortName=${encodeURIComponent(selectedName)}` : ''}` : null);
  const cohort = resource.data?.cohort;
  const fixed = resource.data?.fixedCohort;
  const cohortMatches = !selectedName || cohort?.name === selectedName;
  const enroll = async event => {
    event.preventDefault();
    const clean = name.trim();
    if (!enrollConfirmed || !clean || clean.length > 100) { setError('Enter a study name and confirm enrollment.'); return; }
    if (!consent?.enabled) { setError('Turn on meal recording before enrolling this household.'); return; }
    const result = await mutate('Enroll named household cohort', '/cohorts/enroll', { cohortName: clean, confirmed: true });
    if (result) { setSelectedName(result.cohort?.name || clean.toLowerCase()); setEnrollConfirmed(false); resource.reload(); }
  };
  const withdraw = async () => {
    if (!withdrawConfirmed || !cohort || !cohortMatches || resource.loading || resource.error) return;
    if (await mutate('Withdraw named cohort', `/cohorts/${cohort.id}/withdraw`, { confirmed: true })) { setWithdrawConfirmed(false); resource.reload(); }
  };
  return <section className="kitchen-panel"><h2>28-day household activity</h2>
    {!householdId ? <p className="kitchen-empty-small">Choose a household to view or start a study.</p> : <>
      <Field>View household study<select value={selectedName} disabled={!!busy} onChange={event => { setSelectedName(event.target.value); setWithdrawConfirmed(false); }}><option value="">Most recent enrollment</option>{(data.cohorts || []).map(item => <option value={item.name} key={item.id}>{item.name} · {item.state}</option>)}</select></Field>
      {resource.loading ? <p role="status">Loading study…</p> : resource.error ? <div className="kitchen-error"><p>{resource.error}</p><Button className="kitchen-secondary" type="button" onClick={resource.reload}>Reload study</Button></div> : <>
        {cohort && <div className="kitchen-note"><strong>{cohort.name}</strong><p>Enrolled {new Date(cohort.enrolledAt).toLocaleString('en', { timeZone: 'UTC' })} UTC · {cohort.state}.</p></div>}
        <div className="kitchen-metrics kitchen-cohort-metrics"><div><strong>{count(fixed?.eligibleHouseholds)}</strong><span>Eligible household</span></div><div><strong>{count(fixed?.retainedHouseholds)}</strong><span>Active in week 4</span></div><div><strong>{Number.isFinite(fixed?.week4Retention) ? `${(fixed.week4Retention * 100).toFixed(1)}%` : '—'}</strong><span>Week 4 activity rate</span></div></div>
        {fixed?.reason && <p className="kitchen-note">{cohortReasons[fixed.reason] || 'No activity rate is available yet.'}</p>}
        <details className="kitchen-details"><summary>How this is measured</summary><p>Week 4 covers days 22–28 after enrollment, in UTC. The rate becomes available after 28 full days.</p>{fixed?.windowStart && fixed?.windowEnd && <p className="kitchen-help">{new Date(fixed.windowStart).toLocaleString('en', { timeZone: 'UTC' })} – {new Date(fixed.windowEnd).toLocaleString('en', { timeZone: 'UTC' })} UTC</p>}{fixed?.explanation && <p className="kitchen-help">{fixed.explanation}</p>}{cohort && <p className="kitchen-help">Study details expire {new Date(cohort.expiresAt).toLocaleDateString('en', { timeZone: 'UTC' })}. Release {cohort.releaseVersion} · consent {cohort.consentVersion}.</p>}</details>
      </>}
      {isOwner ? <details className="kitchen-disclosure kitchen-disclosure-secondary"><summary>Enroll this household</summary><form className="kitchen-cohort-form" onSubmit={enroll}><Field>Study name<input maxLength="100" required value={name} disabled={!!busy} onChange={event => { setName(event.target.value); setEnrollConfirmed(false); }} placeholder="October kitchen study" /></Field><Field className="kitchen-checkbox"><input type="checkbox" required checked={enrollConfirmed} disabled={!!busy || !consent?.enabled} onChange={event => setEnrollConfirmed(event.target.checked)} /><span>Enroll this household for 28 days. Study details are kept for 90 days. Each person chooses whether to record meals.</span></Field>{!consent?.enabled && <p className="kitchen-help">Turn on meal recording above before enrolling.</p>}<Button className="kitchen-primary" type="submit" disabled={!!busy || !enrollConfirmed || !consent?.enabled}>Enroll household</Button><p className="kitchen-help">A later study needs a new enrollment.</p></form></details> : <p className="kitchen-help">Only the owner can enroll or withdraw this household.</p>}
      {isOwner && cohort?.state === 'active' && cohortMatches && !resource.loading && !resource.error && <div className="kitchen-cohort-form"><h3>Withdraw from study</h3><Field className="kitchen-checkbox"><input type="checkbox" checked={withdrawConfirmed} disabled={!!busy} onChange={event => setWithdrawConfirmed(event.target.checked)} /><span>Withdraw from {cohort.name}. Its activity rate will become unavailable.</span></Field><Button className="kitchen-secondary kitchen-danger" type="button" disabled={!!busy || !withdrawConfirmed} onClick={withdraw}>Withdraw household</Button></div>}
    </>}
  </section>;
}

function EvidenceContent() {
  const { data, mutate, busy, setNotice } = useKitchen();
  const resource = useKitchenResource("/evidence");
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const evidence = resource.data;
  const consent = evidence?.consent || data.consent;
  const toggleConsent = async () => { if (await mutate("Update evidence consent", "/consent", { enabled: !consent?.enabled })) resource.reload(); };
  const remove = async () => { if (await mutate("Delete my evidence and revoke consent", "/evidence", undefined, "DELETE")) { setDeleteConfirmed(false); resource.reload(); } };
  const exportEvidence = async () => {
    const result = await mutate('Export my evidence', '/evidence/export', undefined, 'GET', false);
    if (!result) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `letmecook-my-evidence-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(result.truncated ? 'Records downloaded. The file includes the first 10,000 retained events.' : 'Your records downloaded.');
  };
  const weeklyMaximum = Math.max(1, ...(evidence?.weekly || []).map(week => week.confirmedMeals || 0));
  return <>
    <section className="kitchen-panel kitchen-evidence-consent"><div><h2>Meal recording</h2><p>Record meals you confirm. Planning and AI replies don’t count.</p><p className="kitchen-note">Your choice is personal. Meal records are kept for 90 days, separately from cooking sessions and stock.</p></div><div><span className="kitchen-badge">{consent?.enabled ? "Recording enabled" : "Recording disabled"}</span><Button type="button" className="kitchen-primary" disabled={!!busy} onClick={toggleConsent}>{consent?.enabled ? "Turn off recording" : "Turn on recording"}</Button>{consent?.updatedAt && <small>Updated {new Date(consent.updatedAt).toLocaleString("en")}</small>}</div></section>
    {resource.loading ? <div className="kitchen-empty" role="status">Loading meals…</div> : resource.error ? <div className="kitchen-error"><p>{resource.error}</p><Button type="button" className="kitchen-secondary" onClick={resource.reload}>Reload meals</Button></div> : evidence && <>
      <div className="kitchen-grid-two kitchen-activity-workspace"><section className="kitchen-panel"><div className="kitchen-panel-heading"><div><h2>Confirmed meals</h2>{evidence.period?.start && evidence.period?.end && <p>{evidence.period.start} – {evidence.period.end}</p>}</div><FaRegChartBar aria-hidden="true" /></div><div className="kitchen-metrics kitchen-activity-metrics"><div><strong>{count(evidence.confirmedMeals)}</strong><span>Confirmed meals</span></div><div><strong>{count(evidence.activeDays)}</strong><span>Days with confirmations</span></div></div><details className="kitchen-details"><summary>About these totals</summary><p>Totals include meal confirmations from the last 90 days while recording is enabled. Days and weeks use UTC. Expired records are excluded and removed in scheduled batches.</p>{evidence.releaseVersion && <p className="kitchen-help">Recorded release: {evidence.releaseVersion}</p>}</details></section>
      <section className="kitchen-panel"><h2>Meals by week</h2>{evidence.weekly?.length ? <ul className="kitchen-weekly-chart">{evidence.weekly.map(week => <li key={week.week}><span>{week.week}</span><div><span style={{ width: `${Math.max(0, week.confirmedMeals) / weeklyMaximum * 100}%` }} /></div><strong>{week.confirmedMeals}</strong></li>)}</ul> : <div className="kitchen-empty-small"><FaCheck aria-hidden="true" />No meals recorded yet. Turn on recording and confirm a cooked meal.</div>}</section></div>
    </>}
    <NamedCohort consent={consent}/>
    <div className="kitchen-grid-two kitchen-evidence-records"><section className="kitchen-panel"><h2>My records</h2><p>Download your meal and consent records across your kitchens. Only your records are included.</p><Button className="kitchen-secondary" type="button" disabled={!!busy} onClick={exportEvidence}><FaDownload aria-hidden="true" />Download records (JSON)</Button></section>
    <section className="kitchen-panel kitchen-danger-zone"><h2>Delete my records</h2><p>Delete your meal records and turn recording off. Recipes, stock, households and cooking sessions remain.</p><Field className="kitchen-checkbox"><input type="checkbox" checked={deleteConfirmed} disabled={!!busy} onChange={event => setDeleteConfirmed(event.target.checked)} />Delete my meal records and turn recording off.</Field><Button className="kitchen-secondary kitchen-danger" type="button" disabled={!!busy || !deleteConfirmed} onClick={remove}>Delete my records</Button></section></div>
  </>;
}

export default function Evidence() { return <KitchenShell title="Cooking activity" intro="See your confirmed meals and manage recording."><EvidenceContent /></KitchenShell>; }
