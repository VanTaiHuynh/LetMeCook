import { Routes, Route, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import RouteErrorBoundary from "./components/RouteErrorBoundary";
import SEO from "./components/SEO";
import MainNav from "./components/MainNav";



import Footer from "./components/Footer";




























import PrivateRoute from "./components/PrivateRoute"
import GuestRoute  from "./components/GuestRoute";
import "./pages/ProductPages.css";
import "./design-system.css";

const Home = lazy(() => import("./pages/Home"));
const Recipes = lazy(() => import("./pages/Recipes"));
const Login = lazy(() => import("./pages/Login"));
const SearchResults = lazy(() => import("./pages/SearchResults"));
const Contact = lazy(() => import("./pages/Contact"));
const About = lazy(() => import("./pages/About"));
const Features = lazy(() => import("./pages/Features"));
const HowItWorks = lazy(() => import("./pages/HowItWorks"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Profile = lazy(() => import("./pages/Profile"));
const Register = lazy(() => import("./pages/Register"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const EditProfile = lazy(() => import("./pages/EditProfile"));
const UserDashboard = lazy(() => import("./pages/UserDashboard"));
const IndividualRecipe = lazy(() => import("./pages/IndividualRecipe"));
const Favourites = lazy(() => import("./pages/Favourites"));
const CreateRecipe = lazy(() => import("./pages/CreateRecipe"));
const UserRecipe = lazy(() => import("./pages/UserRecipe"));
const EditRecipe = lazy(() => import("./pages/EditRecipe"));
const Err401 = lazy(() => import("./pages/Err401"));
const Err404 = lazy(() => import("./pages/Err404"));
const Err403 = lazy(() => import("./pages/Err403"));
const Sunny = lazy(() => import("./pages/Sunny"));
const MealPlanner = lazy(() => import("./pages/MealPlanner"));
const Newsletter = lazy(() => import("./pages/Newsletter"));
const Operations = lazy(() => import("./pages/Operations"));
const Pantry = lazy(() => import("./pages/Pantry"));
const Household = lazy(() => import("./pages/Household"));
const CookAlong = lazy(() => import("./pages/CookAlong"));
const CookStart = lazy(() => import("./pages/CookStart"));
const GuestCookAlong = lazy(() => import("./pages/GuestCookAlong"));
const Evidence = lazy(() => import("./pages/Evidence"));
const PublicCollection = lazy(() => import("./pages/PublicCollection"));
const Creator = lazy(() => import("./pages/Creator"));

function App() {
  const { pathname, hash } = useLocation();
  useEffect(() => { if (!hash) window.scrollTo({ top: 0, left: 0, behavior: "instant" }); }, [pathname, hash]);
  return (
    <div className="lmc-app" lang="en">
      <SEO />
      <a className="lmc-skip-link" href="#main-content">Skip to content</a>
      <header>
        <MainNav/>
      </header>
      <div id="main-content" tabIndex={-1}>
      <RouteErrorBoundary key={pathname}>
      <Suspense fallback={<main className="lmc-route-state" role="status" aria-busy="true"><p>Loading…</p></main>}>
      <Routes>
        <Route path="/recipes" element={<Recipes />} />
        <Route path="/recipes/:id" element={<IndividualRecipe />} />
        <Route path="/search" element={<SearchResults />} />
        <Route path="/sunny" element={<Sunny />} />
        <Route path="/meal-planner" element={<MealPlanner />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/newsletter" element={<Newsletter />} />
        <Route path="/pantry" element={<PrivateRoute><Pantry /></PrivateRoute>} />
        <Route path="/household" element={<PrivateRoute><Household /></PrivateRoute>} />
        <Route path="/cook-along" element={<CookStart />} />
        <Route path="/cook-along/recipe/:recipeId" element={<GuestCookAlong />} />
        <Route path="/cook-along/:id" element={<PrivateRoute><CookAlong /></PrivateRoute>} />
        <Route path="/evidence" element={<PrivateRoute><Evidence /></PrivateRoute>} />
        <Route path="/collections/:slug" element={<PublicCollection />} />
        <Route path="/creator" element={<PrivateRoute><Creator /></PrivateRoute>} />
        <Route path="/admin" element={<PrivateRoute><Operations /></PrivateRoute>} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/about" element={<About />} />
        <Route path="/features" element={<Features />} />
        <Route path="/how-it-works" element={<HowItWorks />} />
        <Route path="/unauthorized" element={<Err401 />} />
        <Route path="/forbidden" element={<Err403 />} />
        <Route path="*" element={<Err404 />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route path="/" element={<GuestRoute><Home /></GuestRoute>} />
        <Route path="/login" element={<GuestRoute> <Login /> </GuestRoute>} />
        <Route path="/register" element={<GuestRoute> <Register /> </GuestRoute>} />

        <Route path="/dashboard" element={ <PrivateRoute> <UserDashboard /> </PrivateRoute>} />
        <Route path="/profile" element={<PrivateRoute><Profile /></PrivateRoute>} />
        <Route path="/edit-profile" element={<PrivateRoute><EditProfile /></PrivateRoute>} />
        <Route path="/favourites" element={<PrivateRoute><Favourites /></PrivateRoute>} />
        <Route path="/create-recipe" element={<PrivateRoute><CreateRecipe /></PrivateRoute>} />
        <Route path="/user-recipe" element={<PrivateRoute><UserRecipe /></PrivateRoute>} />
        <Route path="/edit-recipe/:id" element={<PrivateRoute><EditRecipe /></PrivateRoute>} />

      </Routes>
      </Suspense>
      </RouteErrorBoundary>
      </div>
      <Footer />
    </div>
  );
}

export default App;
