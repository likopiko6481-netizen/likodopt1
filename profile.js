(function() {
  // 1. Генератор пиксельной мини-аватарки 10x10 (Canvas -> DataURL)
  window.makePixelAvatar = function(seedStr) {
    var c = document.createElement('canvas');
    c.width = 10;
    c.height = 10;
    var ctx = c.getContext('2d');

    var hash = 0;
    var s = seedStr || String(Math.random());
    for (var i = 0; i < s.length; i++) {
      hash = ((hash << 5) - hash) + s.charCodeAt(i);
      hash |= 0;
    }

    var hue = Math.abs(hash) % 360;
    ctx.fillStyle = '#181b22';
    ctx.fillRect(0, 0, 10, 10);
    ctx.fillStyle = 'hsl(' + hue + ', 85%, 60%)';

    // Симметричный узор 10x10
    for (var y = 1; y < 9; y++) {
      for (var x = 1; x < 5; x++) {
        hash = (hash * 16807) % 2147483647;
        if (Math.abs(hash) % 2 === 0) {
          ctx.fillRect(x, y, 1, 1);
          ctx.fillRect(9 - x, y, 1, 1);
        }
      }
    }
    return c.toDataURL();
  };

  // 2. Инициализация ника и аватарки
  window.myNick = localStorage.getItem('lk_nick') || ('Гость #' + Math.floor(100 + Math.random() * 899));
  window.myAvaSeed = localStorage.getItem('lk_ava_seed') || String(Date.now() + Math.random());
  window.myAvaUrl = window.makePixelAvatar(window.myAvaSeed);

  // 3. Вставка панели профиля над кнопками режимов (не ломая верстку)
  var header = document.querySelector('.header');
  if (header) {
    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:8px;background:rgba(18,20,26,0.9);padding:8px 10px;border-radius:12px;border:1px solid #252a36;margin-bottom:12px;';

    var img = document.createElement('img');
    img.id = 'myAvaImg';
    img.src = window.myAvaUrl;
    img.title = 'Нажми, чтобы сменить аватарку 10x10';
    img.style.cssText = 'width:32px;height:32px;border-radius:6px;image-rendering:pixelated;border:1px solid #00e676;cursor:pointer;flex-shrink:0;';
    img.onclick = function() {
      window.myAvaSeed = String(Date.now() + Math.random());
      localStorage.setItem('lk_ava_seed', window.myAvaSeed);
      window.myAvaUrl = window.makePixelAvatar(window.myAvaSeed);
      img.src = window.myAvaUrl;
      if (window.netUpdateProfile) window.netUpdateProfile();
    };

    var inp = document.createElement('input');
    inp.type = 'text';
    inp.maxLength = 18;
    inp.value = window.myNick;
    inp.placeholder = 'Ваш ник...';
    inp.style.cssText = 'flex:1;background:#232834;border:1px solid #323846;border-radius:8px;padding:6px 10px;color:#fff;font-size:0.88rem;font-weight:600;outline:none;min-width:0;';
    inp.oninput = function() {
      var val = inp.value.trim();
      window.myNick = val || 'Аноним';
      localStorage.setItem('lk_nick', window.myNick);
      if (window.netUpdateProfile) window.netUpdateProfile();
    };

    var rndBtn = document.createElement('button');
    rndBtn.type = 'button';
    rndBtn.textContent = '🎲';
    rndBtn.title = 'Сгенерировать новую аватарку 10x10';
    rndBtn.style.cssText = 'background:#232834;border:1px solid #323846;border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:0.95rem;flex-shrink:0;';
    rndBtn.onclick = img.onclick;

    bar.appendChild(img);
    bar.appendChild(inp);
    bar.appendChild(rndBtn);
    header.insertAdjacentElement('afterend', bar);
  }
})();
