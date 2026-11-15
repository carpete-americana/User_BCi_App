'use strict';

// O link da KYCAID começa a contar a validade no primeiro acesso: abre no browser do utilizador, nunca na app.
const KYCAID = /^https:\/\/forms\.kycaid\.com\/[A-Za-z0-9]{20,64}$/;
const SITE_BCI = /^https:\/\/(www\.)?bcibizz\.pt\//;

const abreNoSistema = (url) => SITE_BCI.test(url) || KYCAID.test(url);

module.exports = { abreNoSistema };
