(function () {
  var CHAVE = 'tecnoflow.tema';
  try {
    var salvo = localStorage.getItem(CHAVE);
    var prefereEscuro = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var tema = salvo === 'claro' || salvo === 'escuro' ? salvo : prefereEscuro ? 'escuro' : 'claro';
    document.documentElement.setAttribute('data-tema', tema);
  } catch (erro) {
    document.documentElement.setAttribute('data-tema', 'claro');
  }
})();
