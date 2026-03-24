import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  FileDown,
  LayoutDashboard,
  LogOut,
  Package,
  Receipt,
  ShieldCheck,
  ShoppingCart,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { useLocalStorageState } from "./hooks/useLocalStorageState";
import {
  DEFAULT_CMV_TARGET,
  buildCalculatedRecord,
  compareTrend,
  formatCurrency,
  formatPercent,
  toNumber,
} from "./utils/cmv";

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "weekly", label: "CMV Semanal", icon: Calendar },
  { id: "monthly", label: "CMV Mensal", icon: BarChart3 },
  { id: "reports", label: "Relatórios", icon: Receipt },
  { id: "refeitorio", label: "Refeitório", icon: Users },
];

const SCREEN_PATHS = {
  landing: "/",
  dashboard: "/app",
  weekly: "/app/cmv-semanal",
  monthly: "/app/cmv-mensal",
  reports: "/app/relatorios",
  reportRestaurant: "/app/relatorios/restaurante",
  reportRefeitorio: "/app/relatorios/refeitorio",
  refeitorio: "/app/refeitorio",
  admin: "/app/admin",
};

function getScreenFromPath(pathname) {
  if (pathname === "/") return "landing";
  const match = Object.entries(SCREEN_PATHS).find(([, path]) => path === pathname);
  return match?.[0] ?? "landing";
}

function isScreenAllowedForRole(role, screen) {
  if (role === "admin") return screen === "admin";
  if (role === "viewer") {
    return ["dashboard", "reports", "reportRestaurant", "reportRefeitorio", "refeitorio"].includes(screen);
  }
  return screen !== "admin";
}

function translateRole(role) {
  if (role === "admin") return "Administrador";
  if (role === "viewer") return "Visualizador";
  return "Colaborador";
}

const baseEntry = {
  reference: "",
  estoqueInicial: "",
  compras: "",
  estoqueFinal: "",
  faturamento: "",
  perdas: "",
};

const MONTH_OPTIONS = [
  { value: 1, label: "Janeiro" },
  { value: 2, label: "Fevereiro" },
  { value: 3, label: "Março" },
  { value: 4, label: "Abril" },
  { value: 5, label: "Maio" },
  { value: 6, label: "Junho" },
  { value: 7, label: "Julho" },
  { value: 8, label: "Agosto" },
  { value: 9, label: "Setembro" },
  { value: 10, label: "Outubro" },
  { value: 11, label: "Novembro" },
  { value: 12, label: "Dezembro" },
];

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5174";

function App() {
  const [currentScreen, setCurrentScreen] = useState(() => getScreenFromPath(window.location.pathname));
  const [cmvTarget, setCmvTarget] = useLocalStorageState("cmv-target", DEFAULT_CMV_TARGET);
  const [weeklyEntries, setWeeklyEntries] = useState([]);
  const [monthlyEntries, setMonthlyEntries] = useState([]);
  const [weeklyForm, setWeeklyForm] = useState(baseEntry);
  const [monthlyForm, setMonthlyForm] = useState(baseEntry);
  const [editingWeeklyId, setEditingWeeklyId] = useState(null);
  const [editingMonthlyId, setEditingMonthlyId] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [authStatus, setAuthStatus] = useState("loading");
  const [authMessage, setAuthMessage] = useState("");

  useEffect(() => {
    const handlePopState = () => setCurrentScreen(getScreenFromPath(window.location.pathname));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const loadMe = async () => {
      try {
        const response = await fetch(`${API_BASE}/me`, { credentials: "include" });
        if (response.status === 401) {
          setAuthStatus("logged_out");
          setCurrentUser(null);
          return;
        }
        const payload = await response.json();
        if (!payload.ok) {
          setAuthStatus("logged_out");
          setCurrentUser(null);
          return;
        }
        if (payload.user?.status && payload.user.status !== "approved") {
          setAuthStatus(payload.user.status);
          setCurrentUser(payload.user);
          return;
        }
        setCurrentUser(payload.user);
        setAuthStatus("approved");
      } catch (error) {
        setAuthStatus("logged_out");
        setCurrentUser(null);
      }
    };
    loadMe();
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    const path = SCREEN_PATHS[currentScreen] ?? "/";
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
  }, [currentScreen, currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    if (currentScreen === "landing") {
      setCurrentScreen("dashboard");
      return;
    }
    const allowed = isScreenAllowedForRole(currentUser.role, currentScreen);
    if (!allowed) {
      setCurrentScreen(currentUser.role === "admin" ? "admin" : "dashboard");
    }
  }, [currentScreen, currentUser]);

  const calculatedWeekly = useMemo(
    () => [...weeklyEntries].map((entry) => buildCalculatedRecord(entry, cmvTarget)).reverse(),
    [weeklyEntries, cmvTarget]
  );

  const calculatedMonthly = useMemo(
    () => [...monthlyEntries].map((entry) => buildCalculatedRecord(entry, cmvTarget)).reverse(),
    [monthlyEntries, cmvTarget]
  );

  const latestWeek = calculatedWeekly[0];
  const previousWeek = calculatedWeekly[1];
  const latestMonth = calculatedMonthly[0];
  const previousMonth = calculatedMonthly[1];

  const weekTrend = compareTrend(latestWeek?.cmvPercent ?? 0, previousWeek?.cmvPercent ?? 0);
  const monthTrend = compareTrend(latestMonth?.cmvPercent ?? 0, previousMonth?.cmvPercent ?? 0);

  const dashboardInsights = useMemo(() => {
    const insights = [];

    if ((latestWeek?.cmvPercent ?? 0) > 40 || (latestMonth?.cmvPercent ?? 0) > 40) {
      insights.push("Alerta: CMV acima do ideal. Verifique desperdícios ou aumento de custos.");
    }

    if ((latestWeek?.purchasesPercent ?? 0) > 45 || (latestMonth?.purchasesPercent ?? 0) > 45) {
      insights.push("Compras muito altas em relacao ao faturamento.");
    }

    if ((toNumber(latestWeek?.perdas) > 0 && toNumber(latestWeek?.perdas) / Math.max(toNumber(latestWeek?.faturamento), 1) > 0.06) ||
      (toNumber(latestMonth?.perdas) > 0 && toNumber(latestMonth?.perdas) / Math.max(toNumber(latestMonth?.faturamento), 1) > 0.06)) {
      insights.push("Desperdicio elevado registrado.");
    }

    if (!insights.length) {
      insights.push("Indicadores dentro da faixa esperada. Mantenha o controle semanal de estoque e perdas.");
    }

    return insights;
  }, [latestMonth, latestWeek]);

  const chartWeeklyData = calculatedWeekly
    .slice()
    .reverse()
    .map((entry) => ({
      reference: entry.reference,
      cmvPercent: Number(entry.cmvPercent.toFixed(2)),
    }));

  const chartMonthlyData = calculatedMonthly
    .slice()
    .reverse()
    .map((entry) => ({
      reference: entry.reference,
      cmvPercent: Number(entry.cmvPercent.toFixed(2)),
    }));

  const comparisonData = [
    {
      metric: "Semanal",
      cmvPercent: Number((latestWeek?.cmvPercent ?? 0).toFixed(2)),
      purchasesPercent: Number((latestWeek?.purchasesPercent ?? 0).toFixed(2)),
      target: Number(toNumber(cmvTarget).toFixed(2)),
    },
    {
      metric: "Mensal",
      cmvPercent: Number((latestMonth?.cmvPercent ?? 0).toFixed(2)),
      purchasesPercent: Number((latestMonth?.purchasesPercent ?? 0).toFixed(2)),
      target: Number(toNumber(cmvTarget).toFixed(2)),
    },
  ];

  const loadWeekly = async () => {
    const response = await fetch(`${API_BASE}/data/cmv/weekly`, { credentials: "include" });
    if (!response.ok) return;
    const payload = await response.json();
    if (!payload.ok) return;
    setWeeklyEntries(payload.data.map(mapWeeklyFromApi));
  };

  const loadMonthly = async () => {
    const response = await fetch(`${API_BASE}/data/cmv/monthly`, { credentials: "include" });
    if (!response.ok) return;
    const payload = await response.json();
    if (!payload.ok) return;
    setMonthlyEntries(payload.data.map(mapMonthlyFromApi));
  };

  useEffect(() => {
    if (!currentUser || currentUser.status !== "approved" || currentUser.role === "admin") return;
    loadWeekly();
    loadMonthly();
  }, [currentUser]);

  const saveWeekly = (event) => {
    event.preventDefault();
    if (!weeklyForm.reference) return;
    const existing = editingWeeklyId ? weeklyEntries.find((item) => item.id === editingWeeklyId) : null;

    const payload = {
      id: editingWeeklyId ?? crypto.randomUUID(),
      reference: weeklyForm.reference,
      estoqueInicial: toNumber(weeklyForm.estoqueInicial),
      compras: toNumber(weeklyForm.compras),
      estoqueFinal: toNumber(weeklyForm.estoqueFinal),
      faturamento: toNumber(weeklyForm.faturamento),
      perdas: toNumber(weeklyForm.perdas),
      createdBy: existing?.createdBy ?? (currentUser?.username ?? "Desconhecido"),
      createdAt: Date.now(),
    };

    saveWeeklyApi(payload).then(loadWeekly);
    setWeeklyForm(baseEntry);
    setEditingWeeklyId(null);
  };

  const saveMonthly = (event) => {
    event.preventDefault();
    if (!monthlyForm.reference) return;
    const existing = editingMonthlyId ? monthlyEntries.find((item) => item.id === editingMonthlyId) : null;

    const payload = {
      id: editingMonthlyId ?? crypto.randomUUID(),
      reference: monthlyForm.reference,
      estoqueInicial: toNumber(monthlyForm.estoqueInicial),
      compras: toNumber(monthlyForm.compras),
      estoqueFinal: toNumber(monthlyForm.estoqueFinal),
      faturamento: toNumber(monthlyForm.faturamento),
      perdas: toNumber(monthlyForm.perdas),
      createdBy: existing?.createdBy ?? (currentUser?.username ?? "Desconhecido"),
      createdAt: Date.now(),
    };

    saveMonthlyApi(payload).then(loadMonthly);
    setMonthlyForm(baseEntry);
    setEditingMonthlyId(null);
  };

  const startWeeklyEdit = (record) => {
    setEditingWeeklyId(record.id);
    setWeeklyForm({
      reference: record.reference ?? "",
      estoqueInicial: String(toNumber(record.estoqueInicial)),
      compras: String(toNumber(record.compras)),
      estoqueFinal: String(toNumber(record.estoqueFinal)),
      faturamento: String(toNumber(record.faturamento)),
      perdas: String(toNumber(record.perdas)),
    });
  };

  const startMonthlyEdit = (record) => {
    setEditingMonthlyId(record.id);
    setMonthlyForm({
      reference: record.reference ?? "",
      estoqueInicial: String(toNumber(record.estoqueInicial)),
      compras: String(toNumber(record.compras)),
      estoqueFinal: String(toNumber(record.estoqueFinal)),
      faturamento: String(toNumber(record.faturamento)),
      perdas: String(toNumber(record.perdas)),
    });
  };

  const cancelWeeklyEdit = () => {
    setEditingWeeklyId(null);
    setWeeklyForm(baseEntry);
  };

  const cancelMonthlyEdit = () => {
    setEditingMonthlyId(null);
    setMonthlyForm(baseEntry);
  };

  const logout = () => {
    fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: "include" }).finally(() => {
      setCurrentUser(null);
      setAuthStatus("logged_out");
      setCurrentScreen("dashboard");
    });
  };

  if (currentScreen === "landing") {
    if (currentUser) {
      setCurrentScreen("dashboard");
      return null;
    }
    return <LandingView onLogin={() => (window.location.href = `${API_BASE}/auth/google/login`)} />;
  }

  if (!currentUser || currentUser.status !== "approved") {
    return (
      <AuthView
        status={authStatus}
        message={authMessage}
        onLogin={() => (window.location.href = `${API_BASE}/auth/google/login`)}
        onRetry={() => window.location.reload()}
      />
    );
  }

  const visibleNavItems = currentUser.role === "admin"
    ? [{ id: "admin", label: "Aprovações", icon: ShieldCheck }]
    : NAV_ITEMS.filter((item) => {
        if (currentUser.role === "viewer") {
          return ["dashboard", "reports", "refeitorio"].includes(item.id);
        }
        return true;
      });

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="mx-auto flex w-full max-w-7xl gap-4 lg:gap-6">
        <aside className="card-surface h-fit w-full p-4 lg:sticky lg:top-6 lg:w-64">
          <h1 className="text-2xl font-semibold text-ink">CMV Control</h1>
          <p className="mt-1 text-sm text-slate-500">Painel de Controle</p>
          <p className="mt-4 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
            {(currentUser.name || currentUser.email)} ({translateRole(currentUser.role)})
          </p>

          <nav className="mt-6 space-y-1">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const active =
                currentScreen === item.id ||
                (item.id === "reports" && (currentScreen === "reportRestaurant" || currentScreen === "reportRefeitorio"));

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setCurrentScreen(item.id)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition ${
                    active
                      ? "bg-brand-600 text-white"
                      : "text-slate-600 hover:bg-brand-50 hover:text-brand-700"
                  }`}
                >
                  <Icon size={18} />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <button
            type="button"
            onClick={logout}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <LogOut size={16} />
            Sair
          </button>
          <p className="mt-3 text-center text-xs text-slate-500">Desenvolvido por Eliabe Paulo.</p>
        </aside>

        <main className="flex-1 space-y-4 animate-rise md:space-y-6">
          {currentScreen === "dashboard" && (
            <DashboardView
              latestWeek={latestWeek}
              latestMonth={latestMonth}
              weekTrend={weekTrend}
              monthTrend={monthTrend}
              cmvTarget={cmvTarget}
              setCmvTarget={setCmvTarget}
              canEditTarget={currentUser.role !== "viewer"}
              comparisonData={comparisonData}
              chartWeeklyData={chartWeeklyData}
              chartMonthlyData={chartMonthlyData}
              dashboardInsights={dashboardInsights}
            />
          )}

          {currentScreen === "weekly" && currentUser.role !== "viewer" && (
            <EntryView
              title="CMV Semanal"
              subtitle="Registre os dados da semana para calcular CMV e percentuais automaticamente."
              formState={weeklyForm}
              setFormState={setWeeklyForm}
              referenceType="week"
              submit={saveWeekly}
              records={calculatedWeekly}
              isEditing={Boolean(editingWeeklyId)}
              onEditRecord={startWeeklyEdit}
              onCancelEdit={cancelWeeklyEdit}
            />
          )}

          {currentScreen === "monthly" && currentUser.role !== "viewer" && (
            <EntryView
              title="CMV Mensal"
              subtitle="Registre os dados do mês para consolidar o acompanhamento financeiro do CMV."
              formState={monthlyForm}
              setFormState={setMonthlyForm}
              referenceType="month"
              submit={saveMonthly}
              records={calculatedMonthly}
              isEditing={Boolean(editingMonthlyId)}
              onEditRecord={startMonthlyEdit}
              onCancelEdit={cancelMonthlyEdit}
            />
          )}

          {currentScreen === "reports" && (
            <ReportsHubView
              openRestaurantReport={() => setCurrentScreen("reportRestaurant")}
              openRefeitorioReport={() => setCurrentScreen("reportRefeitorio")}
            />
          )}

          {currentScreen === "reportRestaurant" && (
            <ReportsView
              weeklyRecords={calculatedWeekly}
              monthlyRecords={calculatedMonthly}
              cmvTarget={cmvTarget}
              chartWeeklyData={chartWeeklyData}
              chartMonthlyData={chartMonthlyData}
              comparisonData={comparisonData}
              onBack={() => setCurrentScreen("reports")}
            />
          )}

          {currentScreen === "reportRefeitorio" && <RefeitorioReportView onBack={() => setCurrentScreen("reports")} />}

          {currentScreen === "refeitorio" && (
            <RefeitorioView canEdit={currentUser.role !== "viewer"} actorName={currentUser.email} />
          )}

          {currentScreen === "admin" && currentUser.role === "admin" && (
            <AdminView />
          )}
        </main>
      </div>
      <footer className="mx-auto mt-6 flex w-full max-w-7xl flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>CMV Control</span>
        <div className="flex gap-4">
          <a className="hover:text-brand-700" href="/privacy.html" target="_blank" rel="noreferrer">
            Política de Privacidade
          </a>
          <a className="hover:text-brand-700" href="/terms.html" target="_blank" rel="noreferrer">
            Termos de Serviço
          </a>
        </div>
      </footer>
    </div>
  );
}

function AuthView({ status, message, onLogin, onRetry }) {
  const renderStatus = () => {
    if (status === "pending") {
      return "Conta pendente de aprovação do administrador.";
    }
    if (status === "rejected") {
      return "Conta reprovada pelo administrador.";
    }
    if (status === "revoked") {
      return "Acesso revogado pelo administrador.";
    }
    if (status === "loading") {
      return "Verificando sessão...";
    }
    return "";
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card-surface w-full max-w-md p-6">
        <h1 className="text-2xl font-semibold text-ink">Acesso ao CMV Control</h1>
        <p className="mt-1 text-sm text-slate-500">Entre com sua conta Google para continuar.</p>

        <button
          type="button"
          onClick={onLogin}
          className="mt-5 w-full rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Entrar com Google
        </button>

        {status && status !== "logged_out" && (
          <p className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">{renderStatus()}</p>
        )}
        {message && <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">{message}</p>}
        {(status === "pending" || status === "rejected" || status === "revoked") && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Verificar novamente
          </button>
        )}
        <p className="mt-4 text-center text-xs text-slate-500">Desenvolvido por Eliabe Paulo.</p>
      </div>
    </div>
  );
}

function LandingView({ onLogin }) {
  const weeklyData = [
    { label: "S1", value: 34 },
    { label: "S2", value: 32 },
    { label: "S3", value: 36 },
    { label: "S4", value: 33 },
  ];

  const monthlyData = [
    { label: "Out", value: 38 },
    { label: "Nov", value: 35 },
    { label: "Dez", value: 34 },
    { label: "Jan", value: 33 },
  ];

  return (
    <div className="flex min-h-screen flex-col justify-between bg-gradient-to-br from-white via-slate-50 to-brand-50">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <div>
          <h1 className="text-2xl font-semibold text-ink">CMV Control</h1>
          <p className="text-sm text-slate-500">Painel de Controle do restaurante</p>
        </div>
        <button
          type="button"
          onClick={onLogin}
          className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Entrar com Google
        </button>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 pb-10 pt-4">
        <div className="card-surface p-8">
          <h2 className="text-3xl font-semibold text-ink">Controle completo de CMV e Refeitório</h2>
          <p className="mt-3 max-w-2xl text-sm text-slate-600">
            Acompanhe indicadores semanais e mensais, gere relatórios e tenha rastreabilidade de cada registro com uma interface clara.
          </p>
          <div className="mt-6 flex flex-wrap gap-4">
            <button
              type="button"
              onClick={onLogin}
              className="rounded-xl bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Entrar com Google
            </button>
            <a className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" href="/privacy.html" target="_blank" rel="noreferrer">
              Política de Privacidade
            </a>
            <a className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" href="/terms.html" target="_blank" rel="noreferrer">
              Termos de Serviço
            </a>
          </div>
        </div>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="card-surface p-5">
            <p className="text-xs uppercase text-slate-500">CMV mensal medio</p>
            <p className="mt-2 text-base font-semibold text-ink">Indicador disponível</p>
          </div>
          <div className="card-surface p-5">
            <p className="text-xs uppercase text-slate-500">Compras %</p>
            <p className="mt-2 text-base font-semibold text-ink">Indicador disponível</p>
          </div>
          <div className="card-surface p-5">
            <p className="text-xs uppercase text-slate-500">Perdas mapeadas</p>
            <p className="mt-2 text-base font-semibold text-ink">Indicador disponível</p>
          </div>
          <div className="card-surface p-5">
            <p className="text-xs uppercase text-slate-500">Refeições mês</p>
            <p className="mt-2 text-base font-semibold text-ink">Indicador disponível</p>
          </div>
        </section>

        <section className="mt-6 grid gap-4 xl:grid-cols-2">
          <ChartCard title="Tendência CMV semanal">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={weeklyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dbe2ea" />
                <XAxis dataKey="label" />
                <YAxis domain={[0, 50]} unit="%" />
                <Tooltip formatter={(value) => `${value}%`} />
                <Line type="monotone" dataKey="value" stroke="#1793A5" strokeWidth={3} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Tendência CMV mensal">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dbe2ea" />
                <XAxis dataKey="label" />
                <YAxis domain={[0, 50]} unit="%" />
                <Tooltip formatter={(value) => `${value}%`} />
                <Bar dataKey="value" fill="#F6A740" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="card-surface p-5">
            <h3 className="text-base font-semibold text-ink">Governança</h3>
            <p className="mt-2 text-sm text-slate-600">Aprovação de usuários, perfis e controle por setor.</p>
          </div>
          <div className="card-surface p-5">
            <h3 className="text-base font-semibold text-ink">Relatórios</h3>
            <p className="mt-2 text-sm text-slate-600">Relatórios por restaurante e refeitório com PDF.</p>
          </div>
          <div className="card-surface p-5">
            <h3 className="text-base font-semibold text-ink">Rastreabilidade</h3>
            <p className="mt-2 text-sm text-slate-600">Cada registro com autor e histórico para auditoria.</p>
          </div>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-6 py-6 text-xs text-slate-500">
        Desenvolvido por Eliabe Paulo.
      </footer>
    </div>
  );
}

function AdminView() {
  const [approvalRoles, setApprovalRoles] = useState({});
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadUsers = async () => {
    setLoading(true);
    const response = await fetch(`${API_BASE}/admin/users`, { credentials: "include" });
    const payload = await response.json();
    if (payload.ok) {
      setUsers(payload.users);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const updateUser = async (userId, changes) => {
    await fetch(`${API_BASE}/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(changes),
    });
    loadUsers();
  };

  const approveUser = (userId) => {
    const chosenRole = approvalRoles[userId] || "viewer";
    updateUser(userId, { status: "approved", role: chosenRole });
  };

  const rejectUser = (userId) => updateUser(userId, { status: "rejected" });
  const changeUserRole = (userId, role) => updateUser(userId, { role });
  const revokeUser = (userId) => updateUser(userId, { status: "revoked" });
  const reactivateUser = (userId) => updateUser(userId, { status: "approved" });

  const pendingUsers = users.filter((user) => user.role !== "admin" && user.status === "pending");
  const managedUsers = users.filter((user) => user.role !== "admin" && user.status !== "pending");

  return (
    <div className="space-y-4">
      <section className="card-surface p-5">
        <h2 className="text-xl font-semibold text-ink">Administracao de acessos</h2>
        <p className="mt-1 text-sm text-slate-500">Aprove, reprove, altere perfis e revogue acessos.</p>
      </section>

      <section className="card-surface p-5">
        <h3 className="text-lg font-semibold text-ink">Solicitacoes pendentes</h3>
        <div className="mt-4 space-y-3">
          {loading && <p className="text-sm text-slate-500">Carregando usuários...</p>}
          {!loading && pendingUsers.length === 0 && <p className="text-sm text-slate-500">Nenhuma solicitacao pendente.</p>}
          {pendingUsers.map((user) => (
            <div key={user.id} className="rounded-xl border border-slate-200 p-4">
              <p className="font-medium text-ink">{user.name || "Sem nome"}</p>
              <p className="text-xs text-slate-500">{user.email}</p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="text-sm text-slate-600">
                  Tipo de usuário
                  <select
                    value={approvalRoles[user.id] || "viewer"}
                    onChange={(event) => setApprovalRoles((current) => ({ ...current, [user.id]: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                  >
                    <option value="viewer">Visualizador</option>
                    <option value="collaborator">Colaborador</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => approveUser(user.id)}
                  className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  Aprovar
                </button>
                <button
                  type="button"
                  onClick={() => rejectUser(user.id)}
                  className="rounded-xl bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
                >
                  Reprovar
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card-surface p-5">
        <h3 className="text-lg font-semibold text-ink">Usuários gerenciados</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">Usuário</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Perfil</th>
                <th className="px-4 py-3 text-left">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {managedUsers.map((user) => (
                <tr key={user.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{user.name || "Sem nome"}</p>
                    <p className="text-xs text-slate-500">{user.email}</p>
                  </td>
                  <td className="px-4 py-3">{user.status}</td>
                  <td className="px-4 py-3">
                    <select
                      value={user.role}
                      onChange={(event) => changeUserRole(user.id, event.target.value)}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
                      disabled={user.status !== "approved"}
                    >
                      <option value="viewer">Visualizador</option>
                      <option value="collaborator">Colaborador</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    {user.status === "approved" ? (
                      <button
                        type="button"
                        onClick={() => revokeUser(user.id)}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                      >
                        Revogar
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => reactivateUser(user.id)}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                      >
                        Aprovar novamente
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && managedUsers.length === 0 && (
                <tr>
                  <td className="px-4 py-4 text-slate-500" colSpan={4}>
                    Nenhum usuário para gerenciar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function DashboardView({
  latestWeek,
  latestMonth,
  weekTrend,
  monthTrend,
  cmvTarget,
  setCmvTarget,
  canEditTarget,
  comparisonData,
  chartWeeklyData,
  chartMonthlyData,
  dashboardInsights,
}) {
  const weekHealth = latestWeek?.health;
  const monthHealth = latestMonth?.health;

  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          title="CMV Mensal"
          value={formatCurrency(latestMonth?.cmv ?? 0)}
          percent={formatPercent(latestMonth?.cmvPercent ?? 0)}
          icon={Package}
          trend={monthTrend}
        />
        <KpiCard
          title="Faturamento do Mês"
          value={formatCurrency(latestMonth?.faturamento ?? 0)}
          percent={formatPercent(latestMonth?.cmvPercent ?? 0)}
          icon={Wallet}
          trend={monthTrend}
        />
        <KpiCard
          title="Compras do Mês"
          value={formatCurrency(latestMonth?.compras ?? 0)}
          percent={formatPercent(latestMonth?.purchasesPercent ?? 0)}
          icon={ShoppingCart}
          trend={monthTrend}
        />
        <KpiCard
          title="CMV Semanal"
          value={formatCurrency(latestWeek?.cmv ?? 0)}
          percent={formatPercent(latestWeek?.cmvPercent ?? 0)}
          icon={BarChart3}
          trend={weekTrend}
        />
        <KpiCard
          title="Faturamento da Semana"
          value={formatCurrency(latestWeek?.faturamento ?? 0)}
          percent={formatPercent(latestWeek?.cmvPercent ?? 0)}
          icon={Wallet}
          trend={weekTrend}
        />
        <KpiCard
          title="Compras da Semana"
          value={formatCurrency(latestWeek?.compras ?? 0)}
          percent={formatPercent(latestWeek?.purchasesPercent ?? 0)}
          icon={ShoppingCart}
          trend={weekTrend}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-4">
        <div className="card-surface p-4">
          <p className="text-sm text-slate-500">Meta de CMV</p>
          <div className="mt-3 flex items-center gap-3">
            <Target className="text-brand-600" size={20} />
            <input
              type="number"
              step="0.1"
              value={cmvTarget}
              onChange={(event) => setCmvTarget(toNumber(event.target.value))}
              disabled={!canEditTarget}
              className={`w-24 rounded-lg border border-slate-200 px-2 py-1 text-sm ${!canEditTarget ? "cursor-not-allowed bg-slate-100 text-slate-500" : ""}`}
            />
            <span className="text-sm font-medium">%</span>
          </div>
          {!canEditTarget && <p className="mt-2 text-xs text-slate-500">Perfil visualizador: edicao bloqueada.</p>}
        </div>

        <HealthCard title="Diferenca CMV x Meta" value={formatPercent((latestWeek?.targetDiff ?? 0))} health={latestWeek?.health} />
        <HealthCard title="Compras % Semana" value={formatPercent(latestWeek?.purchasesPercent ?? 0)} health={latestWeek?.health} />
        <HealthCard title="Perdas Semana" value={formatCurrency(latestWeek?.perdas ?? 0)} health={latestWeek?.health} />

        <div className="card-surface p-4 lg:col-span-4">
          <p className="text-sm text-slate-500">Indicador de saúde</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <StatusBadge label={`Semana: ${weekHealth?.label ?? "Sem dados"}`} health={weekHealth} />
            <StatusBadge label={`Mês: ${monthHealth?.label ?? "Sem dados"}`} health={monthHealth} />
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Evolucao do CMV semanal %">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartWeeklyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#dbe2ea" />
              <XAxis dataKey="reference" />
              <YAxis domain={[0, 100]} unit="%" />
              <Tooltip formatter={(value) => `${value}%`} />
              <Line type="monotone" dataKey="cmvPercent" stroke="#1793A5" strokeWidth={3} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Evolucao do CMV mensal %">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartMonthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#dbe2ea" />
              <XAxis dataKey="reference" />
              <YAxis domain={[0, 100]} unit="%" />
              <Tooltip formatter={(value) => `${value}%`} />
              <Line type="monotone" dataKey="cmvPercent" stroke="#F6A740" strokeWidth={3} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Comparacao CMV %, Compras % e Meta">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={comparisonData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#dbe2ea" />
              <XAxis dataKey="metric" />
              <YAxis domain={[0, 100]} unit="%" />
              <Tooltip formatter={(value) => `${value}%`} />
              <Legend />
              <Bar dataKey="cmvPercent" fill="#1793A5" name="CMV %" radius={[6, 6, 0, 0]} />
              <Bar dataKey="purchasesPercent" fill="#4f46e5" name="Compras %" radius={[6, 6, 0, 0]} />
              <Bar dataKey="target" fill="#F6A740" name="Meta %" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </section>

      <section className="card-surface p-5">
        <h3 className="text-lg font-semibold text-ink">Insights automaticos</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {dashboardInsights.map((insight) => (
            <div key={insight} className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-700">
              {insight}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function EntryView({
  title,
  subtitle,
  formState,
  setFormState,
  referenceType,
  submit,
  records,
  isEditing,
  onEditRecord,
  onCancelEdit,
}) {
  const inputType = referenceType === "week" ? "week" : "month";
  const preview = formState.reference
    ? buildCalculatedRecord(
        {
          ...formState,
          estoqueInicial: toNumber(formState.estoqueInicial),
          compras: toNumber(formState.compras),
          estoqueFinal: toNumber(formState.estoqueFinal),
          faturamento: toNumber(formState.faturamento),
          perdas: toNumber(formState.perdas),
        },
        DEFAULT_CMV_TARGET
      )
    : null;

  return (
    <>
      <section className="card-surface p-5">
        <h2 className="text-xl font-semibold text-ink">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>

        <form className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3" onSubmit={submit}>
          <InputField
            label={referenceType === "week" ? "Semana de referência" : "Mês de referência"}
            type={inputType}
            value={formState.reference}
            onChange={(value) => setFormState((current) => ({ ...current, reference: value }))}
            required
          />
          <InputField
            label="Estoque inicial"
            value={formState.estoqueInicial}
            onChange={(value) => setFormState((current) => ({ ...current, estoqueInicial: value }))}
            type="number"
            step="0.01"
            required
          />
          <InputField
            label="Compras"
            value={formState.compras}
            onChange={(value) => setFormState((current) => ({ ...current, compras: value }))}
            type="number"
            step="0.01"
            required
          />
          <InputField
            label="Estoque final"
            value={formState.estoqueFinal}
            onChange={(value) => setFormState((current) => ({ ...current, estoqueFinal: value }))}
            type="number"
            step="0.01"
            required
          />
          <InputField
            label="Faturamento"
            value={formState.faturamento}
            onChange={(value) => setFormState((current) => ({ ...current, faturamento: value }))}
            type="number"
            step="0.01"
            required
          />
          <InputField
            label="Perdas ou desperdícios"
            value={formState.perdas}
            onChange={(value) => setFormState((current) => ({ ...current, perdas: value }))}
            type="number"
            step="0.01"
            required
          />

          <div className="md:col-span-2 xl:col-span-3">
            <button
              className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
              type="submit"
            >
              {isEditing ? "Atualizar registro" : "Salvar registro"}
            </button>
            {isEditing && (
              <button
                className="ml-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                type="button"
                onClick={onCancelEdit}
              >
                Cancelar edicao
              </button>
            )}
          </div>
        </form>

        {preview && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <PreviewCard label="CMV" value={formatCurrency(preview.cmv)} />
            <PreviewCard label="CMV %" value={formatPercent(preview.cmvPercent)} />
            <PreviewCard label="Compras %" value={formatPercent(preview.purchasesPercent)} />
          </div>
        )}
      </section>

      <section className="card-surface overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-lg font-semibold text-ink">Histórico</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">Referencia</th>
                <th className="px-4 py-3 text-left">CMV</th>
                <th className="px-4 py-3 text-left">CMV %</th>
                <th className="px-4 py-3 text-left">Compras %</th>
                <th className="px-4 py-3 text-left">Perdas</th>
                <th className="px-4 py-3 text-left">Registrado por</th>
                <th className="px-4 py-3 text-left">Saude</th>
                <th className="px-4 py-3 text-left">Acao</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 && (
                <tr>
                  <td className="px-4 py-4 text-slate-500" colSpan={8}>
                    Nenhum registro salvo.
                  </td>
                </tr>
              )}
              {records.map((record) => (
                <tr key={record.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">{record.reference}</td>
                  <td className="px-4 py-3">{formatCurrency(record.cmv)}</td>
                  <td className="px-4 py-3">{formatPercent(record.cmvPercent)}</td>
                  <td className="px-4 py-3">{formatPercent(record.purchasesPercent)}</td>
                  <td className="px-4 py-3">{formatCurrency(record.perdas)}</td>
                  <td className="px-4 py-3">{record.createdBy ?? "-"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge label={record.health.label} health={record.health} />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => onEditRecord(record)}
                      className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function ReportsHubView({ openRestaurantReport, openRefeitorioReport }) {
  return (
    <section className="grid gap-4 md:grid-cols-2">
      <button
        type="button"
        onClick={openRestaurantReport}
        className="card-surface p-6 text-left transition hover:scale-[1.01] hover:border-brand-200"
      >
        <p className="text-sm uppercase tracking-wide text-brand-700">Relatórios</p>
        <h3 className="mt-2 text-2xl font-semibold text-ink">Relatório Restaurante</h3>
        <p className="mt-2 text-sm text-slate-500">
          KPIs, análise de CMV, comparativos e histórico semanal/mensal com exportação em PDF.
        </p>
      </button>

      <button
        type="button"
        onClick={openRefeitorioReport}
        className="card-surface p-6 text-left transition hover:scale-[1.01] hover:border-brand-200"
      >
        <p className="text-sm uppercase tracking-wide text-brand-700">Relatórios</p>
        <h3 className="mt-2 text-2xl font-semibold text-ink">Relatório Refeitório</h3>
        <p className="mt-2 text-sm text-slate-500">
          Custos por refeição, totais mensais, refeições diárias e exportação em PDF.
        </p>
      </button>
    </section>
  );
}

function ReportsView({
  weeklyRecords,
  monthlyRecords,
  cmvTarget,
  chartWeeklyData,
  chartMonthlyData,
  comparisonData,
  onBack,
}) {
  const weeklyAvg = average(weeklyRecords.map((record) => record.cmvPercent));
  const monthlyAvg = average(monthlyRecords.map((record) => record.cmvPercent));
  const weeklyLosses = sum(weeklyRecords.map((record) => toNumber(record.perdas)));
  const monthlyLosses = sum(monthlyRecords.map((record) => toNumber(record.perdas)));
  const printRef = useRef(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGeneratePdf = async () => {
    if (!printRef.current || isGenerating) return;

    try {
      setIsGenerating(true);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const canvas = await html2canvas(printRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
      });

      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const printableWidth = pageWidth - margin * 2;
      const printableHeight = pageHeight - margin * 2;
      const imageHeight = (canvas.height * printableWidth) / canvas.width;
      const imageData = canvas.toDataURL("image/png");

      let heightLeft = imageHeight;
      let position = margin;

      pdf.addImage(imageData, "PNG", margin, position, printableWidth, imageHeight, undefined, "FAST");
      heightLeft -= printableHeight;

      while (heightLeft > 0) {
        position = margin - (imageHeight - heightLeft);
        pdf.addPage();
        pdf.addImage(imageData, "PNG", margin, position, printableWidth, imageHeight, undefined, "FAST");
        heightLeft -= printableHeight;
      }

      const date = new Date().toISOString().slice(0, 10);
      pdf.save(`relatorio-cmv-${date}.pdf`);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="card-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-ink">Relatório Restaurante</h2>
            <p className="mt-1 text-sm text-slate-500">Indicadores e histórico do setor restaurante.</p>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Voltar
          </button>
        </div>
      </section>

      <section className="card-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-ink">Emissao de relatorio</h3>
            <p className="text-sm text-slate-500">
              Gere um PDF com graficos, medias, comparativo e registros semanal/mensal.
            </p>
          </div>
          <button
            type="button"
            onClick={handleGeneratePdf}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <FileDown size={16} />
            {isGenerating ? "Gerando PDF..." : "Emitir PDF"}
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="card-surface p-5">
          <h3 className="text-lg font-semibold text-ink">Resumo semanal</h3>
          <p className="mt-4 text-sm text-slate-600">Media de CMV %: <strong>{formatPercent(weeklyAvg)}</strong></p>
          <p className="mt-2 text-sm text-slate-600">Perdas acumuladas: <strong>{formatCurrency(weeklyLosses)}</strong></p>
          <p className="mt-2 text-sm text-slate-600">Registros: <strong>{weeklyRecords.length}</strong></p>
        </div>

        <div className="card-surface p-5">
          <h3 className="text-lg font-semibold text-ink">Resumo mensal</h3>
          <p className="mt-4 text-sm text-slate-600">Media de CMV %: <strong>{formatPercent(monthlyAvg)}</strong></p>
          <p className="mt-2 text-sm text-slate-600">Perdas acumuladas: <strong>{formatCurrency(monthlyLosses)}</strong></p>
          <p className="mt-2 text-sm text-slate-600">Registros: <strong>{monthlyRecords.length}</strong></p>
        </div>

        <div className="card-surface p-5 md:col-span-2">
          <h3 className="text-lg font-semibold text-ink">Analise de meta</h3>
          <p className="mt-3 text-sm text-slate-600">
            Meta atual: <strong>{formatPercent(cmvTarget)}</strong>
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Semanal acima da meta: <strong>{weeklyRecords.filter((record) => record.cmvPercent > cmvTarget).length}</strong>
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Mensal acima da meta: <strong>{monthlyRecords.filter((record) => record.cmvPercent > cmvTarget).length}</strong>
          </p>
        </div>
      </section>

      <ReportRecordsTable title="Registros semanais detalhados" records={weeklyRecords} />
      <ReportRecordsTable title="Registros mensais detalhados" records={monthlyRecords} />

      <div className="fixed -left-[99999px] top-0 w-[1180px] bg-white p-8 text-black" ref={printRef}>
        <h1 className="text-2xl font-semibold">Relatório CMV</h1>
        <p className="mt-1 text-sm">Data de emissao: {new Date().toLocaleDateString("pt-BR")}</p>

        <section className="mt-6 grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-slate-200 p-4">
            <h2 className="text-base font-semibold">Media de CMV semanal</h2>
            <p className="mt-2 text-lg">{formatPercent(weeklyAvg)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <h2 className="text-base font-semibold">Media de CMV mensal</h2>
            <p className="mt-2 text-lg">{formatPercent(monthlyAvg)}</p>
          </div>
        </section>

        <section className="mt-6 grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-slate-200 p-4">
            <h2 className="mb-3 text-base font-semibold">Evolucao do CMV semanal %</h2>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={chartWeeklyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dbe2ea" />
                <XAxis dataKey="reference" />
                <YAxis domain={[0, 100]} unit="%" />
                <Tooltip formatter={(value) => `${value}%`} />
                <Line type="monotone" dataKey="cmvPercent" stroke="#1793A5" strokeWidth={3} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <h2 className="mb-3 text-base font-semibold">Evolucao do CMV mensal %</h2>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={chartMonthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dbe2ea" />
                <XAxis dataKey="reference" />
                <YAxis domain={[0, 100]} unit="%" />
                <Tooltip formatter={(value) => `${value}%`} />
                <Line type="monotone" dataKey="cmvPercent" stroke="#F6A740" strokeWidth={3} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-slate-200 p-4">
          <h2 className="mb-3 text-base font-semibold">Comparacao CMV %, Compras % e Meta</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={comparisonData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#dbe2ea" />
              <XAxis dataKey="metric" />
              <YAxis domain={[0, 100]} unit="%" />
              <Tooltip formatter={(value) => `${value}%`} />
              <Legend />
              <Bar dataKey="cmvPercent" fill="#1793A5" name="CMV %" radius={[6, 6, 0, 0]} />
              <Bar dataKey="purchasesPercent" fill="#4f46e5" name="Compras %" radius={[6, 6, 0, 0]} />
              <Bar dataKey="target" fill="#F6A740" name="Meta %" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>

        <section className="mt-6 rounded-lg border border-slate-200 p-4">
          <h2 className="text-base font-semibold">Registros da semana</h2>
          <ReportRecordsStaticTable records={weeklyRecords} />
        </section>

        <section className="mt-6 rounded-lg border border-slate-200 p-4">
          <h2 className="text-base font-semibold">Registros do mês</h2>
          <ReportRecordsStaticTable records={monthlyRecords} />
        </section>
      </div>
    </div>
  );
}

function RefeitorioReportView({ onBack }) {
  const today = new Date();
  const currentMonth = today.getMonth() + 1;
  const currentYear = today.getFullYear();
  const yearOptions = Array.from({ length: 7 }, (_, index) => currentYear - 3 + index);
  const [tabelaRefeitorioMensal] = useLocalStorageState("tabela_refeitorio_mensal", []);
  const [tabelaRefeicoesDiarias] = useLocalStorageState("tabela_refeicoes_diarias", []);
  const [filtro, setFiltro] = useState({ mes: currentMonth, ano: currentYear });
  const [periodo, setPeriodo] = useState({ mes: currentMonth, ano: currentYear });
  const [isGenerating, setIsGenerating] = useState(false);
  const reportRef = useRef(null);
  const [monthlyData, setMonthlyData] = useState([]);
  const [dailyData, setDailyData] = useState([]);

  useEffect(() => {
    loadRefeitorioReportData();
  }, []);

  const loadRefeitorioReportData = async () => {
    const [monthlyRes, dailyRes] = await Promise.all([
      fetch(`${API_BASE}/data/refeitorio/monthly`, { credentials: "include" }),
      fetch(`${API_BASE}/data/refeitorio/daily`, { credentials: "include" }),
    ]);
    if (!monthlyRes.ok || !dailyRes.ok) return;
    const monthlyPayload = await monthlyRes.json();
    const dailyPayload = await dailyRes.json();
    if (!monthlyPayload.ok || !dailyPayload.ok) return;
    setMonthlyData(monthlyPayload.data.map(mapRefeitorioMonthlyFromApi));
    setDailyData(dailyPayload.data.map(mapRefeitorioDailyFromApi));
  };

  const registroMensal = useMemo(
    () =>
      monthlyData.find(
        (item) => item.mes === toNumber(periodo.mes) && item.ano === toNumber(periodo.ano)
      ),
    [periodo.ano, periodo.mes, monthlyData]
  );

  const rowsDiarias = useMemo(
    () => buildDailyMealRows(toNumber(periodo.mes), toNumber(periodo.ano), dailyData),
    [periodo.ano, periodo.mes, dailyData]
  );

  const totalRefeicoes = registroMensal
    ? toNumber(registroMensal.total_refeicoes)
    : sum(rowsDiarias.map((row) => toNumber(row.qtdRefeicoes)));
  const custoTotal = registroMensal ? toNumber(registroMensal.custo_total) : 0;
  const comprasMes = registroMensal ? toNumber(registroMensal.compras_mes) : 0;
  const custoPorRefeicao =
    registroMensal ? toNumber(registroMensal.custo_por_refeicao) : totalRefeicoes > 0 ? custoTotal / totalRefeicoes : 0;
  const costStatus = getMealCostStatus(custoPorRefeicao);

  const dailyChartData = rowsDiarias.map((row) => ({
    dia: row.label,
    refeicoes: toNumber(row.qtdRefeicoes),
  }));

  const trendData = useMemo(() => {
    let acumulado = 0;
    return rowsDiarias.map((row) => {
      acumulado += toNumber(row.qtdRefeicoes);
      return {
        dia: row.label,
        custoAcumulado: acumulado * custoPorRefeicao,
      };
    });
  }, [custoPorRefeicao, rowsDiarias]);

  const generatePdf = async () => {
    if (!reportRef.current || isGenerating) return;
    try {
      setIsGenerating(true);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
      });
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const printableWidth = pageWidth - margin * 2;
      const printableHeight = pageHeight - margin * 2;
      const imageHeight = (canvas.height * printableWidth) / canvas.width;
      const imageData = canvas.toDataURL("image/png");

      let heightLeft = imageHeight;
      let position = margin;

      pdf.addImage(imageData, "PNG", margin, position, printableWidth, imageHeight, undefined, "FAST");
      heightLeft -= printableHeight;

      while (heightLeft > 0) {
        position = margin - (imageHeight - heightLeft);
        pdf.addPage();
        pdf.addImage(imageData, "PNG", margin, position, printableWidth, imageHeight, undefined, "FAST");
        heightLeft -= printableHeight;
      }

      const date = new Date().toISOString().slice(0, 10);
      pdf.save(`relatorio-refeitorio-${date}.pdf`);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="card-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-ink">Relatório Refeitório</h2>
            <p className="mt-1 text-sm text-slate-500">Resumo mensal e evolução diária de custo/refeições.</p>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Voltar
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <label className="text-sm text-slate-600">
            Mês
            <select
              value={filtro.mes}
              onChange={(event) => setFiltro((current) => ({ ...current, mes: toNumber(event.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
            >
              {MONTH_OPTIONS.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-600">
            Ano
            <select
              value={filtro.ano}
              onChange={(event) => setFiltro((current) => ({ ...current, ano: toNumber(event.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={() => setPeriodo({ mes: toNumber(filtro.mes), ano: toNumber(filtro.ano) })}
              className="w-full rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700 transition hover:bg-brand-100"
            >
              Carregar dados
            </button>
          </div>

          <div className="flex items-end">
            <button
              type="button"
              onClick={generatePdf}
              disabled={isGenerating}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <FileDown size={16} />
              {isGenerating ? "Gerando PDF..." : "Emitir PDF"}
            </button>
          </div>
        </div>
      </section>

      <div className="space-y-4" ref={reportRef}>
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <RefeitorioStatCard title="Custo por colaborador" value={formatCurrency(custoPorRefeicao)} badge={costStatus} />
          <RefeitorioStatCard title="Total de refeições" value={String(totalRefeicoes)} />
          <RefeitorioStatCard title="Custo total do refeitório" value={formatCurrency(custoTotal)} />
          <RefeitorioStatCard title="Compras do mês" value={formatCurrency(comprasMes)} />
        </section>
        <p className="text-sm text-slate-500">
          Registro mensal inserido por: <strong>{registroMensal?.created_by ?? "-"}</strong>
        </p>

        <section className="grid gap-4 xl:grid-cols-2">
          <ChartCard title="Refeições servidas por dia">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={dailyChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dbe2ea" />
                <XAxis dataKey="dia" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="refeicoes" stroke="#1793A5" strokeWidth={3} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Tendência de custo ao longo do mês">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dbe2ea" />
                <XAxis dataKey="dia" />
                <YAxis />
                <Tooltip formatter={(value) => formatCurrency(value)} />
                <Bar dataKey="custoAcumulado" fill="#F6A740" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </section>

        <section className="card-surface overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-lg font-semibold text-ink">
              Refeições diárias - {String(periodo.mes).padStart(2, "0")}/{periodo.ano}
            </h3>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left">Data</th>
                  <th className="px-4 py-3 text-left">Refeições servidas</th>
                  <th className="px-4 py-3 text-left">Registrado por</th>
                </tr>
              </thead>
              <tbody>
                {rowsDiarias.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-4 py-2">{row.labelLong}</td>
                    <td className="px-4 py-2">{toNumber(row.qtdRefeicoes)}</td>
                    <td className="px-4 py-2">{row.createdBy ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function ReportRecordsTable({ title, records }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <section className="card-surface overflow-hidden">
      <div className="border-b border-slate-200 px-5 py-4">
        <button
          type="button"
          onClick={() => setIsOpen((current) => !current)}
          className="flex w-full items-center justify-between text-left"
        >
          <h3 className="text-lg font-semibold text-ink">{title}</h3>
          <span className="text-sm font-medium text-brand-700">
            {isOpen ? "Ocultar" : "Ver detalhes"}
          </span>
        </button>
      </div>
      {isOpen ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">Referencia</th>
                <th className="px-4 py-3 text-left">Estoque inicial</th>
                <th className="px-4 py-3 text-left">Compras</th>
                <th className="px-4 py-3 text-left">Estoque final</th>
                <th className="px-4 py-3 text-left">Variacao estoque</th>
                <th className="px-4 py-3 text-left">Faturamento</th>
                <th className="px-4 py-3 text-left">Perdas</th>
                <th className="px-4 py-3 text-left">CMV</th>
                <th className="px-4 py-3 text-left">CMV %</th>
                <th className="px-4 py-3 text-left">Compras %</th>
                <th className="px-4 py-3 text-left">Registrado por</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 && (
                <tr>
                  <td className="px-4 py-4 text-slate-500" colSpan={11}>
                    Nenhum registro salvo.
                  </td>
                </tr>
              )}
              {records.map((record) => (
                <tr key={record.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">{record.reference}</td>
                  <td className="px-4 py-3">{formatCurrency(record.estoqueInicial)}</td>
                  <td className="px-4 py-3">{formatCurrency(record.compras)}</td>
                  <td className="px-4 py-3">{formatCurrency(record.estoqueFinal)}</td>
                  <td className="px-4 py-3">{formatCurrency(record.stockVariation)}</td>
                  <td className="px-4 py-3">{formatCurrency(record.faturamento)}</td>
                  <td className="px-4 py-3">{formatCurrency(record.perdas)}</td>
                  <td className="px-4 py-3">{formatCurrency(record.cmv)}</td>
                  <td className="px-4 py-3">{formatPercent(record.cmvPercent)}</td>
                  <td className="px-4 py-3">{formatPercent(record.purchasesPercent)}</td>
                  <td className="px-4 py-3">{record.createdBy ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-5 py-4 text-sm text-slate-500">Clique em \"Ver detalhes\" para expandir os dados.</p>
      )}
    </section>
  );
}

function ReportRecordsStaticTable({ records }) {
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
      <table className="min-w-full text-xs">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-2 py-2 text-left">Referencia</th>
            <th className="px-2 py-2 text-left">Estoque inicial</th>
            <th className="px-2 py-2 text-left">Compras</th>
            <th className="px-2 py-2 text-left">Estoque final</th>
            <th className="px-2 py-2 text-left">Variacao</th>
            <th className="px-2 py-2 text-left">Faturamento</th>
            <th className="px-2 py-2 text-left">Perdas</th>
            <th className="px-2 py-2 text-left">CMV</th>
            <th className="px-2 py-2 text-left">CMV %</th>
            <th className="px-2 py-2 text-left">Compras %</th>
            <th className="px-2 py-2 text-left">Registrado por</th>
          </tr>
        </thead>
        <tbody>
          {records.length === 0 && (
            <tr>
              <td className="px-2 py-3 text-slate-500" colSpan={11}>
                Nenhum registro salvo.
              </td>
            </tr>
          )}
          {records.map((record) => (
            <tr key={record.id} className="border-t border-slate-100">
              <td className="px-2 py-2">{record.reference}</td>
              <td className="px-2 py-2">{formatCurrency(record.estoqueInicial)}</td>
              <td className="px-2 py-2">{formatCurrency(record.compras)}</td>
              <td className="px-2 py-2">{formatCurrency(record.estoqueFinal)}</td>
              <td className="px-2 py-2">{formatCurrency(record.stockVariation)}</td>
              <td className="px-2 py-2">{formatCurrency(record.faturamento)}</td>
              <td className="px-2 py-2">{formatCurrency(record.perdas)}</td>
              <td className="px-2 py-2">{formatCurrency(record.cmv)}</td>
              <td className="px-2 py-2">{formatPercent(record.cmvPercent)}</td>
              <td className="px-2 py-2">{formatPercent(record.purchasesPercent)}</td>
              <td className="px-2 py-2">{record.createdBy ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RefeitorioView({ canEdit = true, actorName = "Desconhecido" }) {
  const today = new Date();
  const currentMonth = today.getMonth() + 1;
  const currentYear = today.getFullYear();
  const yearOptions = Array.from({ length: 7 }, (_, index) => currentYear - 3 + index);
  const [tabelaRefeitorioMensal, setTabelaRefeitorioMensal] = useState([]);
  const [tabelaRefeicoesDiarias, setTabelaRefeicoesDiarias] = useState([]);
  const [filtro, setFiltro] = useState({ mes: currentMonth, ano: currentYear });
  const [formData, setFormData] = useState({ estoqueInicial: "", comprasMes: "", estoqueFinal: "" });
  const [refeicoesDiarias, setRefeicoesDiarias] = useState([]);
  const [mensagem, setMensagem] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isMealsTableOpen, setIsMealsTableOpen] = useState(false);

  const totalRefeicoesMes = useMemo(
    () => refeicoesDiarias.reduce((acc, row) => acc + toNumber(row.qtdRefeicoes), 0),
    [refeicoesDiarias]
  );
  const custoTotalRefeitorio =
    toNumber(formData.estoqueInicial) + toNumber(formData.comprasMes) - toNumber(formData.estoqueFinal);
  const custoPorRefeicao = totalRefeicoesMes > 0 ? custoTotalRefeitorio / totalRefeicoesMes : 0;

  const dailyChartData = refeicoesDiarias.map((row) => ({
    dia: row.label,
    refeicoes: toNumber(row.qtdRefeicoes),
  }));

  const barCostTrendData = useMemo(() => {
    let acumulado = 0;
    return refeicoesDiarias.map((row) => {
      acumulado += toNumber(row.qtdRefeicoes);
      return {
        dia: row.label,
        custoAcumulado: acumulado * custoPorRefeicao,
      };
    });
  }, [custoPorRefeicao, refeicoesDiarias]);

  useEffect(() => {
    loadRefeitorioData();
  }, []);

  const loadSelectedPeriod = () => {
    const selectedMes = toNumber(filtro.mes);
    const selectedAno = toNumber(filtro.ano);
    applyPeriodData(tabelaRefeitorioMensal, tabelaRefeicoesDiarias, selectedMes, selectedAno);
    setMensagem("");
  };

  const applyPeriodData = (monthlyList, dailyList, selectedMes, selectedAno) => {
    const rows = buildDailyMealRows(selectedMes, selectedAno, dailyList);
    const monthlySaved = monthlyList.find((item) => item.mes === selectedMes && item.ano === selectedAno);

    setRefeicoesDiarias(rows);
    setFormData({
      estoqueInicial: monthlySaved ? String(monthlySaved.estoque_inicial) : "",
      comprasMes: monthlySaved ? String(monthlySaved.compras_mes) : "",
      estoqueFinal: monthlySaved ? String(monthlySaved.estoque_final) : "",
    });
    const hasDailyData = rows.some((row) => toNumber(row.qtdRefeicoes) > 0);
    const hasMonthlyData = Boolean(monthlySaved);
    setIsFormOpen(hasMonthlyData);
    setIsMealsTableOpen(hasDailyData);
  };

  const loadRefeitorioData = async () => {
    const [monthlyRes, dailyRes] = await Promise.all([
      fetch(`${API_BASE}/data/refeitorio/monthly`, { credentials: "include" }),
      fetch(`${API_BASE}/data/refeitorio/daily`, { credentials: "include" }),
    ]);
    if (!monthlyRes.ok || !dailyRes.ok) return;
    const monthlyPayload = await monthlyRes.json();
    const dailyPayload = await dailyRes.json();
    if (!monthlyPayload.ok || !dailyPayload.ok) return;

    const monthly = monthlyPayload.data.map(mapRefeitorioMonthlyFromApi);
    const daily = dailyPayload.data.map(mapRefeitorioDailyFromApi);
    setTabelaRefeitorioMensal(monthly);
    setTabelaRefeicoesDiarias(daily);
    applyPeriodData(monthly, daily, toNumber(filtro.mes), toNumber(filtro.ano));
  };

  const updateDailyMeal = (id, value) => {
    setRefeicoesDiarias((current) =>
      current.map((row) =>
        row.id === id
          ? {
              ...row,
              qtdRefeicoes: value,
            }
          : row
      )
    );
  };

  const handleCalculate = async (event) => {
    event.preventDefault();
    const mes = toNumber(filtro.mes);
    const ano = toNumber(filtro.ano);
    const rowsToSave = refeicoesDiarias.map((row) => ({
      id: row.id,
      data: row.data,
      mes,
      ano,
      qtd_refeicoes: toNumber(row.qtdRefeicoes),
      created_by: actorName,
    }));

    const total = rowsToSave.reduce((acc, row) => acc + toNumber(row.qtd_refeicoes), 0);
    const custoTotal = toNumber(formData.estoqueInicial) + toNumber(formData.comprasMes) - toNumber(formData.estoqueFinal);
    const custoColaborador = total > 0 ? custoTotal / total : 0;

    const registroMensal = {
      id: crypto.randomUUID(),
      mes,
      ano,
      estoque_inicial: toNumber(formData.estoqueInicial),
      estoque_final: toNumber(formData.estoqueFinal),
      compras_mes: toNumber(formData.comprasMes),
      custo_total: custoTotal,
      total_refeicoes: total,
      custo_por_refeicao: custoColaborador,
      created_by: actorName,
      created_at: Date.now(),
    };

    await fetch(`${API_BASE}/data/refeitorio/monthly`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(registroMensal),
    });
    await fetch(`${API_BASE}/data/refeitorio/daily`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ records: rowsToSave }),
    });

    setIsFormOpen(true);
    setIsMealsTableOpen(true);
    setMensagem("Dados salvos com sucesso.");
    loadRefeitorioData();
  };

  const costStatus = getMealCostStatus(custoPorRefeicao);

  return (
    <div className="space-y-4">
      <section className="card-surface p-5">
        <h2 className="text-xl font-semibold text-ink">Refeitório</h2>
        <p className="mt-1 text-sm text-slate-500">Custo mensal da refeição por colaborador.</p>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <label className="text-sm text-slate-600">
            Mês
            <select
              value={filtro.mes}
              onChange={(event) => setFiltro((current) => ({ ...current, mes: toNumber(event.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
            >
              {MONTH_OPTIONS.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-600">
            Ano
            <select
              value={filtro.ano}
              onChange={(event) => setFiltro((current) => ({ ...current, ano: toNumber(event.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={loadSelectedPeriod}
              className="w-full rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700 transition hover:bg-brand-100"
            >
              Carregar dados
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <RefeitorioStatCard title="Custo por colaborador" value={formatCurrency(custoPorRefeicao)} badge={costStatus} />
        <RefeitorioStatCard title="Total de refeições" value={String(totalRefeicoesMes)} />
        <RefeitorioStatCard title="Custo total do refeitório" value={formatCurrency(custoTotalRefeitorio)} />
        <RefeitorioStatCard title="Compras do mês" value={formatCurrency(formData.comprasMes)} />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Refeições servidas por dia">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={dailyChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#dbe2ea" />
              <XAxis dataKey="dia" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="refeicoes" stroke="#1793A5" strokeWidth={3} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Tendência de custo ao longo do mês">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={barCostTrendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#dbe2ea" />
              <XAxis dataKey="dia" />
              <YAxis />
              <Tooltip formatter={(value) => formatCurrency(value)} />
              <Bar dataKey="custoAcumulado" fill="#F6A740" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </section>

      {canEdit ? (
        <>
          <section className="card-surface overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setIsFormOpen((current) => !current)}
                className="flex w-full items-center justify-between text-left"
              >
                <h3 className="text-lg font-semibold text-ink">Inserção de dados</h3>
                <span className="text-sm font-medium text-brand-700">{isFormOpen ? "Ocultar" : "Incluir informações"}</span>
              </button>
            </div>
            {isFormOpen ? (
              <div className="p-5">
                <form className="grid gap-3 md:grid-cols-3" onSubmit={handleCalculate}>
                  <InputField
                    label="Estoque inicial"
                    type="number"
                    step="0.01"
                    value={formData.estoqueInicial}
                    onChange={(value) => setFormData((current) => ({ ...current, estoqueInicial: value }))}
                    required
                  />
                  <InputField
                    label="Compras do mês"
                    type="number"
                    step="0.01"
                    value={formData.comprasMes}
                    onChange={(value) => setFormData((current) => ({ ...current, comprasMes: value }))}
                    required
                  />
                  <InputField
                    label="Estoque final"
                    type="number"
                    step="0.01"
                    value={formData.estoqueFinal}
                    onChange={(value) => setFormData((current) => ({ ...current, estoqueFinal: value }))}
                    required
                  />
                  <div className="md:col-span-3">
                    <button
                      type="submit"
                      className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
                    >
                      Calcular custo do refeitório
                    </button>
                  </div>
                </form>
                {mensagem && <p className="mt-3 text-sm text-emerald-700">{mensagem}</p>}
              </div>
            ) : (
              <p className="px-5 py-4 text-sm text-slate-500">Seção retraída. Clique em \"Incluir informações\" para abrir.</p>
            )}
          </section>

          <section className="card-surface overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setIsMealsTableOpen((current) => !current)}
                className="flex w-full items-center justify-between text-left"
              >
                <h3 className="text-lg font-semibold text-ink">Tabela de refeições diárias</h3>
                <span className="text-sm font-medium text-brand-700">{isMealsTableOpen ? "Ocultar" : "Incluir informações"}</span>
              </button>
            </div>
            {isMealsTableOpen ? (
              <div className="p-5">
                <div className="max-h-[420px] overflow-y-auto rounded-xl border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-3 text-left">Data</th>
                        <th className="px-4 py-3 text-left">Refeições servidas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {refeicoesDiarias.map((row) => (
                        <tr key={row.id} className="border-t border-slate-100">
                          <td className="px-4 py-2">{row.labelLong}</td>
                          <td className="px-4 py-2">
                            <input
                              type="number"
                              min="0"
                              value={row.qtdRefeicoes}
                              onChange={(event) => updateDailyMeal(row.id, event.target.value)}
                              className="w-32 rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none focus:border-brand-500"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="px-5 py-4 text-sm text-slate-500">Seção retraída. Clique em \"Incluir informações\" para abrir.</p>
            )}
          </section>
        </>
      ) : (
        <section className="card-surface p-5">
          <p className="text-sm text-slate-500">Perfil visualizador: inclusão e edição de dados do refeitório estão bloqueadas.</p>
        </section>
      )}

    </div>
  );
}

function RefeitorioStatCard({ title, value, badge }) {
  return (
    <div className="card-surface p-4">
      <p className="text-sm text-slate-500">{title}</p>
      <p className="mt-3 text-2xl font-semibold text-ink">{value}</p>
      {badge && <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${badge.className}`}>{badge.label}</span>}
    </div>
  );
}

function KpiCard({ title, value, percent, icon: Icon, trend }) {
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{title}</p>
        <Icon className="text-brand-600" size={19} />
      </div>
      <p className="mt-3 text-2xl font-semibold text-ink">{value}</p>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm text-slate-500">{percent}</span>
        <Trend trend={trend} />
      </div>
    </div>
  );
}

function HealthCard({ title, value, health }) {
  return (
    <div className="card-surface p-4">
      <p className="text-sm text-slate-500">{title}</p>
      <p className="mt-3 text-xl font-semibold text-ink">{value}</p>
      <div className="mt-2">
        <StatusBadge label={health?.label ?? "Sem dados"} health={health} />
      </div>
    </div>
  );
}

function ChartCard({ title, children }) {
  return (
    <div className="card-surface p-5 xl:col-span-1">
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function InputField({ label, value, onChange, ...props }) {
  return (
    <label className="block text-sm text-slate-600">
      {label}
      <input
        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-brand-500"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...props}
      />
    </label>
  );
}

function PreviewCard({ label, value }) {
  return (
    <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3">
      <p className="text-xs uppercase text-brand-700">{label}</p>
      <p className="mt-1 text-lg font-semibold text-brand-700">{value}</p>
    </div>
  );
}

function Trend({ trend }) {
  if (!trend || trend.direction === "stable") {
    return <span className="text-xs text-slate-500">Sem variação</span>;
  }

  const isUp = trend.direction === "up";

  return (
    <span className={`inline-flex items-center gap-1 text-xs ${isUp ? "text-red-600" : "text-emerald-600"}`}>
      {isUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
      {trend.text}
    </span>
  );
}

function StatusBadge({ label, health }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
        health ? `${health.bg} ${health.color}` : "bg-slate-100 text-slate-600"
      }`}
    >
      <AlertTriangle size={12} />
      {label}
    </span>
  );
}

function buildDailyMealRows(month, year, storedRows) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthRows = storedRows.filter((row) => row.mes === month && row.ano === year);
  const byDate = new Map(monthRows.map((row) => [row.data, row]));

  return Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const saved = byDate.get(date);
    return {
      id: saved?.id ?? crypto.randomUUID(),
      data: date,
      label: String(day).padStart(2, "0"),
      labelLong: `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`,
      qtdRefeicoes: saved ? String(saved.qtd_refeicoes) : "",
      createdBy: saved?.created_by ?? "-",
    };
  });
}

function getMealCostStatus(costPerMeal) {
  if (costPerMeal <= 18) {
    return {
      label: "Custo saudável (até R$18)",
      className: "bg-emerald-100 text-emerald-700",
    };
  }
  if (costPerMeal <= 20) {
    return {
      label: "Atenção (entre R$18 e R$20)",
      className: "bg-amber-100 text-amber-700",
    };
  }
  return {
    label: "Alerta (acima de R$20)",
    className: "bg-red-100 text-red-700",
  };
}

function mapWeeklyFromApi(row) {
  return {
    id: row.id,
    reference: row.reference,
    estoqueInicial: toNumber(row.estoque_inicial),
    compras: toNumber(row.compras),
    estoqueFinal: toNumber(row.estoque_final),
    faturamento: toNumber(row.faturamento),
    perdas: toNumber(row.perdas),
    createdBy: row.created_by || "-",
    createdAt: row.created_at,
  };
}

function mapMonthlyFromApi(row) {
  return {
    id: row.id,
    reference: row.reference,
    estoqueInicial: toNumber(row.estoque_inicial),
    compras: toNumber(row.compras),
    estoqueFinal: toNumber(row.estoque_final),
    faturamento: toNumber(row.faturamento),
    perdas: toNumber(row.perdas),
    createdBy: row.created_by || "-",
    createdAt: row.created_at,
  };
}

function mapRefeitorioMonthlyFromApi(row) {
  return {
    id: row.id,
    mes: toNumber(row.mes),
    ano: toNumber(row.ano),
    estoque_inicial: toNumber(row.estoque_inicial),
    estoque_final: toNumber(row.estoque_final),
    compras_mes: toNumber(row.compras_mes),
    custo_total: toNumber(row.custo_total),
    total_refeicoes: toNumber(row.total_refeicoes),
    custo_por_refeicao: toNumber(row.custo_por_refeicao),
    created_by: row.created_by || "-",
    created_at: row.created_at,
  };
}

function mapRefeitorioDailyFromApi(row) {
  return {
    id: row.id,
    data: row.data,
    mes: toNumber(row.mes),
    ano: toNumber(row.ano),
    qtd_refeicoes: toNumber(row.qtd_refeicoes),
    created_by: row.created_by || "-",
  };
}

async function saveWeeklyApi(record) {
  const payload = {
    id: record.id,
    reference: record.reference,
    estoque_inicial: record.estoqueInicial,
    compras: record.compras,
    estoque_final: record.estoqueFinal,
    faturamento: record.faturamento,
    perdas: record.perdas,
  };
  await fetch(`${API_BASE}/data/cmv/weekly`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
}

async function saveMonthlyApi(record) {
  const payload = {
    id: record.id,
    reference: record.reference,
    estoque_inicial: record.estoqueInicial,
    compras: record.compras,
    estoque_final: record.estoqueFinal,
    faturamento: record.faturamento,
    perdas: record.perdas,
  };
  await fetch(`${API_BASE}/data/cmv/monthly`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
}

function sum(values) {
  return values.reduce((acc, value) => acc + toNumber(value), 0);
}

function average(values) {
  if (!values.length) return 0;
  return sum(values) / values.length;
}

export default App;
