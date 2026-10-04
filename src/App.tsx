import { HashRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { MotionConfig } from "motion/react";
import { AuthProvider, useAuth } from "./lib/auth";
import { AccountProvider } from "./lib/store";
import { ScrollManager } from "./components/common";
import { MoneyFlowProvider } from "./components/MoneyFlow";
import { ToastProvider } from "./components/Toast";
import { Header, Footer } from "./components/Chrome";
import Landing from "./Landing";
import { LoginPage, SignupPage, ForgotPasswordPage, InviteAcceptPage } from "./pages/Auth";
import {
  PlatformPage, ScoutPage, PricingPage, SecurityPage, SupportPage,
  ContactPage, AboutPage, CareersPage, LegalPage, NotFoundPage,
  ProductDetailPage, PerksMarketingPage, ConciergePage, HelpCenterPage, JobPage, PersonalBankingPage
} from "./pages/Marketing";
import {
  RequireAuth, DashboardLayout, Overview, CardsPage, TransactionsPage,
  PaymentsPage, InvoicesPage, RewardsPage, SettingsPage,
  ScoutAIPage, TeamPage, PerksPage, StatementsPage,
  AccountsPage, BillsPage, DisputesPage, SecurityCenterPage, KYCPage
} from "./pages/Dashboard";
import { SuperAdminPage } from "./pages/SuperAdmin";
import { SupportCenterPage } from "./pages/SupportCenter";
import { EmailTemplatesPage } from "./pages/EmailTemplates";
import { MoneyPlanPage } from "./components/MoneyPlan";

/** Public marketing pages share the site chrome. Auth and app layouts add the footer themselves. */
function SiteLayout({ children }: { children: React.ReactNode }) {
  return <><Header />{children}<Footer /></>;
}

function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="route-loading"><span className="spinner" /></div>;
  if (!user) return <>{children}</>;
  return <Navigate to={user.role && user.role !== "user" ? "/app/superadmin" : "/app"} replace />;
}

function BusinessOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return user?.accountType === "business" ? <>{children}</> : <Navigate to="/app" replace />;
}

function Shell() {
  const { pathname, hash } = useLocation();
  return (
    <>
      <ScrollManager pathname={pathname} hash={hash} />
      <Routes>
        <Route path="/" element={<SiteLayout><Landing /></SiteLayout>} />
        <Route path="/platform" element={<SiteLayout><PlatformPage /></SiteLayout>} />
        <Route path="/personal" element={<SiteLayout><PersonalBankingPage /></SiteLayout>} />
        <Route path="/business-account" element={<SiteLayout><ProductDetailPage product="business-account" /></SiteLayout>} />
        <Route path="/cards" element={<SiteLayout><ProductDetailPage product="cards" /></SiteLayout>} />
        <Route path="/rewards" element={<SiteLayout><ProductDetailPage product="rewards" /></SiteLayout>} />
        <Route path="/payments" element={<SiteLayout><ProductDetailPage product="payments" /></SiteLayout>} />
        <Route path="/invoicing" element={<SiteLayout><ProductDetailPage product="invoicing" /></SiteLayout>} />
        <Route path="/integrations" element={<SiteLayout><ProductDetailPage product="integrations" /></SiteLayout>} />
        <Route path="/analytics" element={<SiteLayout><ProductDetailPage product="analytics" /></SiteLayout>} />
        <Route path="/ai-cfo" element={<SiteLayout><ProductDetailPage product="ai-cfo" /></SiteLayout>} />
        <Route path="/scout" element={<SiteLayout><ScoutPage /></SiteLayout>} />
        <Route path="/pricing" element={<SiteLayout><PricingPage /></SiteLayout>} />
        <Route path="/security" element={<SiteLayout><SecurityPage /></SiteLayout>} />
        <Route path="/support" element={<SiteLayout><SupportPage /></SiteLayout>} />
        <Route path="/help-center" element={<SiteLayout><HelpCenterPage /></SiteLayout>} />
        <Route path="/concierge" element={<SiteLayout><ConciergePage /></SiteLayout>} />
        <Route path="/perks" element={<SiteLayout><PerksMarketingPage /></SiteLayout>} />
        <Route path="/email-templates" element={<SiteLayout><EmailTemplatesPage /></SiteLayout>} />
        <Route path="/contact" element={<SiteLayout><ContactPage /></SiteLayout>} />
        <Route path="/about" element={<SiteLayout><AboutPage /></SiteLayout>} />
        <Route path="/careers" element={<SiteLayout><CareersPage /></SiteLayout>} />
        <Route path="/careers/:slug" element={<SiteLayout><JobPage /></SiteLayout>} />
        <Route path="/legal/privacy" element={<SiteLayout><LegalPage doc="privacy" /></SiteLayout>} />
        <Route path="/legal/terms" element={<SiteLayout><LegalPage doc="terms" /></SiteLayout>} />
        <Route path="/legal/disclosures" element={<SiteLayout><LegalPage doc="disclosures" /></SiteLayout>} />

        <Route path="/login" element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
        <Route path="/signup" element={<RedirectIfAuthed><SignupPage /></RedirectIfAuthed>} />
        <Route path="/forgot-password" element={<RedirectIfAuthed><ForgotPasswordPage /></RedirectIfAuthed>} />
        <Route path="/invite/accept" element={<RedirectIfAuthed><InviteAcceptPage /></RedirectIfAuthed>} />

        {/* The staff console is intentionally outside the member account shell.
            A bootstrap Super Admin is an operator identity, not a checking
            account holder; requiring a member account here previously left a
            valid admin session on a perpetual empty/loading dashboard. */}
        <Route path="/app/superadmin" element={import.meta.env.DEV ? <SuperAdminPage /> : <RequireAuth><SuperAdminPage /></RequireAuth>} />

        <Route
          path="/app"
          element={
            <RequireAuth>
              <AccountProvider>
                <MoneyFlowProvider>
                  <DashboardLayout />
                </MoneyFlowProvider>
              </AccountProvider>
            </RequireAuth>
          }
        >
          <Route index element={<Overview />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="cards" element={<CardsPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="transfers" element={<PaymentsPage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="invoices" element={<BusinessOnly><InvoicesPage /></BusinessOnly>} />
          <Route path="bills" element={<BillsPage />} />
          <Route path="plan" element={<MoneyPlanPage />} />
          <Route path="scout" element={<ScoutAIPage />} />
          <Route path="rewards" element={<RewardsPage />} />
          <Route path="team" element={<BusinessOnly><TeamPage /></BusinessOnly>} />
          <Route path="perks" element={<PerksPage />} />
          <Route path="statements" element={<StatementsPage />} />
          <Route path="disputes" element={<DisputesPage />} />
          <Route path="kyc" element={<KYCPage />} />
          <Route path="security" element={<SecurityCenterPage />} />
          <Route path="support-desk" element={<SupportCenterPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Route>

        <Route path="*" element={<SiteLayout><NotFoundPage /></SiteLayout>} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <ToastProvider>
          <HashRouter>
            <Shell />
          </HashRouter>
        </ToastProvider>
      </AuthProvider>
    </MotionConfig>
  );
}
