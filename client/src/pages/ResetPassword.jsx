import AuthLayout from "../components/AuthLayout";
import Alert from "../components/ui/Alert";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import { useRef, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { useNavigate } from 'react-router-dom';
import { FiEye, FiEyeOff } from 'react-icons/fi';
import Modal from '../components/Modal';
export default function ResetPassword() {
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [error, setError] = useState('');
    const [showModal, setShowModal] = useState(false)
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);
    const navigate = useNavigate();

    const handleResetPassword = async (e) => {
        e.preventDefault();
        if (submittingRef.current) return;
        setError('');

        if (password !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }

        submittingRef.current = true;
        setSubmitting(true);
        try {
            const { error } = await supabase.auth.updateUser({ password });
            if (error) throw error;
            setShowModal(true);
            setPassword('');
        } catch (error) {
            setError(error.message || 'Could not reset your password. Please try again.');
        } finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
    };

    return(
        <>
        <Modal
            isOpen = {showModal}
            message = {'Password has been successfully reset. You can now log in with your new password.'}
            onClose = { () => {
                setShowModal(false)
                navigate('/')
            }}
        />
        <AuthLayout recovery>
        <div className='form-page'>
            <div className='center-container'>
                <form onSubmit={handleResetPassword} className="login-form" aria-busy={submitting}>
                    <h1 className="product-page-title">Choose a new password</h1>
                    <p className="auth-intro">Use a password you haven’t used before.</p>
                    <Field htmlFor="reset-password">New password</Field>
                    <div className="password-wrapper">
                        <input disabled={submitting} id="reset-password" autoComplete="new-password" required type={showPassword ? "text" : "password" }
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Password"
                        />
                        <Button type="button" className="password-toggle" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>
                            {showPassword ?  <FiEye className="input-icon" size={25} /> : <FiEyeOff className="input-icon" size={25} />}
                    </Button>
                    </div>
                    <Field htmlFor="reset-confirm">Confirm new password</Field>
                    <div className="password-wrapper">
                        <input disabled={submitting}
                        id="reset-confirm" autoComplete="new-password" type={showConfirmPassword ? "text" : "password" }
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Confirm password"
                        required
                        />
                        <Button type="button" className="password-toggle" aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"} aria-pressed={showConfirmPassword} onClick={() => setShowConfirmPassword(!showConfirmPassword)}>
                            {showConfirmPassword ?  <FiEye className="input-icon" size={25} /> : <FiEyeOff className="input-icon" size={25} />}
                    </Button>
                    </div>
                    <Button type="submit" className="lmc-button lmc-button--primary" disabled={submitting}>{submitting ? 'Resetting password…' : 'Reset password'}</Button>
                    {error && <Alert as="p" className="error-message">{error}</Alert>}
                </form>
            </div>
        </div>
        </AuthLayout>
        </>
    );
}
