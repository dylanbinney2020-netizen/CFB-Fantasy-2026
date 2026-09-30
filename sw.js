/* CFB Fantasy 2026 -- service worker, push notifications only.
 *
 * Deliberately does NOT cache anything. The app is a single HTML file that is
 * replaced on every deploy, and a caching service worker is the classic way to
 * leave managers staring at last week's build. Caching can be added later as a
 * decision of its own; it is not needed for notifications.
 *
 * Place this file next to index.html in the repository root.
 */

const TAG = "cfb-lineup-reminder";

self.addEventListener("install", () => {
  /* Take over straight away rather than waiting for every tab to close, so a
     manager who enables notifications does not have to quit the app first. */
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let title = "CFB Fantasy 2026";
  let body = "Your lineup for this week has not been submitted. Please submit your lineup.";
  let url = "./?p=lineup";

  /* A push can arrive with no payload at all, and some services strip it. The
     message is the same every time, so the defaults above are the message and
     the payload only overrides it if one is genuinely there. */
  if (event.data) {
    try {
      const d = event.data.json();
      if (d.title) title = d.title;
      if (d.body) body = d.body;
      if (d.url) url = d.url;
    } catch (e) {
      const t = event.data.text();
      if (t) body = t;
    }
  }

  event.waitUntil(self.registration.showNotification(title, {
    body,
    /* tag means a second reminder replaces the first rather than stacking up */
    tag: TAG,
    renotify: true,
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    data: { url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "./?p=lineup";

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    /* If the app is already open somewhere, focus that window and move it to
       the lineup page rather than opening a second copy. */
    for (const c of all) {
      if ("focus" in c) {
        await c.focus();
        if ("navigate" in c) {
          try { await c.navigate(target); } catch (e) { /* cross-origin, ignore */ }
        }
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});

/* A push service can rotate a subscription without warning. When that happens
   the old endpoint stops working, so the new one is registered immediately.
   The manager's name and PIN are not available here, so the page handles the
   re-registration the next time it is opened; this only tells it to. */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) c.postMessage({ type: "resubscribe" });
  })());
});
