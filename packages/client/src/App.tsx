import { Navigate, Route, Routes } from 'react-router-dom';
import { BoardsPage } from './pages/BoardsPage';
import { BoardPage } from './pages/BoardPage';
import { JoinPage } from './pages/JoinPage';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/ProfilePage';
import { RegisterPage } from './pages/RegisterPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/boards" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/boards" element={<BoardsPage />} />
      <Route path="/boards/:id" element={<BoardPage />} />
      <Route path="/profile" element={<ProfilePage />} />
      {/* Подтверждение email по ссылке из письма (фаза 14) */}
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      {/* Invite-ссылки (FR-15): /join/:token работает и для неавторизованных */}
      <Route path="/join/:token" element={<JoinPage />} />
      <Route path="*" element={<Navigate to="/boards" replace />} />
    </Routes>
  );
}
