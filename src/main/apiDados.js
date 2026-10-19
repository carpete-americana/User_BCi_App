'use strict';

/** Cliente HTTP do processo principal para a API de dados. Só usa o token da sessão e aborta ao fim do tempo limite. */

function criarApi({ baseUrl, lerToken, fetchFn = fetch, tempoLimiteMs = 10000 }) {
  async function pedir(metodo, caminho, corpo) {
    const token = await lerToken();
    if (!token) return { status: 401, corpo: null };
    const controlo = new AbortController();
    const temporizador = setTimeout(() => controlo.abort(), tempoLimiteMs);
    try {
      const res = await fetchFn(baseUrl + caminho, {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: controlo.signal
      });
      return { status: res.status, corpo: await res.json().catch(() => null) };
    } finally {
      clearTimeout(temporizador);
    }
  }
  return {
    get: (caminho) => pedir('GET', caminho),
    post: (caminho, corpo) => pedir('POST', caminho, corpo),
    del: (caminho) => pedir('DELETE', caminho)
  };
}

module.exports = { criarApi };
