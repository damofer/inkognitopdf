// Spec 017: PDFs shared from other apps arrive here as a form POST (Web Share
// Target). They are kept in the browser's cache, never sent anywhere, and the
// app opens them from there.
const SHARED_CACHE = "inkognito-shared";

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.pathname !== "/app/share-target")
    return;
  event.respondWith(
    (async () => {
      const form = await event.request.formData();
      const files = form
        .getAll("pdf")
        .filter(
          (f) =>
            typeof f !== "string" &&
            (f.type === "application/pdf" || /\.pdf$/i.test(f.name)),
        );
      await caches.delete(SHARED_CACHE);
      const cache = await caches.open(SHARED_CACHE);
      await Promise.all(
        files.map((file, i) =>
          cache.put(
            `/app/__shared/${i}`,
            new Response(file, {
              headers: {
                "Content-Type": "application/pdf",
                "X-File-Name": encodeURIComponent(file.name || "shared.pdf"),
              },
            }),
          ),
        ),
      );
      return Response.redirect("/app/?shared", 303);
    })(),
  );
});
