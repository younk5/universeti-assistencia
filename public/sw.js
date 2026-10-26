/**
 * Service worker da UniverseTI Assistência.
 *
 * Existe para uma coisa só: receber as notificações push enviadas pelo
 * servidor quando um aparelho dá entrada na assistência (com o sistema
 * fechado) e abrir a OS certa quando o aviso é tocado. Não faz cache de
 * arquivos — o app continua carregando sempre a versão nova.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(self.clients.claim());
});

self.addEventListener('push', (evento) => {
  let dados = {};
  try {
    dados = evento.data ? evento.data.json() : {};
  } catch {
    dados = { mensagem: evento.data ? evento.data.text() : '' };
  }

  const titulo = dados.titulo || 'UniverseTI Assistência';
  const opcoes = {
    body: dados.mensagem || 'Você tem uma nova atualização no sistema.',
    icon: '/img/icone-192.png',
    badge: '/img/icone-192.png',
    tag: dados.tag || 'universeti-aviso',
    renotify: Boolean(dados.tag),
    lang: 'pt-BR',
    data: { url: dados.url || '/#/painel' },
    vibrate: [90, 60, 90],
  };

  evento.waitUntil(self.registration.showNotification(titulo, opcoes));
});

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const destino = (evento.notification.data && evento.notification.data.url) || '/#/painel';

  evento.waitUntil(
    (async () => {
      const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const janela of janelas) {
        if ('focus' in janela) {
          await janela.focus();
          if ('navigate' in janela) await janela.navigate(destino).catch(() => {});
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(destino);
    })(),
  );
});
