import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import cookieSession from "cookie-session";
import { google } from "googleapis";

dotenv.config();

const app = express();
const port = process.env.PORT || 5174;
const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const frontendRedirect = process.env.FRONTEND_REDIRECT || frontendOrigin;
const isProd = frontendOrigin.startsWith("https://");

app.set("trust proxy", 1);
app.use(cors({ origin: frontendOrigin, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(
  cookieSession({
    name: "cmv_session",
    keys: [process.env.SESSION_SECRET || "dev-secret"],
    httpOnly: true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  })
);

const oauthClient = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const serviceAuth = new google.auth.GoogleAuth({
  credentials: process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
    : undefined,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth: serviceAuth });

const SHEETS = {
  users: { title: "usuarios", columns: ["id", "email", "name", "role", "status", "refresh_token", "created_at", "last_login"] },
  cmvWeekly: {
    title: "cmv_semanal",
    columns: [
      "id",
      "reference",
      "estoque_inicial",
      "compras",
      "estoque_final",
      "faturamento",
      "perdas",
      "created_by",
      "created_at",
    ],
  },
  cmvMonthly: {
    title: "cmv_mensal",
    columns: [
      "id",
      "reference",
      "estoque_inicial",
      "compras",
      "estoque_final",
      "faturamento",
      "perdas",
      "created_by",
      "created_at",
    ],
  },
  refMonthly: {
    title: "refeitorio_mensal",
    columns: [
      "id",
      "mes",
      "ano",
      "estoque_inicial",
      "estoque_final",
      "compras_mes",
      "custo_total",
      "total_refeicoes",
      "custo_por_refeicao",
      "created_by",
      "created_at",
    ],
  },
  refDaily: {
    title: "refeitorio_diario",
    columns: ["id", "data", "mes", "ano", "qtd_refeicoes", "created_by"],
  },
};

let lastOAuthCallback = null;
let lastOAuthError = null;

function assertEnv() {
  const required = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
    "SPREADSHEET_ID",
    "GOOGLE_SERVICE_ACCOUNT_JSON",
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    const error = new Error(`Missing env: ${missing.join(", ")}`);
    error.status = 500;
    throw error;
  }
}

async function ensureSheetExists(sheetTitle, columns) {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = spreadsheet.data.sheets?.some((sheet) => sheet.properties?.title === sheetTitle);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetTitle } } }],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetTitle}!A1:${String.fromCharCode(64 + columns.length)}1`,
      valueInputOption: "RAW",
      requestBody: { values: [columns] },
    });
  }
}

async function ensureAllSheets() {
  await Promise.all(
    Object.values(SHEETS).map((sheet) => ensureSheetExists(sheet.title, sheet.columns))
  );
}

async function getSheetValues(title) {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${title}!A:Z`,
  });
  return response.data.values || [];
}

function rowsToObjects(values) {
  if (!values.length) return [];
  const [header, ...rows] = values;
  return rows.map((row) =>
    header.reduce((acc, key, index) => {
      acc[key] = row[index] ?? "";
      return acc;
    }, {})
  );
}

async function appendRow(title, columns, data) {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const row = columns.map((key) => data[key] ?? "");
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${title}!A:Z`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
}

async function updateRowById(title, columns, id, data) {
  const values = await getSheetValues(title);
  if (!values.length) return false;
  const header = values[0];
  const idIndex = header.indexOf("id");
  if (idIndex === -1) return false;
  const rowIndex = values.findIndex((row, idx) => idx > 0 && row[idIndex] === id);
  if (rowIndex === -1) return false;

  const row = columns.map((key) => data[key] ?? "");
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const range = `${title}!A${rowIndex + 1}:${String.fromCharCode(64 + columns.length)}${rowIndex + 1}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: { values: [row] },
  });
  return true;
}

async function findUserByEmail(email) {
  const values = await getSheetValues(SHEETS.users.title);
  const users = rowsToObjects(values);
  return users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
}

async function upsertUser(userData) {
  const values = await getSheetValues(SHEETS.users.title);
  const users = rowsToObjects(values);
  const existing = users.find((user) => user.email?.toLowerCase() === userData.email.toLowerCase());
  if (!existing) {
    await appendRow(SHEETS.users.title, SHEETS.users.columns, userData);
    return userData;
  }
  await updateRowById(SHEETS.users.title, SHEETS.users.columns, existing.id, {
    ...existing,
    ...userData,
    id: existing.id,
  });
  return { ...existing, ...userData };
}

function hasAdmin(users) {
  return users.some((user) => user.role === "admin");
}

function requireSession(req, res, next) {
  if (!req.session?.email) {
    return res.status(401).json({ ok: false, message: "Nao autenticado" });
  }
  return next();
}

async function requireApproved(req, res, next) {
  const user = await findUserByEmail(req.session.email);
  if (!user || user.status !== "approved") {
    return res.status(403).json({ ok: false, message: "Acesso nao aprovado" });
  }
  req.currentUser = user;
  return next();
}

async function requireRole(role) {
  return async (req, res, next) => {
    const user = await findUserByEmail(req.session.email);
    if (!user || user.status !== "approved") {
      return res.status(403).json({ ok: false, message: "Acesso nao aprovado" });
    }
    if (role === "admin" && user.role !== "admin") {
      return res.status(403).json({ ok: false, message: "Acesso restrito" });
    }
    if (role === "collaborator" && !["collaborator", "admin"].includes(user.role)) {
      return res.status(403).json({ ok: false, message: "Acesso restrito" });
    }
    req.currentUser = user;
    return next();
  };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "cmv-backend", time: new Date().toISOString() });
});

app.get("/debug/session", (req, res) => {
  res.json({
    ok: true,
    hasSession: Boolean(req.session),
    email: req.session?.email || null,
    hasAccessToken: false,
    hasRefreshToken: false,
  });
});

app.get("/debug/oauth", (_req, res) => {
  res.json({
    ok: true,
    lastOAuthCallback,
    lastOAuthError,
  });
});

app.get("/auth/google/login", async (_req, res, next) => {
  try {
    assertEnv();
    const url = oauthClient.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"],
    });
    res.redirect(url);
  } catch (error) {
    next(error);
  }
});

app.get("/auth/reauth", async (_req, res, next) => {
  try {
    assertEnv();
    const url = oauthClient.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"],
    });
    res.redirect(url);
  } catch (error) {
    next(error);
  }
});

app.get("/auth/google/callback", async (req, res, next) => {
  try {
    assertEnv();
    lastOAuthCallback = {
      time: new Date().toISOString(),
      query: req.query,
    };
    const { code } = req.query;
    if (!code) return res.status(400).send("Codigo ausente");

    const { tokens } = await oauthClient.getToken(code);
    oauthClient.setCredentials(tokens);
    await ensureAllSheets();

    const oauth2 = google.oauth2({ version: "v2", auth: oauthClient });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;
    const name = userInfo.data.name || "";

    const values = await getSheetValues(SHEETS.users.title);
    const users = rowsToObjects(values);
    const existing = users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    const now = new Date().toISOString();
    const adminExists = hasAdmin(users);

    const userRecord = {
      id: existing?.id || crypto.randomUUID(),
      email,
      name,
      role: existing?.role || (adminExists ? "viewer" : "admin"),
      status: existing?.status || (adminExists ? "pending" : "approved"),
      refresh_token: existing?.refresh_token || "",
      created_at: existing?.created_at || now,
      last_login: now,
    };

    await upsertUser(userRecord);

    req.session.email = email;
    res.redirect(frontendRedirect);
  } catch (error) {
    lastOAuthError = {
      time: new Date().toISOString(),
      message: error.message,
      stack: error.stack,
    };
    next(error);
  }
});

app.post("/auth/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get("/me", requireSession, async (req, res) => {
  const user = await findUserByEmail(req.session.email);
  if (!user) return res.status(404).json({ ok: false, message: "Usuario nao encontrado" });
  if (user.status !== "approved") {
    return res.json({ ok: true, user: { email: user.email, name: user.name, role: user.role, status: user.status } });
  }
  res.json({ ok: true, user: { email: user.email, name: user.name, role: user.role, status: user.status } });
});

app.get("/admin/users", requireSession, await requireRole("admin"), async (_req, res) => {
  const values = await getSheetValues(SHEETS.users.title);
  const users = rowsToObjects(values).map((user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    created_at: user.created_at,
    last_login: user.last_login,
  }));
  res.json({ ok: true, users });
});

app.patch("/admin/users/:id", requireSession, await requireRole("admin"), async (req, res) => {
  const values = await getSheetValues(SHEETS.users.title);
  const users = rowsToObjects(values);
  const target = users.find((user) => user.id === req.params.id);
  if (!target) return res.status(404).json({ ok: false, message: "Usuario nao encontrado" });

  const updates = {
    ...target,
    role: req.body.role || target.role,
    status: req.body.status || target.status,
  };

  await updateRowById(SHEETS.users.title, SHEETS.users.columns, target.id, updates);
  res.json({ ok: true });
});

app.get("/data/cmv/weekly", requireSession, requireApproved, async (_req, res) => {
  const values = await getSheetValues(SHEETS.cmvWeekly.title);
  const data = rowsToObjects(values);
  res.json({ ok: true, data });
});

app.post("/data/cmv/weekly", requireSession, await requireRole("collaborator"), async (req, res) => {
  const payload = req.body;
  const record = {
    id: payload.id || crypto.randomUUID(),
    reference: payload.reference,
    estoque_inicial: payload.estoque_inicial,
    compras: payload.compras,
    estoque_final: payload.estoque_final,
    faturamento: payload.faturamento,
    perdas: payload.perdas,
    created_by: req.currentUser.email,
    created_at: new Date().toISOString(),
  };

  const updated = await updateRowById(SHEETS.cmvWeekly.title, SHEETS.cmvWeekly.columns, record.id, record);
  if (!updated) {
    await appendRow(SHEETS.cmvWeekly.title, SHEETS.cmvWeekly.columns, record);
  }
  res.json({ ok: true, record });
});

app.get("/data/cmv/monthly", requireSession, requireApproved, async (_req, res) => {
  const values = await getSheetValues(SHEETS.cmvMonthly.title);
  const data = rowsToObjects(values);
  res.json({ ok: true, data });
});

app.post("/data/cmv/monthly", requireSession, await requireRole("collaborator"), async (req, res) => {
  const payload = req.body;
  const record = {
    id: payload.id || crypto.randomUUID(),
    reference: payload.reference,
    estoque_inicial: payload.estoque_inicial,
    compras: payload.compras,
    estoque_final: payload.estoque_final,
    faturamento: payload.faturamento,
    perdas: payload.perdas,
    created_by: req.currentUser.email,
    created_at: new Date().toISOString(),
  };

  const updated = await updateRowById(SHEETS.cmvMonthly.title, SHEETS.cmvMonthly.columns, record.id, record);
  if (!updated) {
    await appendRow(SHEETS.cmvMonthly.title, SHEETS.cmvMonthly.columns, record);
  }
  res.json({ ok: true, record });
});

app.get("/data/refeitorio/monthly", requireSession, requireApproved, async (_req, res) => {
  const values = await getSheetValues(SHEETS.refMonthly.title);
  const data = rowsToObjects(values);
  res.json({ ok: true, data });
});

app.post("/data/refeitorio/monthly", requireSession, await requireRole("collaborator"), async (req, res) => {
  const payload = req.body;
  const record = {
    id: payload.id || crypto.randomUUID(),
    mes: payload.mes,
    ano: payload.ano,
    estoque_inicial: payload.estoque_inicial,
    estoque_final: payload.estoque_final,
    compras_mes: payload.compras_mes,
    custo_total: payload.custo_total,
    total_refeicoes: payload.total_refeicoes,
    custo_por_refeicao: payload.custo_por_refeicao,
    created_by: req.currentUser.email,
    created_at: new Date().toISOString(),
  };

  const updated = await updateRowById(SHEETS.refMonthly.title, SHEETS.refMonthly.columns, record.id, record);
  if (!updated) {
    await appendRow(SHEETS.refMonthly.title, SHEETS.refMonthly.columns, record);
  }
  res.json({ ok: true, record });
});

app.get("/data/refeitorio/daily", requireSession, requireApproved, async (_req, res) => {
  const values = await getSheetValues(SHEETS.refDaily.title);
  const data = rowsToObjects(values);
  res.json({ ok: true, data });
});

app.post("/data/refeitorio/daily", requireSession, await requireRole("collaborator"), async (req, res) => {
  const payload = req.body;
  const records = payload.records || [];
  for (const item of records) {
    const record = {
      id: item.id || crypto.randomUUID(),
      data: item.data,
      mes: item.mes,
      ano: item.ano,
      qtd_refeicoes: item.qtd_refeicoes,
      created_by: req.currentUser.email,
    };
    const updated = await updateRowById(SHEETS.refDaily.title, SHEETS.refDaily.columns, record.id, record);
    if (!updated) {
      await appendRow(SHEETS.refDaily.title, SHEETS.refDaily.columns, record);
    }
  }
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ ok: false, message: err.message || "Erro interno" });
});

app.listen(port, () => {
  console.log(`CMV backend listening on port ${port}`);
});
