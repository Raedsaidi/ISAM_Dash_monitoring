// src/App.tsx
import React from "react";
import { cn } from "./utils/cn";
import { NavSection } from "./types/isam";

import Sidebar from "./components/isam/Sidebar";
import Header from "./components/isam/Header";
import OverviewSection from "./components/isam/OverviewSection";
import JunctionsSection from "./components/isam/JunctionsSection";
import AuditLogsSection from "./components/isam/AuditLogsSection";
import UserManagementSection from "./components/isam/UserManagementSection";
import WanTemplatesSection from "./components/isam/WanTemplatesSection";

import { useAuth } from "./context/AuthContext";
import LoginForm from "./components/auth/LoginForm";
import RegisterSelfForm from "./components/auth/RegisterSelfForm";

import ProductSelection from "./components/ProductSelection";
import CiscoSidebar from "./components/cisco/CiscoSidebar";
import CiscoHeader from "./components/cisco/CiscoHeader";
import CiscoOverviewSection from "./components/cisco/CiscoOverviewSection";
import CiscoUserManagementSection from "./components/cisco/CiscoUserManagementSection";

import { Toaster } from "sonner";

/* ------------ ISAM metadata ------------ */

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

/* ------------ Cisco metadata ------------ */
/* On utilise seulement 'overview' et 'user-management' pour Cisco. */

const ciscoSectionMeta: Partial<
  Record<NavSection, { title: string; subtitle: string }>
> = {
  overview: {
    title: "Cisco Overview",
    subtitle: "High-level status of your Cisco network",
  },
  "user-management": {
    title: "Cisco User Management",
    subtitle: "Manage Cisco-related users and roles",
  },
};

function App() {
  /* ISAM navigation */
  const [activeSection, setActiveSection] =
    React.useState<NavSection>("overview");

  /* Cisco navigation */
  const [ciscoSection, setCiscoSection] =
    React.useState<NavSection>("overview");

  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);

  const { user, loading } = useAuth();
  const [authMode, setAuthMode] = React.useState<"login" | "register">("login");

  // Product choice: ISAM / Cisco / none
  const [product, setProduct] = React.useState<"none" | "isam" | "cisco">(
    () => {
      if (typeof window === "undefined") return "none";
      const saved = window.localStorage.getItem("selectedProduct");
      if (saved === "isam" || saved === "cisco") return saved;
      return "none";
    },
  );

  // Persist product choice in localStorage
  React.useEffect(() => {
    if (typeof window === "undefined") return;

    if (product === "none") {
      window.localStorage.removeItem("selectedProduct");
    } else {
      window.localStorage.setItem("selectedProduct", product);
    }
  }, [product]);

  // Track previous user to detect account switch
  const prevUserIdRef = React.useRef<number | null>(null);

  // Reset when user changes (login with another account, etc.)
  React.useEffect(() => {
    const currentUserId = user?.id ?? null;

    if (
      prevUserIdRef.current !== null &&
      currentUserId !== prevUserIdRef.current
    ) {
      // User changed
      setActiveSection("overview");
      setCiscoSection("overview");
      setProduct("none");
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("selectedProduct");
      }
    }

    prevUserIdRef.current = currentUserId;
  }, [user?.id]);

  // Reset when user becomes null (logout)
  React.useEffect(() => {
    if (!user) {
      setActiveSection("overview");
      setCiscoSection("overview");
      setAuthMode("login");
      setProduct("none");
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("selectedProduct");
      }
    }
  }, [user]);

  const meta = sectionMeta[activeSection];

  const renderIsamSection = () => {
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

  /* ----------- loading / auth states ----------- */

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

  /* ----------- authenticated user ----------- */

  // 1) If product not chosen yet, show selection (ISAM / Cisco)
  if (product === "none") {
    return (
      <>
        <ProductSelection
          onSelectIsam={() => {
            setProduct("isam");
            setActiveSection("overview");
          }}
          onSelectCisco={() => {
            setProduct("cisco");
            setCiscoSection("overview");
          }}
        />
        <Toaster position="top-right" richColors closeButton />
      </>
    );
  }

  // 2) Cisco UI
  if (product === "cisco") {
    const ciscoMeta =
      ciscoSectionMeta[ciscoSection] ?? {
        title: "Cisco",
        subtitle: "",
      };

    return (
      <div className="min-h-screen bg-slate-50">
        <CiscoSidebar
          activeSection={ciscoSection}
          onNavigate={setCiscoSection}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        <main
          className={cn(
            "transition-all duration-300",
            sidebarCollapsed ? "ml-16" : "ml-64",
          )}
        >
          <CiscoHeader
            title={ciscoMeta.title}
            subtitle={ciscoMeta.subtitle}
          />
          <div className="p-6">
            {ciscoSection === "overview" && <CiscoOverviewSection />}
            {ciscoSection === "user-management" && (
              <CiscoUserManagementSection />
            )}
          </div>
        </main>
        <Toaster position="top-right" richColors closeButton />
      </div>
    );
  }

  // 3) ISAM UI
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
        <div className="p-6">{renderIsamSection()}</div>
      </main>
      <Toaster position="top-right" richColors closeButton />
    </div>
  );
}

export default App;