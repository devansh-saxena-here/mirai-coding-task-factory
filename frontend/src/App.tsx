import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ProjectProvider } from './context/ProjectContext';
import { MainLayout } from './layouts/MainLayout';
import { DashboardPage } from './pages/DashboardPage';
import { NewProjectPage } from './pages/NewProjectPage';
import { TaskGeneratorPage } from './pages/TaskGeneratorPage';
import { ReferenceSolutionPage } from './pages/ReferenceSolutionPage';
import { TestSuitePage } from './pages/TestSuitePage';
import { ValidationPage } from './pages/ValidationPage';
import { HarborExportPage } from './pages/HarborExportPage';
import { SettingsPage } from './pages/SettingsPage';
import { EvaluationPage } from './pages/EvaluationPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthGate } from './components/AuthGate';
import { PublicLayout } from './layouts/PublicLayout';
import { LandingPage } from './pages/LandingPage';
import { AboutPage } from './pages/AboutPage';

export const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<PublicLayout />}>
                <Route path="/" element={<LandingPage />} />
                <Route path="/about" element={<AboutPage />} />
              </Route>
              <Route element={<AuthGate><ProjectProvider><MainLayout /></ProjectProvider></AuthGate>}>
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="new-project" element={<NewProjectPage />} />
                <Route path="analysis" element={<NewProjectPage />} />
                <Route path="task-generator" element={<TaskGeneratorPage />} />
                <Route path="solution" element={<ReferenceSolutionPage />} />
                <Route path="test-suite" element={<TestSuitePage />} />
                <Route path="validation" element={<ValidationPage />} />
                <Route path="export" element={<HarborExportPage />} />
                <Route path="evaluation" element={<EvaluationPage />} />
                <Route path="leaderboard" element={<LeaderboardPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
};

export default App;
