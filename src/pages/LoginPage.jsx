import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../globalContext';
import { LoginModal } from '../components/LoginModal';

export default function LoginPage() {
    const navigate = useNavigate();
    const { user, login } = useAuth();

    const handleLoginSuccess = (data) => {
        login(data.token, data.username);
        navigate(-1);
    };

    return (
        <LoginModal
            isOpen={true}
            onClose={() => navigate(-1)}
            onLoginSuccess={handleLoginSuccess}
            user={user}
        />
    );
}
