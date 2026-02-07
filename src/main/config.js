// Configuration for Frontend API cache and app settings
require('dotenv').config();

// DEBUG: auto-detecção em desenvolvimento, forçado a false em produção
const DEBUG = process.env.NODE_ENV !== 'production' && process.env.DEBUG === 'true';

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

const routes = {
  dashboard: { title: "Dashboard", path: "dashboard", icon: "fa-chart-bar" },
  withdraw: { title: "Levantamento", path: "withdraw", icon: "fa-money-bill-wave" },
  rules: { title: "Regras", path: "rules", icon: "fa-scroll" },
  casinoaccounts: { title: "Contas Casinos", path: "casinoaccounts", icon: "fa-dice" },
  profile: { title: "Perfil", path: "profile", icon: "fa-user" }
};

module.exports = {
  API_CONFIG,
  DEBUG,
  routes
};
