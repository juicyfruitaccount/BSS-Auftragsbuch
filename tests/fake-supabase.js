/*
 * Simulierte Supabase-Datenbank für die Tests.
 * Ersetzt im Test-Browser die echte Supabase-Bibliothek, damit keine echten
 * Kundendaten gelesen oder geschrieben werden.
 *
 * Steuerung aus dem Test über window.__SB_INIT (vor dem Laden gesetzt):
 *   userId   – ID des angemeldeten Kontos (Standard 'u1')
 *   session  – true: bereits angemeldet, false: Anmeldemaske
 *   rows     – Startinhalt der Tabelle docs: [{col,id,data}]
 *   failWrites – so viele Schreibvorgänge schlagen zuerst fehl
 * Zugriff während des Tests über window.__fakeSb.
 */
(function () {
  const init = window.__SB_INIT || {};
  const userId = init.userId || 'u1';
  const clone = v => JSON.parse(JSON.stringify(v));
  const user = { id: userId, email: 'giusi@example.ch' };
  const st = {
    rows: (init.rows || []).map(r => ({ owner: r.owner || userId, col: r.col, id: r.id, data: clone(r.data) })),
    session: init.session === false ? null : { user },
    password: 'geheim',
    calls: [],
    failWrites: init.failWrites || 0,
    handlers: [],
    authListeners: [],
    loginAttempts: 0,
  };
  window.__fakeSb = st;

  const mine = () => st.rows.filter(r => st.session && r.owner === st.session.user.id);
  const ok = v => Promise.resolve(v);

  st.writes = () => st.calls.filter(c => c.op === 'upsert' || c.op === 'delete');
  st.get = (col, id) => { const r = st.rows.find(x => x.col === col && x.id === id); return r ? clone(r.data) : null; };
  st.list = col => st.rows.filter(x => x.col === col).map(x => clone(x.data));
  // Änderung von einem anderen Gerät simulieren (Realtime-Ereignis)
  st.emit = (eventType, col, id, data) => {
    if (eventType === 'DELETE') st.rows = st.rows.filter(r => !(r.col === col && r.id === id));
    else {
      const i = st.rows.findIndex(r => r.col === col && r.id === id);
      const rec = { owner: userId, col, id, data: clone(data) };
      if (i >= 0) st.rows[i] = rec; else st.rows.push(rec);
    }
    const row = { owner: userId, col, id, data: data ? clone(data) : undefined };
    const payload = eventType === 'DELETE' ? { eventType, old: row, new: {} } : { eventType, new: row, old: {} };
    st.handlers.forEach(h => h(payload));
  };

  function from() {
    return {
      select(cols, opts) {
        const q = {
          range(a, b) {
            st.calls.push({ op: 'select' });
            return ok({ data: mine().slice(a, b + 1).map(r => ({ col: r.col, id: r.id, data: clone(r.data) })), error: null });
          },
          then(res, rej) { return ok({ count: mine().length, data: null, error: null }).then(res, rej); },
        };
        return q;
      },
      upsert(row) {
        st.calls.push({ op: 'upsert', col: row.col, id: row.id, data: clone(row.data) });
        if (st.failWrites > 0) { st.failWrites--; return ok({ error: { message: 'Netzwerkfehler (simuliert)' }, status: 503 }); }
        if (!st.session || row.owner !== st.session.user.id) return ok({ error: { message: 'new row violates row-level security policy' }, status: 403 });
        const i = st.rows.findIndex(r => r.owner === row.owner && r.col === row.col && r.id === row.id);
        const rec = { owner: row.owner, col: row.col, id: row.id, data: clone(row.data) };
        if (i >= 0) st.rows[i] = rec; else st.rows.push(rec);
        return ok({ error: null });
      },
      delete() {
        const c = {};
        const b = {
          eq(k, v) { c[k] = v; return b; },
          then(res, rej) {
            st.calls.push({ op: 'delete', col: c.col, id: c.id });
            if (st.failWrites > 0) { st.failWrites--; return ok({ error: { message: 'Netzwerkfehler (simuliert)' }, status: 503 }).then(res, rej); }
            st.rows = st.rows.filter(r => !(r.owner === c.owner && r.col === c.col && r.id === c.id));
            return ok({ error: null }).then(res, rej);
          },
        };
        return b;
      },
    };
  }

  const client = {
    from,
    auth: {
      getSession: () => ok({ data: { session: st.session }, error: null }),
      onAuthStateChange(cb) { st.authListeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      refreshSession: () => ok({ data: {}, error: null }),
      signInWithPassword({ email, password }) {
        st.loginAttempts++;
        if (email === user.email && password === st.password) {
          st.session = { user };
          return ok({ data: { user, session: st.session }, error: null });
        }
        return ok({ data: { user: null, session: null }, error: { message: 'Invalid login credentials' } });
      },
      signOut() {
        st.session = null;
        st.authListeners.forEach(cb => cb('SIGNED_OUT', null));
        return ok({ error: null });
      },
    },
    channel() {
      const ch = {
        state: 'joined',
        on(evt, filter, cb) { st.handlers.push(cb); return ch; },
        subscribe(cb) { if (cb) setTimeout(() => cb('SUBSCRIBED'), 0); return ch; },
      };
      return ch;
    },
    removeChannel() { st.handlers = []; },
  };

  window.supabase = { createClient: () => client };
})();
