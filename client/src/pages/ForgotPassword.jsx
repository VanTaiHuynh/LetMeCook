import AuthLayout from "../components/AuthLayout";
import Alert from "../components/ui/Alert";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import { useRef, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import Modal from '../components/Modal';
import { Link, useNavigate } from 'react-router-dom';


export default function ForgotPassword() {
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [showModal, setShowModal] = useState(false)
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);
    const navigate = useNavigate();

    const handleResetPassword = async (e) => {
        e.preventDefault();
        if (submittingRef.current) return;
        submittingRef.current = true;
        setSubmitting(true);
        setError('');
        try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/reset-password'
        });

        if (error) throw error;
        setShowModal(true);
        } catch (error) {
            setError(error.message || 'Could not send the reset link. Please try again.');
        } finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
    };

    return (
        <>
        <Modal
            isOpen ={showModal}
            message = {"Password reset email sent! Please check your inbox."}
            onClose = {() => {
                setShowModal(false)
                navigate('/')
            }}
        />
        <AuthLayout recovery>
        <div className="form-page">
            <div className='center-container'>
                <form onSubmit={handleResetPassword} className='login-form' aria-busy={submitting}>
                    <h1 className="product-page-title">Forgot your password?</h1>
                    <p className="auth-intro">We’ll send a reset link.</p>
                    <Field htmlFor="reset-email">Email address</Field>
                    <input disabled={submitting} id="reset-email" autoComplete="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Enter your email"
                        required
                    />
                    {error && <Alert as="p" className="error-message">{error}</Alert>}
                    <Button type="submit" className="lmc-button lmc-button--primary" disabled={submitting}>{submitting ? 'Sending link…' : 'Send reset link'}</Button>
                    <p className="auth-footer"><Link className="link" to="/login">Back to log in</Link></p>
                </form>
            </div>
            </div>
        </AuthLayout>
        </>
    );
}
