// Configuration for Frontend API cache and app settings
require('dotenv').config();

 const DEBUG = false;//process.env.DEBUG === 'true' || false;

// Frontend API configuration (replaces GitHub direct access)
const API_CONFIG = {
  BASE_URL: process.env.API_BASE_URL || "https://bcibizz.pt/frontend-api",
  FILES_ENDPOINT: "/files",
  API_ENDPOINT: "/api/file",
  STORAGE_PREFIX: "api-cache:",
  DEFAULT_TTL: 24 * 60 * 60 * 1000,
  PAGE_TTL: 10 * 60 * 1000,          // Reduzido para 10 minutos (era 1 hora)
  ASSET_TTL: 30 * 60 * 1000,         // Reduzido para 30 minutos (era 12 horas)
  CONFIG_TTL: 10 * 60 * 1000,        // Reduzido para 10 minutos (era 30 minutos)
  MAX_CACHE_AGE: 7 * 24 * 60 * 60 * 1000,
  CACHE_BUSTER: Date.now(),          // Versioning - limpa cache quando app reinicia
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
