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


  var db = null;
  var lastSentMap = {};

  try {
    if (!window.firebase) {
      console.log('[FIREBASE] firebase sdk not loaded');
      return;
    }

    if (!window.firebase.apps.length) {
      window.firebase.initializeApp(firebaseConfig);
    }

    db = window.firebase.firestore();
    console.log('[FIREBASE] logger ready');
  } catch (error) {
    console.log('[FIREBASE_INIT_FAILED]', error);
  }

  window.sendPlayerLog = async function (params) {
    try {
      if (!db || !params || !params.eventType) return;

      var now = Date.now();
      var deviceId = params.deviceId || 'unknown';
      var throttleKey = deviceId + ':' + params.eventType;
      var lastSentAt = lastSentMap[throttleKey] || 0;

      if (now - lastSentAt < 60000) return;

      lastSentMap[throttleKey] = now;

      await db.collection('device_logs').add({
        deviceId: deviceId,
        eventType: params.eventType,
        level: params.level || 'info',
        message: params.message || '',
        url: params.url || window.location.href,
        payload: params.payload || {},
        source: params.source || 'tv-login-html',
        createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        clientCreatedAt: now,
      });
    } catch (error) {
      console.log('[PLAYER_FIREBASE_LOG_FAILED]', error);
    }
  };
})();