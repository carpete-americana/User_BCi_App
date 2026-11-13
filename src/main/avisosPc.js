'use strict';

/** Notificações do Windows e contagem do tray; corre no processo principal para funcionar com a janela escondida. */

const INTERVALO_MS = 30000;
const PRIMEIRO_MS = 5000;
const MAXIMO_SOLTOS = 3;
const CHAVE_MARCA = 'avisos-pc-marca';
const CHAVE_DESLIGADOS = 'avisos-pc-desligados';
const PAGINA = /^[a-zA-Z0-9_-]{1,60}$/;

const paginaDoLink = (link) => (PAGINA.test(String(link || '')) ? link : 'dashboard');

function criarAvisosPc({ api, lerUserId, storage, mostrar, janelaEmFoco, abrir, aoContar, aoMudar, intervaloMs = INTERVALO_MS }) {
  let temporizador = null;
  let emCurso = false;
  let porLer = null;

  const marcas = () => storage.getItem(CHAVE_MARCA) || {};
  const ligados = () => storage.getItem(CHAVE_DESLIGADOS) !== true;

  function contar(total) {
    if (total === porLer) return false;
    porLer = total;
    aoContar(total);
    return true;
  }

  function aoClicar(aviso) {
    abrir(paginaDoLink(aviso.link));
    if (aviso.id) api.put(`/users/me/notifications/${aviso.id}/read`).then(() => tique()).catch(() => {});
  }

  function apresentar(novas) {
    if (janelaEmFoco()) return aoMudar(novas.map(n => ({ tipo: n.type, titulo: n.title, corpo: n.message })));
    aoMudar([]);
    if (!ligados()) return;
    // Com o PC desligado juntam-se muitos: uma pilha de avisos do Windows não se lê.
    if (novas.length > MAXIMO_SOLTOS) {
      mostrar({ titulo: 'BCI', corpo: `Tens ${novas.length} avisos novos.` }, () => aoClicar({}));
      return;
    }
    for (const n of novas) mostrar({ titulo: n.title, corpo: n.message }, () => aoClicar(n));
  }

  async function tique() {
    if (emCurso) return;
    emCurso = true;
    try {
      const userId = await lerUserId();
      if (!userId) return void contar(0);

      const r = await api.get('/users/me/notifications?page=1&limit=20&isRead=0');
      if (r.status === 401 || r.status === 403) return void contar(0);
      const dados = r.status === 200 ? r.corpo?.data : null;
      if (!dados || !Array.isArray(dados.notifications)) return;

      const mudou = contar(Number(dados.pagination?.total) || dados.notifications.length);

      // Só as de uma pessoa, como o push: as gerais são avisos de painel e ficam no sino.
      const minhas = dados.notifications.filter(n => n.user_id === userId);
      const todas = marcas();
      const marca = todas[userId];
      const maior = Math.max(marca || 0, ...minhas.map(n => n.id));
      if (maior !== marca) storage.setItem(CHAVE_MARCA, { ...todas, [userId]: maior });

      // Na primeira vez deste utilizador neste PC só se marca: o que já estava por ler não é novo.
      const novas = marca === undefined ? [] : minhas.filter(n => n.id > marca).sort((a, b) => a.id - b.id);
      if (novas.length) apresentar(novas);
      else if (mudou) aoMudar([]);
    } catch (e) {
      // Sem rede ou servidor em baixo: mantém-se o que estava e tenta-se no tique seguinte.
    } finally {
      emCurso = false;
    }
  }

  return {
    tique,
    ligados,
    definirLigados: (sim) => storage.setItem(CHAVE_DESLIGADOS, !sim),
    iniciar() {
      if (temporizador) return;
      setTimeout(tique, PRIMEIRO_MS);
      temporizador = setInterval(tique, intervaloMs);
    },
    parar() {
      clearInterval(temporizador);
      temporizador = null;
    }
  };
}

/** Pinta um ponto vermelho no canto inferior direito de um bitmap BGRA (o formato do `toBitmap`). */
function pintarPonto(bitmap, largura, altura) {
  const saida = Buffer.from(bitmap);
  const raio = Math.max(2, Math.round(largura * 0.2));
  const cx = largura - raio - 0.5;
  const cy = altura - raio - 0.5;
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const distancia = Math.hypot(x - cx, y - cy);
      if (distancia > raio + 0.5) continue;
      const cobertura = Math.min(1, raio + 0.5 - distancia);
      const i = (y * largura + x) * 4;
      saida[i] = Math.round(0x26 * cobertura + saida[i] * (1 - cobertura));
      saida[i + 1] = Math.round(0x26 * cobertura + saida[i + 1] * (1 - cobertura));
      saida[i + 2] = Math.round(0xdc * cobertura + saida[i + 2] * (1 - cobertura));
      saida[i + 3] = Math.round(255 * cobertura + saida[i + 3] * (1 - cobertura));
    }
  }
  return saida;
}

module.exports = { criarAvisosPc, pintarPonto, paginaDoLink, INTERVALO_MS };
