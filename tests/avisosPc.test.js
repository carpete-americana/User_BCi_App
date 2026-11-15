'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarAvisosPc, pintarPonto, paginaDoLink } = require('../src/main/avisosPc');

const aviso = (id, extra = {}) => ({ id, user_id: 7, type: 'info', title: `T${id}`, message: `M${id}`, link: 'withdraw', ...extra });

function montar({ foco = false, userId = 7 } = {}) {
  const c = { lista: [], total: null, status: 200, mostrados: [], contagens: [], mudancas: [], abertos: [], lidas: [], foco, userId, guardado: {} };
  const api = {
    get: async () => ({ status: c.status, corpo: { status: 'success', data: { notifications: c.lista, pagination: { total: c.total ?? c.lista.length } } } }),
    put: async (caminho) => { c.lidas.push(caminho); return { status: 200 }; }
  };
  c.a = criarAvisosPc({
    api,
    lerUserId: async () => c.userId,
    storage: { getItem: (k) => c.guardado[k], setItem: (k, v) => { c.guardado[k] = v; } },
    mostrar: (n, clicar) => c.mostrados.push({ ...n, clicar }),
    janelaEmFoco: () => c.foco,
    abrir: (p) => c.abertos.push(p),
    aoContar: (n) => c.contagens.push(n),
    aoMudar: (l) => c.mudancas.push(l)
  });
  return c;
}

test('a primeira vez só marca: o que já estava por ler não aparece', async () => {
  const c = montar();
  c.lista = [aviso(5), aviso(4)];
  await c.a.tique();
  assert.equal(c.mostrados.length, 0);
  assert.deepEqual(c.contagens, [2]);
});

test('sem nada por ler na primeira vez, o aviso seguinte aparece', async () => {
  const c = montar();
  await c.a.tique();
  c.lista = [aviso(1)];
  await c.a.tique();
  assert.deepEqual(c.mostrados.map(m => m.titulo), ['T1']);
});

test('um aviso novo aparece uma só vez, por ordem de chegada', async () => {
  const c = montar();
  c.lista = [aviso(5)];
  await c.a.tique();
  c.lista = [aviso(7), aviso(6), aviso(5)];
  await c.a.tique();
  await c.a.tique();
  assert.deepEqual(c.mostrados.map(m => m.titulo), ['T6', 'T7']);
});

test('avisos gerais contam no total mas não saem no Windows', async () => {
  const c = montar();
  await c.a.tique();
  c.lista = [aviso(9, { user_id: null })];
  await c.a.tique();
  assert.equal(c.mostrados.length, 0);
  assert.equal(c.contagens.at(-1), 1);
});

test('muitos de uma vez juntam-se num só', async () => {
  const c = montar();
  await c.a.tique();
  c.lista = [aviso(4), aviso(3), aviso(2), aviso(1)];
  await c.a.tique();
  assert.deepEqual(c.mostrados.map(m => m.corpo), ['Tens 4 avisos novos.']);
  c.mostrados[0].clicar();
  assert.deepEqual(c.abertos, ['dashboard']);
  assert.equal(c.lidas.length, 0);
});

test('com a janela em foco vai para a própria app e não para o Windows', async () => {
  const c = montar({ foco: true });
  await c.a.tique();
  c.lista = [aviso(1)];
  await c.a.tique();
  assert.equal(c.mostrados.length, 0);
  assert.deepEqual(c.mudancas.at(-1), [{ tipo: 'info', titulo: 'T1', corpo: 'M1' }]);
});

test('desligadas não aparecem, e ao religar o que passou não volta', async () => {
  const c = montar();
  await c.a.tique();
  c.a.definirLigados(false);
  c.lista = [aviso(1)];
  await c.a.tique();
  assert.equal(c.mostrados.length, 0);
  c.a.definirLigados(true);
  await c.a.tique();
  assert.equal(c.mostrados.length, 0);
  assert.equal(c.contagens.at(-1), 1);
});

test('clicar abre a página do aviso e marca-o como lido', async () => {
  const c = montar();
  await c.a.tique();
  c.lista = [aviso(3)];
  await c.a.tique();
  c.mostrados[0].clicar();
  assert.deepEqual(c.abertos, ['withdraw']);
  assert.deepEqual(c.lidas, ['/users/me/notifications/3/read']);
});

test('um link estranho abre o dashboard', () => {
  assert.equal(paginaDoLink('https://mau.example'), 'dashboard');
  assert.equal(paginaDoLink('../x'), 'dashboard');
  assert.equal(paginaDoLink(null), 'dashboard');
  assert.equal(paginaDoLink('support'), 'support');
});

test('outro utilizador neste PC tem a sua própria marca', async () => {
  const c = montar();
  c.lista = [aviso(5)];
  await c.a.tique();
  c.userId = 8;
  c.lista = [aviso(3, { user_id: 8 })];
  await c.a.tique();
  assert.equal(c.mostrados.length, 0);
  c.lista = [aviso(4, { user_id: 8 }), aviso(3, { user_id: 8 })];
  await c.a.tique();
  assert.deepEqual(c.mostrados.map(m => m.titulo), ['T4']);
});

test('sem sessão a contagem vai a zero', async () => {
  const c = montar();
  c.lista = [aviso(1)];
  await c.a.tique();
  c.userId = null;
  await c.a.tique();
  assert.equal(c.contagens.at(-1), 0);
});

test('um erro do servidor não mexe em nada, e uma sessão recusada zera', async () => {
  const c = montar();
  c.lista = [aviso(1)];
  await c.a.tique();
  c.status = 500;
  await c.a.tique();
  assert.equal(c.contagens.at(-1), 1);
  c.status = 401;
  await c.a.tique();
  assert.equal(c.contagens.at(-1), 0);
});

test('a falta de rede não rebenta o tique', async () => {
  const c = montar();
  c.a = criarAvisosPc({
    api: { get: async () => { throw new Error('rede'); } },
    lerUserId: async () => 7,
    storage: { getItem: () => undefined, setItem: () => {} },
    mostrar: () => {}, janelaEmFoco: () => false, abrir: () => {}, aoContar: () => {}, aoMudar: () => {}
  });
  await c.a.tique();
});

test('o ponto fica vermelho no canto e não toca no canto oposto', () => {
  const largura = 32;
  const saida = pintarPonto(Buffer.alloc(largura * largura * 4), largura, largura);
  const px = (x, y) => [...saida.subarray((y * largura + x) * 4, (y * largura + x) * 4 + 4)];
  assert.deepEqual(px(25, 25), [0x26, 0x26, 0xdc, 255]);
  assert.deepEqual(px(0, 0), [0, 0, 0, 0]);
});
