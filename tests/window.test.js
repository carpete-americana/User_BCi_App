'use strict';

/** Que links externos a janela principal entrega ao browser do sistema. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { abreNoSistema } = require('../src/main/linksExternos');

test('abre no browser do sistema o site do BCI e o formulário da KYCAID', () => {
  assert.equal(abreNoSistema('https://bcibizz.pt/x'), true);
  assert.equal(abreNoSistema('https://www.bcibizz.pt/x'), true);
  assert.equal(abreNoSistema(`https://forms.kycaid.com/${'a1B2'.repeat(9)}`), true);
});

test('o resto não abre: outros hosts, http, sufixos, caminhos fora do formato', () => {
  for (const u of ['https://evil.pt', 'http://forms.kycaid.com/' + 'a'.repeat(36), 'https://forms.kycaid.com.evil.pt/' + 'a'.repeat(36),
    'https://forms.kycaid.com/abc', 'https://forms.kycaid.com/' + 'a'.repeat(36) + '/x', 'https://forms.kycaid.com/' + 'a'.repeat(36) + '?x=1',
    'https://evil.pt/https://forms.kycaid.com/' + 'a'.repeat(36), 'https://forms.kycaid.com/' + 'a'.repeat(65)]) {
    assert.equal(abreNoSistema(u), false, u);
  }
});
