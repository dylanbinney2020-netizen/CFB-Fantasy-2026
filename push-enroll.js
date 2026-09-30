/* CFB Fantasy 2026 -- notification enrolment.
 *
 * WHY THIS IS NOT IN THE REACT BUNDLE
 * Rebuilding the bundle here produces a file 55KB different from the deployed
 * one, because the dependency versions available to me are not the ones it was
 * built with. Swapping a working app mid-season for a notification prompt is a
 * bad trade. This reads the same sessionStorage keys the app already uses, so
 * it needs no access to React state and the bundle is untouched.
 *
 * Keys it reads, both already set by the app at login:
 *   cfb26_me   the signed-in manager's name
 *   cfb26_pin  their PIN, which push_register checks
 *
 * It writes one key of its own, cfb26_push, holding 'on' or 'declined'.
 */
(function () {
  "use strict";

  var SUPABASE_URL = window.CFB_CONFIG && window.CFB_CONFIG.supabaseUrl;
  var SUPABASE_KEY = window.CFB_CONFIG && window.CFB_CONFIG.supabaseKey;
  var VAPID_PUBLIC = window.CFB_CONFIG && window.CFB_CONFIG.vapidPublicKey;

  var STATE = "cfb26_push";
  var ME = "cfb26_me";
  var PIN = "cfb26_pin";

  function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function ss(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }

  var iOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var standalone = window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;
  var supported = "serviceWorker" in navigator && "PushManager" in window
    && "Notification" in window;

  /* ------------------------------------------------------------ the prompt */

  function card(html) {
    var w = document.getElementById("cfb-push-card");
    if (w) w.remove();
    if (!html) return;
    w = document.createElement("div");
    w.id = "cfb-push-card";
    w.setAttribute("style", [
      "position:fixed", "left:12px", "right:12px", "bottom:14px", "z-index:9999",
      "max-width:520px", "margin:0 auto",
      "background:#12161f", "color:#e9edf5",
      "border:1px solid rgba(255,255,255,.22)", "border-radius:12px",
      "box-shadow:0 0 0 .5px rgba(255,255,255,.06),0 6px 24px rgba(0,0,0,.45)",
      "padding:14px 15px",
      "font:500 14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif",
    ].join(";"));
    w.innerHTML = html;
    document.body.appendChild(w);
    var x = w.querySelector("[data-dismiss]");
    if (x) x.onclick = function () { lsSet(STATE, "declined"); card(null); };
    return w;
  }

  var BTN = "background:#e8b23a;color:#1a1200;border:0;border-radius:8px;"
    + "padding:9px 15px;font:700 14px system-ui;cursor:pointer";
  var LINK = "background:none;border:0;color:#8c96a8;font:500 13px system-ui;"
    + "cursor:pointer;padding:8px 4px";

  function showEnable() {
    var w = card(
      '<div style="font-weight:800;font-size:15px;margin-bottom:3px">'
      + "Never forget your lineup</div>"
      + '<div style="color:#aeb6c4;margin-bottom:12px">'
      + "Enable CFB Fantasy notifications to receive lineup reminders.</div>"
      + '<div style="display:flex;gap:10px;align-items:center">'
      + '<button id="cfb-push-go" style="' + BTN + '">Enable Notifications</button>'
      + '<button data-dismiss style="' + LINK + '">Not now</button></div>');
    w.querySelector("#cfb-push-go").onclick = enable;
  }

  function showInstallFirst() {
    card('<div style="font-weight:800;font-size:15px;margin-bottom:3px">'
      + "Add CFB Fantasy to your Home Screen to enable lineup notifications</div>"
      + '<div style="color:#aeb6c4;margin-bottom:10px">'
      + "Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. "
      + "Open the app from your Home Screen and you can turn notifications on."
      + "</div><div style=\"display:flex;justify-content:flex-end\">"
      + '<button data-dismiss style="' + LINK + '">Got it</button></div>');
  }

  function showResult(msg) {
    card('<div style="color:#aeb6c4">' + msg + "</div>"
      + '<div style="display:flex;justify-content:flex-end">'
      + '<button data-dismiss style="' + LINK + '">Close</button></div>');
    setTimeout(function () { card(null); }, 6000);
  }

  /* ------------------------------------------------------------- enrolment */

  function urlB64ToUint8(base64) {
    var pad = "=".repeat((4 - (base64.length % 4)) % 4);
    var b64 = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(b64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function b64(buf) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
  }

  async function register(sub) {
    var me = ss(ME), pin = ss(PIN);
    if (!me || !pin) return { ok: false, reason: "not_signed_in" };
    var j = sub.toJSON();
    var res = await fetch(SUPABASE_URL + "/rest/v1/rpc/push_register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        Authorization: "Bearer " + SUPABASE_KEY,
      },
      body: JSON.stringify({
        p_manager: me, p_pin: pin,
        p_endpoint: j.endpoint,
        p_p256dh: j.keys && j.keys.p256dh,
        p_auth: j.keys && j.keys.auth,
        p_user_agent: navigator.userAgent,
      }),
    });
    if (!res.ok) return { ok: false, reason: "http_" + res.status };
    return await res.json();
  }

  async function enable() {
    try {
      if (!VAPID_PUBLIC) { showResult("Notifications are not configured yet."); return; }
      var perm = await Notification.requestPermission();
      if (perm !== "granted") {
        /* A refusal is remembered so the browser prompt is never fired again
           on its own. Only the browser's own settings can undo a block. */
        lsSet(STATE, "declined");
        showResult("Notifications are off. You can turn them on in your "
          + "browser or phone settings for this app.");
        return;
      }
      var reg = await navigator.serviceWorker.register("./sw.js");
      await navigator.serviceWorker.ready;
      var sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8(VAPID_PUBLIC),
        });
      }
      var out = await register(sub);
      if (out && out.ok) {
        lsSet(STATE, "on");
        showResult("Notifications are on. You will only hear from us when your "
          + "lineup is missing.");
      } else {
        showResult("Could not save the subscription"
          + (out && out.reason ? " (" + out.reason + ")" : "") + ".");
      }
    } catch (e) {
      showResult("Something went wrong enabling notifications.");
    }
  }

  /* ------------------------------------------------------------ the decision */

  async function consider() {
    if (!ss(ME)) return;                    // nobody signed in yet
    if (ls(STATE) === "declined") return;   // asked once, said no
    if (!supported) {
      if (iOS && !standalone) showInstallFirst();
      return;
    }
    if (iOS && !standalone) { showInstallFirst(); return; }

    if (Notification.permission === "denied") return;   // never re-prompt

    if (Notification.permission === "granted") {
      /* Permission is already there. Make sure the CURRENT subscription is on
         file, because a reinstall or a rotated endpoint leaves permission
         granted while the database knows nothing about the device. */
      try {
        var reg = await navigator.serviceWorker.register("./sw.js");
        await navigator.serviceWorker.ready;
        var sub = await reg.pushManager.getSubscription();
        if (!sub) { await enable(); return; }
        var out = await register(sub);
        if (out && out.ok) lsSet(STATE, "on");
      } catch (e) { /* leave it; the prompt below is not shown */ }
      return;
    }
    showEnable();                           // permission is 'default'
  }

  /* The app signs in after this script runs, so wait for a manager to appear
     rather than asking before there is anyone to ask. Checked briefly, then
     given up on, so an idle sign-in screen is not polled forever. */
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (ss(ME)) { clearInterval(timer); setTimeout(consider, 1200); }
    else if (tries > 120) clearInterval(timer);   // two minutes
  }, 1000);

  navigator.serviceWorker && navigator.serviceWorker.addEventListener
    && navigator.serviceWorker.addEventListener("message", function (e) {
      if (e.data && e.data.type === "resubscribe") consider();
    });
})();
