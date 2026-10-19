'use strict';

/** Núcleo das operações automáticas: consentimento, chave, registo, sinal e arranque. Tudo por dependências falsas. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const D = require('../src/main/dispositivo');
const { VERSAO_TEXTO } = require('../src/main/dispositivo-texto');

/** JWT sem assinatura, só para o userIdDoToken. */
const token = (id) => `x.${Buffer.from(JSON.stringify({ id })).toString('base64url')}.y`;

/**
 * Cenário: `rotas` responde a "MÉTODO caminho" com { status, corpo } (ou lança); regista tudo o que se passou.
 */
function cenario({ userId = 7, ativo = true, versaoServidor = VERSAO_TEXTO, resposta = 0, cifra = true, rotas = {} } = {}) {
  const chamadas = [];
  const guardado = new Map();
  const arranque = [];
  const tray = [];
  const caixas = [];
  let sessao = userId == null ? null : token(userId);
  let tique = null;

  const responder = async (metodo, caminho, corpo) => {
    chamadas.push({ metodo, caminho, corpo });
    const chave = `${metodo} ${caminho.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/, ':id')}`;
    const r = rotas[chave];
    if (r instanceof Error) throw r;
    if (r) return typeof r === 'function' ? r(corpo) : r;
    if (chave === 'GET /users/me/devices/config') return { status: 200, corpo: { result: { data: { ativo, versaoConsentimento: versaoServidor } } } };
    if (chave === 'POST /users/me/devices') return { status: 200, corpo: { result: { data: { dispositivo: {} } } } };
    if (chave === 'POST /users/me/devices/:id/sinal') return { status: 200, corpo: { result: { data: { consentimentoValido: true } } } };
    if (chave === 'DELETE /users/me/devices/:id') return { status: 200, corpo: {} };
    return { status: 404, corpo: {} };
  };

  const deps = {
    api: { get: (c) => responder('GET', c), post: (c, b) => responder('POST', c, b), del: (c) => responder('DELETE', c) },
    lerToken: () => sessao,
    storage: {
      getItem: (k) => guardado.get(k) ?? null,
      setItem: (k, v) => { guardado.set(k, JSON.parse(JSON.stringify(v))); },
      removeItem: (k) => { guardado.delete(k); }
    },
    safeStorage: {
      isEncryptionAvailable: () => cifra,
      encryptString: (s) => Buffer.from(`cifrado:${s}`),
      decryptString: (b) => b.toString().replace(/^cifrado:/, '')
    },
    app: { setLoginItemSettings: (o) => arranque.push(o), getVersion: () => '2.2.0' },
    dialog: { showMessageBox: async (o) => { caixas.push(o); return { response: resposta }; } },
    tray: { setOperacoes: (v) => tray.push(v) },
    versoes: { so: 'win32 10.0.26300', electron: '44.4.5' },
    randomUUID: () => crypto.randomUUID(),
    setIntervalFn: (fn, ms) => { tique = { fn, ms }; return 1; },
    clearIntervalFn: () => { tique = null; }
  };
  return {
    d: D.criarDispositivo(deps), chamadas, guardado, arranque, tray, caixas,
    tique: () => tique, sairDaSessao: () => { sessao = null; }, entrarComo: (id) => { sessao = token(id); },
    posts: () => chamadas.filter(c => c.metodo === 'POST')
  };
}

test('gerarParDeChaves dá 32 bytes e a pública corresponde à privada', () => {
  const { publica, privada } = D.gerarParDeChaves();
  assert.equal(Buffer.from(publica, 'base64').length, 32);
  assert.equal(Buffer.from(privada, 'base64').length, 32);
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), Buffer.from(privada, 'base64')]);
  const derivada = crypto.createPublicKey(crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' }))
    .export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
  assert.equal(derivada, publica);
});

test('userIdDoToken lê o id e aguenta lixo', () => {
  assert.equal(D.userIdDoToken(token(42)), 42);
  for (const mau of [null, undefined, '', 'abc', 'a.b.c', `x.${Buffer.from('{}').toString('base64url')}.y`, 42]) {
    assert.equal(D.userIdDoToken(mau), null, String(mau));
  }
});

test('estado() sem consentimento não regista nada: só pergunta a configuração', async () => {
  const c = cenario();
  const e = await c.d.estado();
  assert.deepEqual(e, { disponivel: true, consentido: false, autostart: false, versaoConsentimento: VERSAO_TEXTO });
  assert.equal(c.posts().length, 0, 'nada recolhido antes de aceitar');
  assert.equal(c.guardado.size, 0);
});

test('estado() sem sessão ou com a funcionalidade desligada diz indisponível', async () => {
  assert.equal((await cenario({ userId: null }).d.estado()).disponivel, false);
  assert.equal((await cenario({ ativo: false }).d.estado()).disponivel, false);
});

test('aceitar com «Cancelar» não chama a API nem guarda nada', async () => {
  const c = cenario({ resposta: 1 });
  assert.deepEqual(await c.d.aceitar(), { ok: false, motivo: 'cancelado' });
  assert.equal(c.posts().length, 0);
  assert.equal(c.guardado.size, 0);
  assert.equal(c.arranque.length, 0);
});

test('aceitar com «Aceito» regista, guarda a chave privada cifrada, liga o arranque e o tray', async () => {
  const c = cenario();
  assert.deepEqual(await c.d.aceitar(), { ok: true });
  assert.equal(c.caixas.length, 1);
  assert.deepEqual(c.caixas[0].buttons, ['Aceito', 'Cancelar']);
  const [post] = c.posts();
  assert.equal(post.caminho, '/users/me/devices');
  assert.match(post.corpo.deviceId, /^[0-9a-f-]{36}$/);
  assert.equal(Buffer.from(post.corpo.chavePublica, 'base64').length, 32);
  assert.deepEqual({ so: post.corpo.so, appVersao: post.corpo.appVersao, electronVersao: post.corpo.electronVersao, autostart: post.corpo.autostart, versao: post.corpo.versao },
    { so: 'win32 10.0.26300', appVersao: '2.2.0', electronVersao: '44.4.5', autostart: true, versao: VERSAO_TEXTO });
  const reg = c.guardado.get('dispositivo:7');
  assert.equal(reg.consentido, true);
  assert.match(reg.privadaCifrada, /^[A-Za-z0-9+/=]+$/);
  assert.ok(!JSON.stringify(reg).includes(post.corpo.chavePublica) || reg.chavePublica === post.corpo.chavePublica);
  assert.deepEqual(c.arranque.at(-1), { openAtLogin: true, args: ['--oculto'] });
  assert.equal(c.tray.at(-1), true);
});

test('sem cifra do sistema não aceita', async () => {
  const c = cenario({ cifra: false });
  assert.deepEqual(await c.d.aceitar(), { ok: false, motivo: 'sem-cifra' });
  assert.equal(c.caixas.length, 0, 'nem sequer mostra o diálogo');
  assert.equal(c.posts().length, 0);
});

test('o texto da app tem de ser a versão que o servidor espera', async () => {
  const c = cenario({ versaoServidor: VERSAO_TEXTO + 1 });
  assert.deepEqual(await c.d.aceitar(), { ok: false, motivo: 'app-desatualizada' });
  assert.equal(c.caixas.length, 0);
  assert.equal(c.posts().length, 0);
});

test('falha de rede ao aceitar: nada fica guardado como consentido', async () => {
  const c = cenario({ rotas: { 'POST /users/me/devices': new Error('ECONNRESET') } });
  assert.deepEqual(await c.d.aceitar(), { ok: false, motivo: 'rede' });
  assert.equal(c.guardado.get('dispositivo:7')?.consentido ?? false, false);
  assert.equal(c.arranque.length, 0);
  assert.equal(c.tray.at(-1) ?? false, false);
});

test('o servidor recusar o registo (409) não deixa consentimento local', async () => {
  const c = cenario({ rotas: { 'POST /users/me/devices': { status: 409, corpo: {} } } });
  assert.deepEqual(await c.d.aceitar(), { ok: false, motivo: 'versao' });
  assert.equal(c.guardado.get('dispositivo:7')?.consentido ?? false, false);
});

test('iniciar() agenda o sinal de 2 em 2 minutos e cada sinal vai ao dispositivo certo', async () => {
  const c = cenario();
  await c.d.aceitar();
  c.d.iniciar();
  assert.equal(c.tique().ms, 120000);
  await c.tique().fn();
  const sinais = c.posts().filter(p => /sinal$/.test(p.caminho));
  assert.equal(sinais.length >= 1, true);
  const id = c.guardado.get('dispositivo:7').deviceId;
  assert.equal(sinais.at(-1).caminho, `/users/me/devices/${id}/sinal`);
  assert.deepEqual(sinais.at(-1).corpo, { appVersao: '2.2.0', electronVersao: '44.4.5', autostart: true });
  c.d.parar();
  assert.equal(c.tique(), null);
});

test('sem consentimento o sinal não faz pedidos', async () => {
  const c = cenario();
  c.d.iniciar();
  await c.tique().fn();
  assert.equal(c.chamadas.length, 0);
});

test('consentimentoValido:false desliga o consentimento local, o arranque e o tray', async () => {
  const c = cenario({ rotas: { 'POST /users/me/devices/:id/sinal': { status: 200, corpo: { result: { data: { consentimentoValido: false } } } } } });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  assert.equal(c.guardado.get('dispositivo:7').consentido, false);
  assert.deepEqual(c.arranque.at(-1), { openAtLogin: false, args: [] });
  assert.equal(c.tray.at(-1), false);
});

test('404 no sinal (o servidor não conhece o dispositivo) também desliga o consentimento local', async () => {
  const c = cenario({ rotas: { 'POST /users/me/devices/:id/sinal': { status: 404, corpo: {} } } });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  assert.equal(c.guardado.get('dispositivo:7').consentido, false);
  assert.deepEqual(c.arranque.at(-1), { openAtLogin: false, args: [] });
});

test('401 no sinal (sem sessão válida) não lança nem muda o consentimento', async () => {
  const c = cenario({ rotas: { 'POST /users/me/devices/:id/sinal': { status: 401, corpo: {} } } });
  await c.d.aceitar();
  c.d.iniciar();
  await assert.doesNotReject(c.tique().fn());
  assert.equal(c.guardado.get('dispositivo:7').consentido, true);
});

test('sem token (logout) não faz pedidos', async () => {
  const c = cenario();
  await c.d.aceitar();
  c.d.iniciar();
  c.sairDaSessao();
  c.chamadas.length = 0;
  await c.tique().fn();
  assert.equal(c.chamadas.length, 0);
});

test('aoTerminarSessao desliga o arranque sem revogar o consentimento', async () => {
  const c = cenario();
  await c.d.aceitar();
  c.d.aoTerminarSessao();
  assert.deepEqual(c.arranque.at(-1), { openAtLogin: false, args: [] });
  assert.equal(c.tray.at(-1), false);
  assert.equal(c.guardado.get('dispositivo:7').consentido, true, 'volta a valer no próximo login');
  assert.equal(c.chamadas.some(x => x.metodo === 'DELETE'), false);
});

test('outro utilizador no mesmo PC gera outro deviceId e não herda o consentimento', async () => {
  const c = cenario({ userId: 7 });
  await c.d.aceitar();
  const primeiro = c.guardado.get('dispositivo:7').deviceId;
  c.entrarComo(8);
  const e = await c.d.estado();
  assert.equal(e.consentido, false);
  await c.d.aceitar();
  const segundo = c.guardado.get('dispositivo:8').deviceId;
  assert.notEqual(primeiro, segundo);
  assert.equal(c.guardado.get('dispositivo:7').consentido, true);
});

test('definirArranque(false) guarda a preferência e desliga openAtLogin; (true) volta a ligar', async () => {
  const c = cenario();
  await c.d.aceitar();
  assert.deepEqual(await c.d.definirArranque(false), { ok: true });
  assert.equal(c.guardado.get('dispositivo:7').autostart, false);
  assert.deepEqual(c.arranque.at(-1), { openAtLogin: false, args: [] });
  assert.deepEqual(await c.d.definirArranque(true), { ok: true });
  assert.deepEqual(c.arranque.at(-1), { openAtLogin: true, args: ['--oculto'] });
});

test('definirArranque sem consentimento recusa', async () => {
  const c = cenario();
  assert.deepEqual(await c.d.definirArranque(true), { ok: false });
  assert.equal(c.arranque.length, 0);
});

test('revogar faz DELETE, limpa o consentimento e desliga o arranque e o tray', async () => {
  const c = cenario();
  await c.d.aceitar();
  const id = c.guardado.get('dispositivo:7').deviceId;
  assert.deepEqual(await c.d.revogar(), { ok: true });
  assert.ok(c.chamadas.some(x => x.metodo === 'DELETE' && x.caminho === `/users/me/devices/${id}`));
  assert.equal(c.guardado.get('dispositivo:7').consentido, false);
  assert.deepEqual(c.arranque.at(-1), { openAtLogin: false, args: [] });
  assert.equal(c.tray.at(-1), false);
});

test('revogar sem rede desliga já localmente e repete o DELETE no sinal seguinte', async () => {
  let rede = false;
  const c = cenario({ rotas: { 'DELETE /users/me/devices/:id': () => { if (!rede) throw new Error('offline'); return { status: 200, corpo: {} }; } } });
  await c.d.aceitar();
  c.d.iniciar();
  assert.deepEqual(await c.d.revogar(), { ok: true });
  assert.equal(c.guardado.get('dispositivo:7').consentido, false);
  rede = true;
  c.chamadas.length = 0;
  await c.tique().fn();
  assert.ok(c.chamadas.some(x => x.metodo === 'DELETE'), 'repetiu o DELETE pendente');
  assert.equal(c.guardado.get('dispositivo:7').revogarPendente, false);
});

test('aceitar outra vez depois de revogar reutiliza a mesma chave e o mesmo deviceId', async () => {
  const c = cenario();
  await c.d.aceitar();
  const antes = c.guardado.get('dispositivo:7');
  await c.d.revogar();
  await c.d.aceitar();
  const depois = c.guardado.get('dispositivo:7');
  assert.equal(depois.deviceId, antes.deviceId);
  assert.equal(depois.chavePublica, antes.chavePublica);
  assert.equal(depois.consentido, true);
});

test('arrancarOculto só com o argumento --oculto', () => {
  assert.equal(D.arrancarOculto(['C:\BCI.exe', '--oculto']), true);
  assert.equal(D.arrancarOculto(['C:\BCI.exe']), false);
  assert.equal(D.arrancarOculto([]), false);
  assert.equal(D.arrancarOculto(undefined), false);
  assert.equal(D.arrancarOculto(['--ocultox']), false);
});

const invalido = (motivo) => ({ status: 200, corpo: { result: { data: { consentimentoValido: false, motivo } } } });
const valido = { status: 200, corpo: { result: { data: { consentimentoValido: true } } } };

test('os sinais válidos não reescrevem o arranque do Windows (o cliente pode tê-lo desligado lá)', async () => {
  const c = cenario();
  await c.d.aceitar();
  const antes = c.arranque.length;
  c.d.iniciar();
  await c.tique().fn();
  await c.tique().fn();
  assert.equal(c.arranque.length, antes);
});

test('«desligado» ou «conta» suspendem o arranque e o tray mas mantêm o consentimento, e voltam sozinhos', async () => {
  let resposta = invalido('desligado');
  const c = cenario({ rotas: { 'POST /users/me/devices/:id/sinal': () => resposta } });
  await c.d.aceitar();
  c.d.iniciar();
  await c.tique().fn();
  assert.equal(c.guardado.get('dispositivo:7').consentido, true, 'o consentimento fica');
  assert.deepEqual(c.arranque.at(-1), { openAtLogin: false, args: [] });
  assert.equal(c.tray.at(-1), false);

  const n = c.arranque.length;
  await c.tique().fn();
  assert.equal(c.arranque.length, n, 'não repete o desligar a cada sinal');

  resposta = valido;
  await c.tique().fn();
  assert.deepEqual(c.arranque.at(-1), { openAtLogin: true, args: ['--oculto'] });
  assert.equal(c.tray.at(-1), true);
  const m = c.arranque.length;
  await c.tique().fn();
  assert.equal(c.arranque.length, m, 'só restaura uma vez');
});

test('«versao» e «revogado» apagam o consentimento local de vez', async () => {
  for (const motivo of ['versao', 'revogado']) {
    const c = cenario({ rotas: { 'POST /users/me/devices/:id/sinal': invalido(motivo) } });
    await c.d.aceitar();
    c.d.iniciar();
    await c.tique().fn();
    assert.equal(c.guardado.get('dispositivo:7').consentido, false, motivo);
  }
});

test('401 ou 403 no sinal são fim de sessão: desliga o arranque e o tray sem revogar, e restaura quando volta a valer', async () => {
  for (const estado of [401, 403]) {
    let resposta = { status: estado, corpo: {} };
    const c = cenario({ rotas: { 'POST /users/me/devices/:id/sinal': () => resposta } });
    await c.d.aceitar();
    c.d.iniciar();
    await c.tique().fn();
    assert.deepEqual(c.arranque.at(-1), { openAtLogin: false, args: [] }, String(estado));
    assert.equal(c.tray.at(-1), false);
    assert.equal(c.guardado.get('dispositivo:7').consentido, true, 'não revoga');
    assert.equal(c.chamadas.some(x => x.metodo === 'DELETE'), false);
    const n = c.arranque.length;
    await c.tique().fn();
    assert.equal(c.arranque.length, n, 'não repete');
    resposta = valido;
    await c.tique().fn();
    assert.deepEqual(c.arranque.at(-1), { openAtLogin: true, args: ['--oculto'] });
  }
});

test('a revogação fica pendente sempre que o servidor não a confirmou (não só nos 5xx)', async () => {
  for (const [estado, pendente] of [[401, true], [429, true], [500, true], [200, false], [404, false]]) {
    const c = cenario({ rotas: { 'DELETE /users/me/devices/:id': { status: estado, corpo: {} } } });
    await c.d.aceitar();
    await c.d.revogar();
    assert.equal(c.guardado.get('dispositivo:7').revogarPendente, pendente, String(estado));
    assert.equal(c.guardado.get('dispositivo:7').consentido, false);
  }
});
