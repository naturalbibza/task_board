import { Navigate, Route, Routes } from 'react-router-dom';
import { BoardsPage } from './pages/BoardsPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/boards" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/boards" element={<BoardsPage />} />
      <Route path="*" element={<Navigate to="/boards" replace />} />
    </Routes>
  );
}
