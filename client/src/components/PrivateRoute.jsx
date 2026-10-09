import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <main className="lmc-route-loading"><p role="status">Loading your account…</p></main>;
  return user ? children : <Navigate to="/login" state={{ from: location }} replace />;
}
