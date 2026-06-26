try {
  window.localStorage.getItem('test');
} catch (e) {
  const store = {};
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (key) => store[key] || null,
      setItem: (key, value) => { store[key] = value.toString(); },
      removeItem: (key) => { delete store[key]; },
      clear: () => { for (let key in store) delete store[key]; }
    },
    writable: true,
    configurable: true
  });
}

try {
  const _ = document.cookie;
} catch (e) {
  let cookieStore = '';
  Object.defineProperty(document, 'cookie', {
    get: () => cookieStore,
    set: (value) => { cookieStore = value; },
    configurable: true
  });
}
