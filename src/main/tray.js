const { app, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { DEBUG } = require('./config');
const { pintarPonto } = require('./avisosPc');

let tray = null;
let operacoesLigadas = false;
let aoMostrar = null;
let aoSair = null;
let porLer = 0;
let avisos = null;
let iconeBase = null;
let iconePonto = null;

const TOOLTIP = 'BCi User Application';
const TOOLTIP_OPERACOES = 'BCI · operações automáticas ligadas';

function irParaPagina(pagina) {
  if (aoMostrar) aoMostrar();
  const { BrowserWindow } = require('electron');
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.webContents.send('navigate-to', pagina);
}

const textoPorLer = () => (porLer === 1 ? '1 aviso por ler' : `${porLer} avisos por ler`);

function construirMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Mostrar Aplicação',
      click: () => {
        DEBUG && console.log('[TRAY] Show application clicked');
        if (aoMostrar) aoMostrar();
      }
    },
    ...(porLer > 0 ? [{ label: textoPorLer(), click: () => aoMostrar && aoMostrar() }] : []),
    { type: 'separator' },
    { label: 'Dashboard', click: () => irParaPagina('dashboard') },
    { label: 'Regras', click: () => irParaPagina('rules') },
    { type: 'separator' },
    // Só informa: ligar e desligar faz-se em Definições, depois de um diálogo de consentimento.
    { label: `Operações automáticas: ${operacoesLigadas ? 'ligadas' : 'desligadas'}`, enabled: false },
    ...(avisos ? [{
      label: 'Notificações do Windows',
      type: 'checkbox',
      checked: avisos.ligados(),
      click: (item) => avisos.definirLigados(item.checked)
    }] : []),
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => {
        DEBUG && console.log('[TRAY] Quit clicked');
        if (aoSair) aoSair();
      }
    }
  ]);
}

function atualizar() {
  if (!tray) return;
  tray.setContextMenu(construirMenu());
  const base = operacoesLigadas ? TOOLTIP_OPERACOES : TOOLTIP;
  tray.setToolTip(porLer > 0 ? `${base} · ${textoPorLer()}` : base);
  if (iconeBase) tray.setImage(porLer > 0 ? iconeComPonto() : iconeBase);
}

function iconeComPonto() {
  if (iconePonto) return iconePonto;
  const lado = 32;
  const pequeno = iconeBase.resize({ width: lado, height: lado });
  iconePonto = nativeImage.createFromBitmap(pintarPonto(pequeno.toBitmap(), lado, lado), { width: lado, height: lado });
  return iconePonto;
}

function createTray(showWindowCallback, quitCallback) {
  aoMostrar = showWindowCallback;
  aoSair = quitCallback;

  const iconPath = path.join(__dirname, '../../assets/icons/tray-icon.png');

  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      const buildIconPath = path.join(__dirname, '../../build/tray-icon.png');
      icon = nativeImage.createFromPath(buildIconPath);

      if (icon.isEmpty()) {
        icon = nativeImage.createEmpty();
        DEBUG && console.warn('[TRAY] No icon found, using empty icon');
      }
    }
  } catch (e) {
    icon = nativeImage.createEmpty();
    DEBUG && console.warn('[TRAY] Error loading icon:', e.message);
  }

  tray = new Tray(icon);
  iconeBase = icon.isEmpty() ? null : icon;
  atualizar();

  tray.on('double-click', () => {
    DEBUG && console.log('[TRAY] Double clicked');
    if (aoMostrar) aoMostrar();
  });

  DEBUG && console.log('[TRAY] System tray created');

  return tray;
}

/** Mostra no tooltip e no menu se este computador aceitou as operações automáticas. */
function setOperacoes(ligado) {
  operacoesLigadas = !!ligado;
  atualizar();
}

/** Número de avisos por ler: ponto no ícone, tooltip e linha no menu. */
function setPorLer(total) {
  porLer = total;
  atualizar();
}

/** Liga a caixa «Notificações do Windows» do menu. */
function setAvisos(controlo) {
  avisos = controlo;
  atualizar();
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
    DEBUG && console.log('[TRAY] System tray destroyed');
  }
}

module.exports = {
  createTray,
  destroyTray,
  setOperacoes,
  setPorLer,
  setAvisos
};
