import AuthLayout from "../components/AuthLayout";
import Alert from "../components/ui/Alert";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import { useState } from "react";
import { supabase } from "../utils/supabaseClient";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { FiEye, FiEyeOff } from "react-icons/fi";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      setError(error.message);
    } else {
      setError("");
      const from = location.state?.from;
      const destination = from?.pathname?.startsWith("/") && !["/login", "/register"].includes(from.pathname)
        ? `${from.pathname}${from.search || ""}${from.hash || ""}` : "/dashboard";
      navigate(destination, { replace: true });
    }
    } catch (error) {
      setError(error.message || "Could not log in. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasswordToggle = () => {
    setShowPassword(!showPassword);
  };

  return (
    <>
      <AuthLayout>
        <div className="form-page">
          <div className="center-container">
            <form className="login-form" onSubmit={handleLogin} aria-busy={submitting}>
              <h1 className="product-page-title">Welcome back</h1>
              <p className="auth-intro">Log in to your kitchen.</p>
              <Field htmlFor="login-email">Email address</Field>
              <input
                id="login-email"
                type="email"
                aria-label="Email address"
                autoComplete="email"
                required
                disabled={submitting}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
              />
              <Field htmlFor="login-password">Password</Field>
              <div className="password-wrapper">
                <input
                  id="login-password"
                  aria-label="Password"
                  autoComplete="current-password"
                  required
                  disabled={submitting}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                />
                <Button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="password-toggle"
                  aria-pressed={showPassword}
                  onClick={handlePasswordToggle}
                >
                  {showPassword ? (
                    <FiEye className="input-icon" size={25} />
                  ) : (
                    <FiEyeOff className="input-icon" size={25} />
                  )}
                </Button>
              </div>
              <div className="auth-recovery"><Link to="/forgot-password" className="link">Forgot password?</Link></div>
              {error.length > 0 && <Alert as="p" className="error-message">{error}</Alert>}
              <Button type="submit" className="lmc-button lmc-button--primary" disabled={submitting}>{submitting ? "Logging in…" : "Log in"}</Button>
              <p className="auth-footer">New to LetMeCook? <Link to="/register" className="link">Sign up</Link></p>
            </form>
          </div>
        </div>
      </AuthLayout>

    </>
  );
}
