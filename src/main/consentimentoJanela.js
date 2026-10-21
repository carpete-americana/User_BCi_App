'use strict';

/**
 * Pedido de consentimento numa janela modal da app. O HTML vem de public/ (nunca da rede) e só o preload desta janela
 * pode responder, pelo canal consentimento:responder; uma resposta de outro webContents é ignorada.
 * Sem `require('electron')`: tudo vem por dependências, para testar com node --test.
 */

const path = require('node:path');

const LARGURA = 520;
const ALTURA = 560;
const CANAL = 'consentimento:responder';
const FICHEIRO = path.join(__dirname, '..', '..', 'public', 'consentimento.html');
const PRELOAD = path.join(__dirname, '..', 'preload', 'consentimento.js');

let aberta = null;

/** Resolve true se o utilizador aceitar; false se recusar ou fechar a janela. */
function pedirConsentimento({ modo, titulo, texto, botoes }, deps) {
  const { BrowserWindow, ipcMain } = deps;
  if (aberta) {
    aberta.win.focus?.();
    return aberta.promessa;
  }
  const pai = deps.janelaPai?.() || null;
  const posicao = {};
  if (pai) {
    const b = pai.getBounds();
    posicao.x = Math.round(b.x + (b.width - LARGURA) / 2);
    posicao.y = Math.round(b.y + (b.height - ALTURA) / 2);
  }

  const win = new BrowserWindow({
    ...posicao,
    width: LARGURA,
    height: ALTURA,
    parent: pai || undefined,
    modal: !!pai,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    backgroundColor: '#F8FAFC',
    title: titulo,
    webPreferences: { preload: PRELOAD, nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  const wc = win.webContents;
  // Nada sai desta janela: nem navegação nem janelas novas.
  wc.on('will-navigate', (event) => event.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.once('ready-to-show', () => win.show());

  const promessa = new Promise((resolve) => {
    let fechada = false;
    const terminar = (aceite) => {
      if (fechada) return;
      fechada = true;
      ipcMain.removeListener(CANAL, aoResponder);
      aberta = null;
      resolve(aceite);
      if (!win.isDestroyed()) win.close();
    };
    const aoResponder = (event, aceite) => {
      if (event.sender !== wc) return;
      terminar(aceite === true);
    };
    ipcMain.on(CANAL, aoResponder);
    win.on('closed', () => terminar(false));
  });
  aberta = { win, promessa };

  win.loadFile(FICHEIRO, { query: { modo, titulo, texto, aceitar: botoes[0], recusar: botoes[1] } });
  return promessa;
}

module.exports = { pedirConsentimento, FICHEIRO, PRELOAD, CANAL };
