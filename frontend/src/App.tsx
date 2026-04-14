// src/App.tsx
import React from "react";
import {
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { cn } from "./utils/cn";
import { NavSection } from "./types/isam";
import CiscoConfigsSection from "./components/cisco/CiscoConfigsSection";
import Sidebar from "./components/isam/Sidebar";
import Header from "./components/isam/Header";
import OverviewSection from "./components/isam/OverviewSection";
import JunctionsSection from "./components/isam/JunctionsSection";
import AuditLogsSection from "./components/isam/AuditLogsSection";
import UserManagementSection from "./components/isam/UserManagementSection";
import WanTemplatesSection from "./components/isam/WanTemplatesSection";
import CiscoSidebar from "./components/cisco/CiscoSidebar";
import CiscoHeader from "./components/cisco/CiscoHeader";
import CiscoOverviewSection from "./components/cisco/CiscoOverviewSection";
import CiscoUserManagementSection from "./components/cisco/CiscoUserManagementSection";
import CiscoSwitchManagementSection from "./components/cisco/CiscoSwitchManagementSection";
import CiscoPortManagementSection from "./components/cisco/CiscoPortManagementSection";
import CiscoVlanManagementSection from "./components/cisco/CiscoVlanManagementSection";
import MyTemplatesSection from "./components/isam/MyTemplatesSection";
import ProductSelection from "./components/ProductSelection";
import LoginForm from "./components/auth/LoginForm";
import RegisterSelfForm from "./components/auth/RegisterSelfForm";
import { useAuth } from "./context/AuthContext";
import { Toaster } from "sonner";

/* ------------ ISAM metadata ------------ */

const isamSectionMeta: Record<NavSection, { title: string; subtitle: string }> =
  {
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
    "my-templates": {
      title: "My Templates",
      subtitle: "Manage your personal WAN templates",
    },
    "switch-management": {
      title: "Switch Management",
      subtitle: "Manage network switches",
    },
    "port-management": {
      title: "Port Management",
      subtitle: "View and control switch ports",
    },
    "vlan-management": {
      title: "VLAN Management",
      subtitle: "View and manage VLANs",
    },
    "cisco-configs": {
      title: "Cisco Configs Management",
      subtitle: "Manage and configure Cisco device settings",
    },
  };

/* ------------ Cisco metadata ------------ */

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
  "switch-management": {
    title: "Cisco Switch Management",
    subtitle: "View and manage all network switches in your infrastructure",
  },
  "port-management": {
    title: "Cisco Port Management",
    subtitle:
      "View and control individual switch ports — lock or unlock to manage access",
  },
  "vlan-management": {
    title: "Cisco VLAN Management",
    subtitle:
      "Create, view, and delete VLANs — assign VLANs to ports in Access or Trunk mode",
  },
  "cisco-configs": {
    title: "Cisco Configs Management",
    subtitle: "Manage and configure Cisco device settings",
  },
};

function App() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

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

  return (
    <>
      <Routes>
        <Route
          path="/login"
          element={
            !user ? (
              <LoginForm onShowRegister={() => navigate("/register")} />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="/register"
          element={
            !user ? (
              <RegisterSelfForm onShowLogin={() => navigate("/login")} />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="/"
          element={
            user ? (
              <ProductSelection
                onSelectIsam={() => navigate("/isam/overview")}
                onSelectCisco={() => navigate("/cisco/overview")}
              />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/isam/*"
          element={user ? <IsamLayout /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/cisco/*"
          element={user ? <CiscoLayout /> : <Navigate to="/login" replace />}
        />
        <Route
          path="*"
          element={<Navigate to={user ? "/" : "/login"} replace />}
        />
      </Routes>
      <Toaster position="top-right" richColors closeButton />
    </>
  );
}

/* ============================================================
   ISAM Layout
   ============================================================ */

function IsamLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const pathAfterIsam = location.pathname.replace(/^\/isam\/?/, "");
  const sub = pathAfterIsam.split("/")[0] || "overview";

  const pathToSection: Record<string, NavSection> = {
    "": "overview",
    overview: "overview",
    junctions: "junctions",
    "audit-logs": "audit-logs",
    "user-management": "user-management",
    "wan-templates": "wan-templates",
    "my-templates": "my-templates",
  };

  const activeSection: NavSection = pathToSection[sub] ?? "overview";
  const meta = isamSectionMeta[activeSection];

  const handleNavigate = (section: NavSection) => {
    const sectionToPath: Partial<Record<NavSection, string>> = {
      overview: "overview",
      junctions: "junctions",
      "audit-logs": "audit-logs",
      "user-management": "user-management",
      "wan-templates": "wan-templates",
      "my-templates": "my-templates",
    };
    navigate(`/isam/${sectionToPath[section] ?? "overview"}`);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar
        activeSection={activeSection}
        onNavigate={handleNavigate}
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
        <div className="p-6">
          <Routes>
            <Route path="overview" element={<OverviewSection />} />
            <Route path="junctions" element={<JunctionsSection />} />
            <Route path="audit-logs" element={<AuditLogsSection />} />
            <Route path="user-management" element={<UserManagementSection />} />
            <Route path="wan-templates" element={<WanTemplatesSection />} />
            <Route path="my-templates" element={<MyTemplatesSection />} />
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="*" element={<Navigate to="overview" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

/* ============================================================
   Cisco Layout
   ============================================================ */

function CiscoLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const pathAfterCisco = location.pathname.replace(/^\/cisco\/?/, "");
  const sub = pathAfterCisco.split("/")[0] || "overview";

  const pathToSection: Record<string, NavSection> = {
    "": "overview",
    overview: "overview",
    "user-management": "user-management",
    "switch-management": "switch-management",
    "port-management": "port-management",
    "vlan-management": "vlan-management",
    "cisco-configs": "cisco-configs",
  };

  const activeSection: NavSection = pathToSection[sub] ?? "overview";
  const meta = ciscoSectionMeta[activeSection] ?? {
    title: "Cisco",
    subtitle: "",
  };

  const handleNavigate = (section: NavSection) => {
    const sectionToPath: Partial<Record<NavSection, string>> = {
      overview: "overview",
      "user-management": "user-management",
      "switch-management": "switch-management",
      "port-management": "port-management",
      "vlan-management": "vlan-management",
      "cisco-configs": "cisco-configs",
    };
    navigate(`/cisco/${sectionToPath[section] ?? "overview"}`);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <CiscoSidebar
        activeSection={activeSection}
        onNavigate={handleNavigate}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <main
        className={cn(
          "transition-all duration-300",
          sidebarCollapsed ? "ml-16" : "ml-64",
        )}
      >
        <CiscoHeader title={meta.title} subtitle={meta.subtitle} />
        <div className="p-6">
          <Routes>
            <Route path="overview" element={<CiscoOverviewSection />} />
            <Route
              path="user-management"
              element={<CiscoUserManagementSection />}
            />
            <Route
              path="switch-management"
              element={<CiscoSwitchManagementSection />}
            />
            <Route
              path="port-management"
              element={<CiscoPortManagementSection />}
            />
            <Route
              path="vlan-management"
              element={<CiscoVlanManagementSection />}
            />
            <Route path="cisco-configs" element={<CiscoConfigsSection />} />
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="*" element={<Navigate to="overview" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export default App;
