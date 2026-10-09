import Alert from "../components/ui/Alert";
import Button from "../components/ui/Button";
import { useEffect, useState } from "react";
import { ownProfile } from "../utils/accountApi";
import { useAuth } from "../context/AuthContext";
import { Link, Navigate } from "react-router-dom";

function ProfileContent({ user }) {
  const [profile, setProfile] = useState(null);
  const [allergyNames, setAllergyNames] = useState([]);
  const [error, setError] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [loadVersion, setLoadVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const fetchProfile = async () => {
      setProfileLoading(true);
      setError(null);
      try {
      const data = await ownProfile({ signal: controller.signal, actorId: user.id });
      const names = data.allergyNames.map(name => ({ name }));
      if (active) {
        setProfile(data);
        setAllergyNames(names);
      }
      } catch (error) {
        if (active) setError(error.message || 'Could not load your profile. Please try again.');
      } finally {
        if (active) setProfileLoading(false);
      }
    };

    fetchProfile();
    return () => { active = false; controller.abort(); };
  }, [user.id, loadVersion]);

  if (profileLoading) return <main className="product-page product-profile-page profile-container"><h1 className="product-page-title">My profile</h1><p role="status">Loading your profile…</p></main>;
  if (error || !profile) return <main className="product-page product-profile-page profile-container"><h1 className="product-page-title">My profile</h1><Alert as="p" className="error-message">{error || 'Your profile is unavailable.'}</Alert><Button type="button" className="product-edit-toggle" onClick={() => setLoadVersion((version) => version + 1)}>Try again</Button></main>;

  return (
    <main className="product-page product-profile-page profile-container">
      <header className="account-page-header lmc-page-header"><div><h1 className="product-page-title">My profile</h1></div><Link to="/edit-profile" className="lmc-button lmc-button--primary">Edit profile</Link></header>
      <div className="profile-panels">
      <section className="account-panel" aria-labelledby="profile-details-title">
      <h2 id="profile-details-title">Personal details</h2>
      {profile.image_url && <img src={profile.image_url} alt="Your profile" className="profile-image" />}
      <dl className="profile-info">
        <div><dt>Name</dt><dd>{`${profile.first_name || ""} ${profile.last_name || ""}`.trim() || "Not set"}</dd></div>
        <div><dt>Email</dt><dd>{profile.email}</dd></div>
        <div><dt>About me</dt><dd>{profile.about_me || "Not set"}</dd></div>
      </dl>
      </section>
      <section className="account-panel" aria-labelledby="profile-preferences-title">
      <h2 id="profile-preferences-title">Cooking preferences</h2>
      <dl className="profile-info">
        <div><dt>Cooking skill</dt><dd>{profile.cooking_skill || "Not set"}</dd></div>
        <div><dt>Dietary preferences</dt><dd>{profile.dietary_pref?.length ? profile.dietary_pref.join(", ") : "None added"}</dd></div>
        <div><dt>Ingredients to avoid</dt><dd>{allergyNames.length ? allergyNames.map(ingredient => ingredient.name).join(", ") : "None added"}</dd></div>
      </dl>
      <Link to="/edit-profile" className="account-panel-link">Update preferences</Link>
      </section>
      </div>
    </main>
  );
}

export default function Profile() {
  const { user, loading } = useAuth();
  if (loading) return <main className="product-page layout-wrapper"><h1 className="product-page-title">My profile</h1><p role="status">Checking your account…</p></main>;
  if (!user) return <Navigate to="/login" state={{ from: { pathname: '/profile' } }} replace/>;
  return <ProfileContent key={user.id} user={user}/>;
}
