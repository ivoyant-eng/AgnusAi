import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import Landing from '@/pages/Landing'
import Dashboard from '@/pages/Dashboard'
import Connect from '@/pages/Connect'
import Indexing from '@/pages/Indexing'
import Ready from '@/pages/Ready'
import Settings from '@/pages/Settings'
import Rules from '@/pages/Rules'
import RepoDetails from '@/pages/RepoDetails'
import Login from '@/pages/Login'
import { useAuth } from '@/hooks/useAuth'

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <span className="label-meta text-muted-foreground">Loading...</span>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Login />} />
        <Route
          path="/app"
          element={
            <AuthGuard>
              <Layout>
                <Dashboard />
              </Layout>
            </AuthGuard>
          }
        />
        <Route
          path="/app/connect"
          element={
            <AuthGuard>
              <Layout>
                <Connect />
              </Layout>
            </AuthGuard>
          }
        />
        <Route
          path="/app/indexing/:repoId"
          element={
            <AuthGuard>
              <Layout>
                <Indexing />
              </Layout>
            </AuthGuard>
          }
        />
        <Route
          path="/app/ready/:repoId"
          element={
            <AuthGuard>
              <Layout>
                <Ready />
              </Layout>
            </AuthGuard>
          }
        />
        <Route
          path="/app/settings"
          element={
            <AuthGuard>
              <Layout>
                <Settings />
              </Layout>
            </AuthGuard>
          }
        />
        <Route
          path="/app/rules"
          element={
            <AuthGuard>
              <Layout>
                <Rules />
              </Layout>
            </AuthGuard>
          }
        />
        <Route
          path="/app/repos/:repoId"
          element={
            <AuthGuard>
              <Layout>
                <RepoDetails />
              </Layout>
            </AuthGuard>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
