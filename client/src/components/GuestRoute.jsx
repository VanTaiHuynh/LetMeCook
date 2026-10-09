import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function GuestRoute({ children }) {
    const { user, loading } = useAuth();
    const location = useLocation();
    if (loading) return <main className="lmc-route-loading"><p role="status">Loading your account…</p></main>;
    const from = location.state?.from;
    const destination = from?.pathname?.startsWith("/") && !["/login", "/register"].includes(from.pathname)
      ? `${from.pathname}${from.search || ""}` : "/dashboard";
    return user ? <Navigate to={destination} replace /> : children
}
