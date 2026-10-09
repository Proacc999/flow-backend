const dotenv = require("dotenv");

dotenv.config();

const DEFAULT_GRAPH_BASE_URL = "https://graph.facebook.com";
const DEFAULT_GRAPH_API_VERSION = "v26.0";

function parseWabaAccounts(rawValue = process.env.META_WABA_ACCOUNTS_JSON) {
  if (!rawValue) return {};

  let accounts;
  try {
    accounts = JSON.parse(rawValue);
  } catch {
    throw new Error("META_WABA_ACCOUNTS_JSON must be valid JSON.");
  }

  if (!accounts || Array.isArray(accounts) || typeof accounts !== "object") {
    throw new Error("META_WABA_ACCOUNTS_JSON must be a JSON object.");
  }

  return accounts;
}

function resolveMetaAccount(wabaNumber) {
  const normalizedNumber = String(wabaNumber || "").trim();
  const accounts = parseWabaAccounts();
  const configuredAccount = accounts[normalizedNumber];

  const wabaId =
    typeof configuredAccount === "string"
      ? configuredAccount
      : configuredAccount?.wabaId || process.env.META_WABA_ID;
  const accessToken =
    configuredAccount?.accessToken || process.env.META_ACCESS_TOKEN;

  if (!wabaId) {
    const error = new Error(
      `No Meta WABA ID is configured for WhatsApp number ${normalizedNumber}.`,
    );
    error.code = "WABA_NOT_CONFIGURED";
    error.statusCode = 400;
    throw error;
  }

  if (!accessToken) {
    const error = new Error("META_ACCESS_TOKEN is not configured on the server.");
    error.code = "META_TOKEN_NOT_CONFIGURED";
    error.statusCode = 500;
    throw error;
  }

  return { wabaId: String(wabaId), accessToken };
}

function getMetaAccounts() {
  const accounts = parseWabaAccounts();
  const defaultToken = process.env.META_ACCESS_TOKEN;

  const configuredAccounts = Object.entries(accounts).map(
    ([wabaNumber, account]) => ({
      wabaNumber: String(wabaNumber),
      wabaId: String(
        typeof account === "string" ? account : account?.wabaId || "",
      ),
      accessToken:
        (typeof account === "object" && account?.accessToken) || defaultToken,
    }),
  );

  const invalidAccount = configuredAccounts.find(
    (account) => !account.wabaId || !account.accessToken,
  );
  if (invalidAccount) {
    const error = new Error(
      `Meta credentials are incomplete for WhatsApp number ${invalidAccount.wabaNumber}.`,
    );
    error.code = "META_ACCOUNT_NOT_CONFIGURED";
    error.statusCode = 500;
    throw error;
  }

  if (configuredAccounts.length === 0 && process.env.META_WABA_ID) {
    if (!defaultToken) {
      const error = new Error("META_ACCESS_TOKEN is not configured on the server.");
      error.code = "META_TOKEN_NOT_CONFIGURED";
      error.statusCode = 500;
      throw error;
    }

    return [
      {
        wabaNumber: "default",
        wabaId: String(process.env.META_WABA_ID),
        accessToken: defaultToken,
      },
    ];
  }

  return configuredAccounts;
}

function getConfig() {
  const graphApiVersion =
    process.env.META_GRAPH_API_VERSION || DEFAULT_GRAPH_API_VERSION;

  if (!/^v\d+\.\d+$/.test(graphApiVersion)) {
    throw new Error(
      'META_GRAPH_API_VERSION must use a value such as "v26.0".',
    );
  }

  return {
    port: Number(process.env.PORT || 4000),
    mongoUri:
      process.env.MONGODB_URI ||
      "mongodb://127.0.0.1:27017/whatsapp_flows",
    clientOrigins: (process.env.CLIENT_ORIGIN || "http://localhost:5173")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    graphBaseUrl: (
      process.env.META_GRAPH_BASE_URL || DEFAULT_GRAPH_BASE_URL
    ).replace(/\/$/, ""),
    graphApiVersion,
    metaRequestTimeoutMs: Number(process.env.META_REQUEST_TIMEOUT_MS || 30000),
  };
}

module.exports = { getConfig, resolveMetaAccount, getMetaAccounts };
