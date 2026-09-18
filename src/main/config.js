require('dotenv').config();

// DEBUG só fora de produção e com DEBUG=true.
const DEBUG = process.env.NODE_ENV !== 'production' && process.env.DEBUG === 'true';

const API_CONFIG = {
  BASE_URL: process.env.API_BASE_URL || "https://bcibizz.pt/frontend-api",
  FILES_ENDPOINT: "/files",
  API_ENDPOINT: "/api/file",
  STORAGE_PREFIX: "api-cache:",
  // A cache é validada por hash, não por TTL.
  PAGE_TTL: Infinity,
  ASSET_TTL: Infinity,
  CONFIG_TTL: Infinity,
  MAX_CACHE_AGE: 90 * 24 * 60 * 60 * 1000, // 90 dias (limpeza de cache muito antigo)
  CACHE_BUSTER: "",                       // Sem versão no URL: a validação é por hash.
};

// As rotas vêm da Frontend API (sidebar.js, window.routes).

module.exports = {
  API_CONFIG,
  DEBUG
};
