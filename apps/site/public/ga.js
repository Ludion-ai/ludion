// Google Analytics 4 for ludion.ai (docs/decisions.md, "Analytics"). A file of its own, so the CSP needs no
// 'unsafe-inline'. It runs only on ludion.ai: local builds, CI, and the end-to-end tests never send a hit.
(function () {
  if (location.hostname !== "ludion.ai") return;
  var id = "G-91CJFHRK88";
  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  // Consent Mode. The EEA, the UK, and Switzerland default to denied, and there is no banner, so nothing is stored
  // there. Elsewhere analytics is granted. The site shows no ads, so ad storage is denied everywhere.
  var denied = { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied" };
  var region = [
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
    "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "GB", "CH",
  ];
  gtag("consent", "default", Object.assign({ region: region }, denied));
  gtag("consent", "default", Object.assign({}, denied, { analytics_storage: "granted" }));
  gtag("js", new Date());
  gtag("config", id);
  var script = document.createElement("script");
  script.async = true;
  script.src = "https://www.googletagmanager.com/gtag/js?id=" + id;
  document.head.appendChild(script);
})();
