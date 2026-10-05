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
import { ClassicApp, MarketsPage } from "./pages/dashboards/ClassicDashboard";
import { useAcct } from "./lib/store";
import { SuperAdminPage } from "./pages/SuperAdmin";
import { ApplicationStatusPage } from "./pages/ApplicationStatus";
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

/**
 * Which dashboard a member gets.
 * Personal accounts keep the original member dashboard — its own chrome, home
 * page and routing (`ClassicApp`). Business accounts get the treasury shell and
 * staff get the control room, both of which bring their own layouts.
 */
/**
 * Holds the dashboard shut until a human has approved the application.
 *
 * The account exists as soon as someone signs up — what they don't get yet is
 * the dashboard. Anything other than `approved` lands on the status page, which
 * tells them where the application stands and what to do next.
 */
function RequireApproved({ children }: { children: React.ReactNode }) {
  const { account, accountError } = useAcct();
  const location = useLocation();
  // A failed load is not a review decision: let RequireAuth and the shell deal
  // with it rather than trapping the member on the status page.
  if (accountError) return <>{children}</>;
  if (!account) return <div className="route-loading"><span className="spinner" /></div>;
  if (account.kyc.review.state !== "approved" && location.pathname !== "/application") {
    return <Navigate to="/application" replace />;
  }
  return <>{children}</>;
}

function MemberSurface() {
  const { user } = useAuth();
  const staff = Boolean(user?.role && user.role !== "user");
  return !staff && user?.accountType !== "business" ? <ClassicApp /> : <DashboardLayout />;
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

        <Route
          path="/app"
          element={
            <RequireAuth>
              <AccountProvider>
                <MoneyFlowProvider>
                  <RequireApproved>
                    <MemberSurface />
                  </RequireApproved>
                </MoneyFlowProvider>
              </AccountProvider>
            </RequireAuth>
          }
        >
          <Route index element={<Overview />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="markets" element={<MarketsPage />} />
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

        {/* Between sign-up and approval: the member's whole account experience. */}
        <Route
          path="/application"
          element={
            <RequireAuth>
              <AccountProvider>
                <ApplicationStatusPage />
              </AccountProvider>
            </RequireAuth>
          }
        />

        {/* Staff console: its own shell (dark control room), not the member dashboard chrome. */}
        <Route path="/app/superadmin" element={<RequireAuth><SuperAdminPage /></RequireAuth>} />

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
