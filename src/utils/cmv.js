export const DEFAULT_CMV_TARGET = 35;

export const toNumber = (value) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value !== "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const trimmed = value.trim();
  if (!trimmed) return 0;

  // Accepts pt-BR and en-US typed formats, with optional currency symbols.
  const sanitized = trimmed.replace(/\s/g, "").replace(/[R$r$\u00A0]/g, "").replace(/[^0-9,.-]/g, "");
  if (!sanitized) return 0;

  let normalized = sanitized;
  const commaIndex = normalized.lastIndexOf(",");
  const dotIndex = normalized.lastIndexOf(".");

  if (commaIndex > -1 && dotIndex > -1) {
    if (commaIndex > dotIndex) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (commaIndex > -1) {
    normalized = normalized.replace(",", ".");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const calculateCMV = ({ estoqueInicial, compras, estoqueFinal }) =>
  toNumber(estoqueInicial) + toNumber(compras) - toNumber(estoqueFinal);

export const calculateCMVPercent = (cmv, faturamento) => {
  const revenue = toNumber(faturamento);
  if (revenue <= 0) return 0;
  return (toNumber(cmv) / revenue) * 100;
};

export const calculatePurchasesPercent = (compras, faturamento) => {
  const revenue = toNumber(faturamento);
  if (revenue <= 0) return 0;
  return (toNumber(compras) / revenue) * 100;
};

export const calculateStockVariation = (estoqueInicial, estoqueFinal) =>
  toNumber(estoqueFinal) - toNumber(estoqueInicial);

export const classifyCMVHealth = (cmvPercent) => {
  if (cmvPercent <= 35) {
    return { label: "Saudavel", color: "text-emerald-700", bg: "bg-emerald-100" };
  }
  if (cmvPercent <= 40) {
    return { label: "Atencao", color: "text-amber-700", bg: "bg-amber-100" };
  }
  return { label: "Alerta", color: "text-red-700", bg: "bg-red-100" };
};

export const buildCalculatedRecord = (entry, cmvTarget) => {
  const cmv = calculateCMV(entry);
  const cmvPercent = calculateCMVPercent(cmv, entry.faturamento);
  const purchasesPercent = calculatePurchasesPercent(entry.compras, entry.faturamento);
  const target = toNumber(cmvTarget || DEFAULT_CMV_TARGET);
  const targetDiff = cmvPercent - target;
  const stockVariation = calculateStockVariation(entry.estoqueInicial, entry.estoqueFinal);

  return {
    ...entry,
    cmv,
    cmvPercent,
    purchasesPercent,
    targetDiff,
    stockVariation,
    health: classifyCMVHealth(cmvPercent),
  };
};

export const formatCurrency = (value) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  }).format(toNumber(value));

export const formatPercent = (value) => `${toNumber(value).toFixed(1)}%`;

export const compareTrend = (current, previous) => {
  const currentValue = toNumber(current);
  const previousValue = toNumber(previous);
  const diff = currentValue - previousValue;

  if (Math.abs(diff) < 0.01) {
    return { direction: "stable", text: "Sem variação" };
  }

  return {
    direction: diff > 0 ? "up" : "down",
    text: `${diff > 0 ? "+" : ""}${diff.toFixed(1)} p.p.`,
  };
};
