import AuthLayout from "../components/AuthLayout";
import Alert from "../components/ui/Alert";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FiEye, FiEyeOff } from "react-icons/fi";
import Modal from '../components/Modal';

export default function Register() {
    const [email, setEmail] =  useState('');
    const [password, setPassword] = useState('');
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [hasEmail, setHasEmail] = useState('');
    const [error, setError] = useState('');
    const [showModal, setShowModal] = useState(false)
    const [registrationMessage, setRegistrationMessage] = useState('')
    const [registeredWithSession, setRegisteredWithSession] = useState(false)
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);

    const [searchParams] = useSearchParams();
    const navigate = useNavigate();

    useEffect(() => {
        const emailFromQuery = searchParams.get('email');
        if (emailFromQuery && !hasEmail) {
            setEmail(emailFromQuery);
            setHasEmail(true);
        }
    }, [searchParams, hasEmail]);

    function isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    const handleRegister = async (e) => {
        e.preventDefault();
        if (submittingRef.current) return;
        setError('');
        if (password !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }
        if (!email || !password || !firstName || !lastName) {
            setError('Please fill in all fields.');
            return;
        }

        if (!isValidEmail(email)) {
            setError('Please enter a valid email address format.');
            return;
        }

        submittingRef.current = true;
        setSubmitting(true);
        try {
            const { data, error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        first_name: firstName,
                        last_name: lastName
                    }
                }
            });

            if (error) {
                setError(error.message);
                return;
            }

            if (!data.user?.id) {
                setError('Your account could not be created. Please try again.');
                return;
            } else {
                setRegisteredWithSession(Boolean(data.session));
                setRegistrationMessage(data.session
                    ? 'Registration complete! Your account is ready.'
                    : 'Registration complete! Please check your email inbox and confirm.');
                setShowModal(true);
            }
        } catch (error) {
            setError('An error occurred while registering: ' + error.message);
        } finally {
            submittingRef.current = false;
            setSubmitting(false);
        }

    };

    return(
        <>
        <Modal
            isOpen={showModal}
            message={registrationMessage}
            onClose={ () => {
                setShowModal(false)
                navigate(registeredWithSession ? '/dashboard' : '/login')
            }}
        />
        <AuthLayout>
        <div className="form-page">
            <div className="center-container">
                <form onSubmit={handleRegister} className='login-form' aria-busy={submitting}>
                <h1 className="product-page-title">Create your account</h1>
                <p className="auth-intro">Save the recipes you love. Make dinner easier.</p>
                <Field htmlFor="register-first-name">First name</Field>
                <input disabled={submitting} id="register-first-name" autoComplete="given-name" required value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder='First Name'/>
                <Field htmlFor="register-last-name">Last name</Field>
                <input disabled={submitting} id="register-last-name" autoComplete="family-name" required value={lastName} onChange={(e) => {setLastName(e.target.value)}} placeholder='Last Name' />
                <Field htmlFor="register-email">Email address</Field>
                <input disabled={submitting} id="register-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
                <Field htmlFor="register-password">Password</Field>
                <div className="password-wrapper">
                    <input disabled={submitting} id="register-password" autoComplete="new-password" required type={showPassword ? "text" : "password" }
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Password"
                    />
                    <Button type="button" className="password-toggle" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>
                        {showPassword ?  <FiEye className="input-icon" size={25} /> : <FiEyeOff className="input-icon" size={25} />}
                    </Button>
                </div>
                <Field htmlFor="register-confirm">Confirm password</Field>
                <div className="password-wrapper">
                    <input disabled={submitting}
                    id="register-confirm" autoComplete="new-password" type={showConfirmPassword ? "text" : "password" }
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    required
                    />
                    <Button type="button" className="password-toggle" aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"} aria-pressed={showConfirmPassword} onClick={() => setShowConfirmPassword(!showConfirmPassword)}>
                        {showConfirmPassword ?  <FiEye className="input-icon" size={25} /> : <FiEyeOff className="input-icon" size={25} />}
                    </Button>
                </div>

                {error.length > 0 && <Alert as="p" className="error-message">{error}</Alert>}
                <Button type="submit" className="lmc-button lmc-button--primary" disabled={submitting}>{submitting ? 'Creating account…' : 'Sign up'}</Button>
                <p className="auth-footer">Already have an account? <Link className="link" to="/login">Log in</Link></p>
                </form>
            </div>
        </div>
        </AuthLayout>
        </>
    );
}
