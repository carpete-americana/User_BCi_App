// Configuration for Frontend API cache and app settings
require('dotenv').config();

 const DEBUG = false;//process.env.DEBUG === 'true' || false;

// Frontend API configuration (replaces GitHub direct access)
const API_CONFIG = {
  BASE_URL: process.env.API_BASE_URL || "https://bcibizz.pt/frontend-api",
  FILES_ENDPOINT: "/files",
  API_ENDPOINT: "/api/file",
  STORAGE_PREFIX: "api-cache:",
  // Cache is validated using hashes, not TTL
  PAGE_TTL: Infinity,                     // Infinito - usa hashes
  ASSET_TTL: Infinity,                    // Infinito - usa hashes
  CONFIG_TTL: Infinity,                   // Infinito - usa hashes
  MAX_CACHE_AGE: 90 * 24 * 60 * 60 * 1000, // 90 dias (limpeza de cache muito antigo)
  CACHE_BUSTER: "",                       // Sem versioning - usa hashes para validação
};

// Legacy GitHub config - mantido para retrocompatibilidade se necessário
const GITHUB_CONFIG = {
  OWNER: "carpete-americana",
  REPO: "bci-frontend",
  BRANCH: DEBUG ? "testing" : "main",
  STORAGE_PREFIX: "cache:",
  DEFAULT_TTL: 24 * 60 * 60 * 1000,
  PAGE_TTL: 1 * 60 * 60 * 1000,
  ASSET_TTL: 12 * 60 * 60 * 1000,
  CONFIG_TTL: 30 * 60 * 1000,
  MAX_CACHE_AGE: 7 * 24 * 60 * 60 * 1000,
};

const routes = {
  dashboard: { title: "Dashboard", path: "dashboard", icon: "fa-chart-bar" },
  withdraw: { title: "Levantamento", path: "withdraw", icon: "fa-money-bill-wave" },
  rules: { title: "Regras", path: "rules", icon: "fa-scroll" },
  casinoaccounts: { title: "Contas Casinos", path: "casinoaccounts", icon: "fa-dice" }
};

module.exports = {
  API_CONFIG,
  GITHUB_CONFIG,
  DEBUG,
  routes
};
