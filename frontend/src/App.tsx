import React from "react";
import { cn } from "./utils/cn";
import { NavSection } from "./types/isam";
import Sidebar from "./components/Sidebar";
import Header from "./components/Header";
import OverviewSection from "./components/OverviewSection";
import JunctionsSection from "./components/JunctionsSection";
import AuditLogsSection from "./components/AuditLogsSection";
import UserManagementSection from "./components/UserManagementSection";
import { useAuth } from "./context/AuthContext";
import LoginForm from "./components/auth/LoginForm";
import RegisterSelfForm from "./components/auth/RegisterSelfForm";
import WanTemplatesSection from "./components/WanTemplatesSection";
import { Toaster } from 'sonner';

const sectionMeta: Record<NavSection, { title: string; subtitle: string }> = {
  overview: {
    title: "Dashboard Overview",
    subtitle: "System health, metrics, and real-time monitoring",
  },
  junctions: {
    title: "ISAM Management",
    subtitle: "ISAM configuration and management",
  },
  "audit-logs": {
    title: "Audit Logs",
    subtitle: "Activity tracking and security event monitoring",
  },
  "user-management": {
    title: "User Management",
    subtitle: "Create and manage users and roles",
  },
  "wan-templates": {
    title: "WAN Templates",
    subtitle: "Configure WAN connection templates",
  },
};

function App() {
  const [activeSection, setActiveSection] =
    React.useState<NavSection>("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);

  const { user, loading } = useAuth();
  const [authMode, setAuthMode] = React.useState<"login" | "register">("login");

  // Track the previous user id to detect account switches
  const prevUserIdRef = React.useRef<number | null>(null);

  // Reset to overview when user changes (login, logout, or account switch)
  React.useEffect(() => {
    const currentUserId = user?.id ?? null;

    if (
      prevUserIdRef.current !== null &&
      currentUserId !== prevUserIdRef.current
    ) {
      // User changed — reset to overview
      setActiveSection("overview");
    }

    prevUserIdRef.current = currentUserId;
  }, [user?.id]);

  // Also reset when user becomes null (logout)
  React.useEffect(() => {
    if (!user) {
      setActiveSection("overview");
      setAuthMode("login");
    }
  }, [user]);

  const meta = sectionMeta[activeSection];

  const renderSection = () => {
    switch (activeSection) {
      case "overview":
        return <OverviewSection />;
      case "junctions":
        return <JunctionsSection />;
      case "audit-logs":
        return <AuditLogsSection />;
      case "user-management":
        return <UserManagementSection />;
      case "wan-templates":
        return <WanTemplatesSection />;
      default:
        return <OverviewSection />;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-500 text-sm">Checking session...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    if (authMode === "login") {
      return <LoginForm onShowRegister={() => setAuthMode("register")} />;
    }
    return <RegisterSelfForm onShowLogin={() => setAuthMode("login")} />;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar
        activeSection={activeSection}
        onNavigate={setActiveSection}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <main
        className={cn(
          "transition-all duration-300",
          sidebarCollapsed ? "ml-16" : "ml-64",
        )}
      >
        <Header title={meta.title} subtitle={meta.subtitle} />
        <div className="p-6">{renderSection()}</div>
      </main>
      <Toaster position="top-right" richColors closeButton />
    </div>
    
  );
}

export default App;
