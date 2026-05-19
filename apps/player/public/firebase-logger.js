(function () {
  var firebaseConfig = {
    apiKey: "AIzaSyDoKXJokKhiY5x-3zFoHFo8c4ISadFPQCE",
    authDomain: "infoon-tv-monitoring.firebaseapp.com",
    projectId: "infoon-tv-monitoring",
    storageBucket: "infoon-tv-monitoring.firebasestorage.app",
    messagingSenderId: "1029778669951",
    appId: "1:1029778669951:web:757a13e0c97d9d533bda4a",
    measurementId: "G-4VMTX8G10Z"
  };

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  var db = firebase.firestore();
  var lastSentMap = {};

  function sanitizeDocIdPart(value) {
    return String(value || "unknown")
      .replace(/\//g, "_")
      .replace(/\s+/g, "_")
      .replace(/[^\w.-]/g, "_")
      .slice(0, 80);
  }

  window.sendPlayerLog = function (params) {
    try {
      var now = Date.now();
      var deviceId = params.deviceId || "unknown";
      var eventType = params.eventType || "UNKNOWN_EVENT";
      var throttleKey = deviceId + ":" + eventType;
      var lastSentAt = lastSentMap[throttleKey] || 0;

      if (now - lastSentAt < 60000) return;

      lastSentMap[throttleKey] = now;

      var safeDeviceId = sanitizeDocIdPart(deviceId);
      var safeEventType = sanitizeDocIdPart(eventType);
      var docId = safeDeviceId + "_" + now + "_" + safeEventType;

      db.collection("device_logs").doc(docId).set({
        deviceId: deviceId,
        eventType: eventType,
        level: params.level || "info",
        message: params.message || "",
        url: params.url || window.location.href,
        reloadCount: params.reloadCount == null ? null : params.reloadCount,
        payload: params.payload || {},
        source: params.source || "player-html",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        clientCreatedAt: now
      });
    } catch (error) {
      console.log("[PLAYER_FIREBASE_LOG_FAILED]", error);
    }
  };
})();