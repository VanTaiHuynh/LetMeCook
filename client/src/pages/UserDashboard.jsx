import Alert from "../components/ui/Alert";
import Button from "../components/ui/Button";
import { apiUrl } from "../utils/api";
import { useState, useEffect } from "react";
import { accountRequest } from "../utils/accountApi";
import { useAuth } from "../context/AuthContext";
import { Link, Navigate } from "react-router-dom";

import SearchBar from "./../components/SearchBar-Home";
import CarouselSection from "./../components/CarouselSection";
import MyRecommended from "./../components/MyRecommended";
import { sunnyWelcome as sunnywelcome, chefHat as hat, heart } from "../utils/siteAsset";



function DashboardContent({ user }) {
  const [favouriteCount, setFavouriteCount] = useState(null);
  const [error, setError] = useState(null);
  const [creationCount, setCreationCount] = useState(null);
  const [retry, setRetry] = useState(0);
  const [firstName, setFirstName] = useState("");



  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setFirstName(''); setFavouriteCount(null); setCreationCount(null); setError(null);
    const load = async () => {
      try {
        const summary = await accountRequest('/summary', { signal: controller.signal, actorId: user.id, contractVersion: 'account.v1' });
        if (!current || controller.signal.aborted) return;
        setFirstName(summary.fullName || ''); setFavouriteCount(summary.favoriteCount); setCreationCount(summary.recipeCount);
      } catch (failure) { if (current && !controller.signal.aborted) setError(failure.message); }
    };
    load();
    return () => { current = false; controller.abort(); };
  }, [user.id, retry]);



  return (
    <>
      {user && (
        <main className="product-page product-dashboard-page welcome-section">
          <div className="welcome-wrapper">
            <div className="welcome-card layout-wrapper">
              <section className="welcome-text" aria-label="Find your next meal">
                <h1>
                  Welcome back{firstName && <>, <span>{firstName}</span></>}!
                </h1>
                <div className="search-container">
                  <SearchBar />
                </div>
              </section>
              <aside className="dashboard-kitchen-panel" aria-labelledby="dashboard-kitchen-heading">
              <h2 id="dashboard-kitchen-heading">Make dinner easier</h2>
              <img
                src={sunnywelcome}
                alt="Sunny welcomes you back"
                className="welcome-icon"
              />
              <nav className="dashboard-quick-links" aria-label="Kitchen shortcuts"><Link to="/meal-planner" className="lmc-button lmc-button--primary">Plan your week</Link><Link to="/pantry" className="lmc-button lmc-button--secondary">Open pantry</Link><Link to="/features#next-step" className="lmc-button lmc-button--quiet">Explore your kitchen tools</Link></nav>
              </aside>
            </div>

            {error && <Alert as="p" className="product-status">Some account details could not be loaded: {error} <Button type="button" className="product-edit-toggle" onClick={() => setRetry(value => value + 1)}>Retry account details</Button></Alert>}
            <div className="stat-section">
              <Link to="/favourites" className="stat-card">
                <img src={heart} alt="" className="icon" />
                <div className="stat-text">
                  <strong>{favouriteCount ?? '—'}</strong>
                  <p>Favorites</p>
                </div>
              </Link>



              <div className="separator"></div>

              <Link to="/user-recipe" className="stat-card">
                <img src={hat} alt="" className="icon" />
                <div className="stat-text">
                  <strong>{creationCount ?? '—'}</strong>
                  <p>Your recipes</p>
                </div>
              </Link>
            </div>
          </div>
          <section className="section-1">
            <MyRecommended />
          </section>
          <section>
            <CarouselSection
              title="Recently Viewed"
              sectionClass="section-2"
              dataSource={apiUrl(`/recently-viewed/${user?.id}`)}
              authenticated
            />
          </section>
          <section>
            <CarouselSection
              title="Trending Now"
              sectionClass="section-3"
              dataSource={apiUrl("/recipes?sort=viewCount,desc&size=20")}
            />
          </section>
          <section>
            <CarouselSection
              title="Quick recipes"
              sectionClass="section-4"
              dataSource={apiUrl("/recipes?sort=cookTime,asc&size=20&maxCookTime=30")}
            />
          </section>
        </main>
      )}
    </>
  );
}

export default function UserDashboard() {
  const { user, loading } = useAuth();
  if (loading) return <main className="product-page layout-wrapper"><h1 className="product-page-title">Your kitchen</h1><p role="status">Checking your account…</p></main>;
  if (!user) return <Navigate to="/login" state={{ from: { pathname: '/dashboard' } }} replace/>;
  return <DashboardContent key={user.id} user={user}/>;
}
